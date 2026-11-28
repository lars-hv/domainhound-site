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

test('SF rankings and all 13 batch details render the rounded snapshot', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const site = 'https://site.example';
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(site + '/**', route => {
      const file = new URL(route.request().url()).pathname;
      return route.fulfill({ path: path.join(__dirname, '..', file.endsWith('/') ? file + 'index.html' : file) });
    });
    await page.goto(site + '/sf/');
    const entries = Object.entries(data.endings).slice(0, 10);
    assert.deepEqual(await page.locator('#ranking .ending').allTextContents(), entries.map(([ending]) => ending));
    assert.deepEqual(await page.locator('#ranking .share').allTextContents(),
      ['46%', '30%', '3.8%', '3.5%', '2.4%', '1.3%', '1.2%', '1.1%', '0.8%', '0.7%']);
    assert.deepEqual(await page.locator('#leaders .count').allTextContents(),
      ['· 733 startups ·', '· 479 startups ·', '· 60 startups ·']);
    assert.deepEqual(await page.locator('#leaders .share').allTextContents(), ['46%', '30%', '3.8%']);
    assert.deepEqual(await page.locator('h1 span').allTextContents(),
      ['Your .com is taken.', 'Here’s what 1,581 SF startups did.']);
    assert.doesNotMatch(await page.content(), /raised|funding|Form D/i);
    assert.equal(await page.locator('[download]').count(), 0);
    assert.deepEqual(await page.locator('h2').allTextContents(), ['The top 3', 'Why they skipped it',
      'The top 10 endings', 'Real startups, other endings', '.ai is rising', 'Behind the dot',
      'How to choose', 'Check your name', 'Method']);
    assert.equal(await page.locator('footer p').textContent(),
      "Not affiliated with Y Combinator. Data from YC's public directory. · Privacy");
    const rows = page.locator('.batch-details tbody tr');
    const select = page.locator('#batch-select');
    const verify = async batch => {
      const endings = Object.entries(batch.endings).sort((a, b) =>
        b[1].count - a[1].count || a[0].localeCompare(b[0]));
      assert.equal(await select.inputValue(), batch.batch);
      assert.equal(await page.locator('.column[aria-pressed=true]').getAttribute('data-batch'), batch.batch);
      assert.deepEqual(await rows.locator('th').allTextContents(), endings.slice(0, 5).map(([ending]) => ending));
      const shares = endings.slice(0, 5).map(([, { count }]) => {
        const pct = count / batch.websites * 100;
        return pct.toFixed(pct >= 10 ? 0 : 1) + '%';
      });
      assert.deepEqual(await rows.locator('td').allTextContents(), [...shares, `+${endings.length - 5} other endings`]);
    };
    await verify(data.batches.at(-1));
    for (const batch of data.batches) {
      await select.selectOption(batch.batch);
      await verify(batch);
    }
    const first = data.batches[0];
    await page.getByRole('button', { name: new RegExp('^' + first.batch) }).click();
    await verify(first);
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
  assert.ok(html.includes(`For ${registered} of the ${expected.length} startups on other endings`));
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
    const context = await browser.newContext({ offline: true, viewport: { width: 320, height: 844 } });
    const page = await context.newPage();
    const external = [];
    context.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
    await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
    await page.locator('#batch-select').selectOption(data.batches[0].batch);
    assert.equal(await page.locator('.batch-details tr').last().innerText(), '+12 other endings');
    await page.addStyleTag({ content: ':root {font-size:200%}' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    assert.deepEqual(external, []);
    const field = page.getByRole('textbox', { name: 'Check your name' });
    await field.fill('   ');
    assert.equal(await field.evaluate(node => node.checkValidity()), false);
    await field.fill('  Example & Co  ');
    await context.setOffline(false);
    await context.route('https://domainhound.dev/?*', route => route.fulfill({ body: 'Checker' }));
    const [popup] = await Promise.all([
      context.waitForEvent('page'), page.getByRole('button', { name: 'Check my name' }).click()
    ]);
    await popup.waitForLoadState();
    const url = new URL(popup.url());
    assert.equal(url.origin + url.pathname, 'https://domainhound.dev/');
    assert.deepEqual([...url.searchParams], [['q', 'Example & Co']]);
    assert.equal(await popup.evaluate(() => window.opener), null);
    assert.equal(page.url(), pathToFileURL(path.join(output, 'index.html')).href);
  } finally {
    await browser.close();
    await fs.rm(output, { recursive: true, force: true });
  }
});
