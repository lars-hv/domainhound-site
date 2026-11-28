const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { webkit } = require('playwright-core');
const data = require('../data/sf/endings.json');
const { companies } = require('../data/sf/companies.json');

test('SF counts reconcile across cohorts, endings, and brand shapes', () => {
  assert.equal(data.websites + data.excluded_websites, data.eligible_companies);
  const counts = {};
  for (const batch of data.batches) {
    let total = 0;
    for (const [ending, { count, pct }] of Object.entries(batch.endings)) {
      total += count;
      counts[ending] = (counts[ending] || 0) + count;
      assert.ok(Math.abs(pct - 100 * count / batch.websites) <= .005001);
    }
    assert.equal(total, batch.websites);
  }
  assert.deepEqual(counts, Object.fromEntries(Object.entries(data.endings).map(([k, v]) => [k, v.count])));
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), data.websites);
  assert.equal(Object.values(data.brand_shapes).reduce((n, v) => n + v.count, 0), data.websites);
  assert.equal(data.facts.matching_com + data.facts.different_com, counts['.com']);
});

test('SF chart and name check work without publishing a search to the page URL or storage', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const site = 'https://site.example';
    const checked = [];
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      if (url.origin === site) {
        const asset = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        const contentType = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css',
          '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(asset)];
        return route.fulfill({ body: await fs.readFile(path.join(__dirname, '..', asset)), contentType });
      }
      assert.equal(url.pathname, '/v1/check');
      const name = url.searchParams.get('name');
      checked.push(name);
      if (name === 'test-throttle') return route.fulfill({ status: 429, body: '' });
      return route.fulfill({ json: { domains: [{ domain: 'example.com', status: 'taken' }] } });
    });
    await page.goto(site + '/sf/');
    const entries = Object.entries(data.endings).slice(0, 10);
    for (const [selector, limit] of [['#leaders li', 3], ['#ranking li', 10]]) {
      const rows = page.locator(selector);
      assert.equal(await rows.count(), limit);
      for (const [index, [ending, { count, pct }]] of entries.slice(0, limit).entries()) {
        const row = rows.nth(index);
        assert.equal(await row.locator('.ending').textContent(), ending);
        assert.equal(await row.locator('.count').textContent(), String(count));
        assert.equal(await row.locator('.share').textContent(), pct + '%');
      }
    }
    assert.deepEqual(await page.locator('h1 span').allTextContents(),
      ['Your .com is taken.', 'Here’s what 1,581 SF startups did.']);
    const copy = await page.locator('body').innerText();
    assert.ok(copy.trim().split(/\s+/).length < 450);
    assert.doesNotMatch(await page.content(), /raised|funding|Form D|\$[0-9]/i);
    assert.equal(await page.locator('[download]').count(), 0);
    const headings = await page.locator('h2').allTextContents();
    assert.deepEqual(headings, ['The top 3', 'The top 10 endings', 'Why not .com?',
      'It works on other endings too', '.ai over time', 'Behind the dot',
      'How to choose', 'Check a name', 'Method and sources']);
    assert.equal(await page.locator('footer p').textContent(),
      "Not affiliated with Y Combinator. Data from YC's public directory.");
    const first = data.batches[0];
    await page.getByRole('button', { name: new RegExp('^' + first.batch) }).click();
    assert.equal(await page.locator('#batch-select').inputValue(), first.batch);
    await page.getByText('All endings in this batch', { exact: true }).click();
    assert.equal(await page.locator('caption').innerText(), first.batch);
    assert.equal(await page.locator('.batch-details tbody tr').count(), Object.keys(first.endings).length);
    await page.locator('#batch-select').selectOption(data.batches[1].batch);
    assert.equal(await page.locator('.column[aria-pressed=true]').getAttribute('data-batch'), data.batches[1].batch);
    await page.getByRole('link', { name: 'Check a name' }).click();
    await page.getByLabel('Name or domain').fill('example');
    await page.getByRole('button', { name: 'Check endings' }).click();
    await page.locator('#matches li').filter({ hasText: 'Taken' }).waitFor();
    assert.deepEqual(checked, ['example']);
    await page.getByLabel('Name or domain').fill('test-throttle');
    await page.getByRole('button', { name: 'Check endings' }).click();
    await page.getByText('Too many checks. Try again in a few minutes.').waitFor();
    assert.equal(await page.locator('#matches li').count(), 0);
    await page.getByLabel('Name or domain').fill('example');
    await page.getByRole('button', { name: 'Check endings' }).click();
    await page.locator('#matches li').filter({ hasText: 'Taken' }).waitFor();
    assert.deepEqual(checked, ['example', 'test-throttle', 'example']);
    assert.equal(page.url(), site + '/sf/#check');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.equal(requests.filter(url => url.origin === site && url.search).length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('each non-.com startup has one matching registration check and contributes once', () => {
  const observations = require('../data/sf/com-taken.json');
  const expected = companies.filter(row => row.ending !== '.com');
  const byId = new Map(observations.map(row => [row.id, row]));
  assert.equal(byId.size, observations.length);
  assert.equal(byId.size, expected.length);
  for (const startup of expected) {
    const row = byId.get(startup.id);
    assert.equal(row.com, startup.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com');
    assert.equal(row.listed_domain, startup.domain);
    assert.ok(['registered', 'unregistered'].includes(row.registration));
    if (row.registration === 'unregistered') assert.equal(row.redirect_to_startup, 'unregistered');
    else assert.ok(row.probes.length >= 1);
    if (row.redirect_to_startup === 'redirect') {
      assert.ok(row.probes.some(probe => probe.result === 'redirect' && probe.target === startup.domain));
    }
  }
  const registered = observations.filter(row => row.registration === 'registered').length;
  const html = require('node:fs').readFileSync(path.join(__dirname, '../sf/index.html'), 'utf8');
  assert.ok(html.includes('>' + Math.round(100 * registered / expected.length) + '%</strong>'));
  assert.ok(html.includes(registered + ' of ' + expected.length));
});

test('examples identify three listed companies for each requested ending', () => {
  const examples = require('../data/sf/examples.json');
  const byId = new Map(companies.map(row => [row.id, row]));
  assert.deepEqual(Object.keys(examples), ['.ai', '.io', '.dev', '.co', '.so']);
  for (const [ending, rows] of Object.entries(examples)) {
    assert.equal(new Set(rows.map(row => row.id)).size, 3);
    rows.forEach(row => assert.equal(byId.get(row.id).ending, ending));
  }
});

test('the portable preview works from disk with the network off', async () => {
  const { execFileSync } = require('node:child_process');
  const { pathToFileURL } = require('node:url');
  const output = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sf-preview-'));
  const browser = await webkit.launch({ headless: true });
  try {
    execFileSync(process.execPath, [path.join(__dirname, '../scripts/sf/artifact.cjs'), output]);
    const page = await browser.newPage({ offline: true, viewport: { width: 320, height: 844 } });
    const external = [];
    page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
    await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
    await page.locator('.batch-details summary').click();
    assert.ok((await page.locator('body').innerText()).trim().split(/\s+/).length < 450);
    await page.locator('#batch-select').selectOption(data.batches[0].batch);
    assert.equal(await page.locator('caption').textContent(), data.batches[0].batch);
    await page.getByLabel('Name or domain in this directory').fill('Campfire');
    await page.getByRole('button', { name: 'Look up name' }).click();
    assert.equal(await page.locator('#matches b').textContent(), 'campfire.ai');
    await page.addStyleTag({ content: ':root {font-size:200%}' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
    await fs.rm(output, { recursive: true, force: true });
  }
});
