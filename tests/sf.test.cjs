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
      const exact = name.endsWith('.si');
      const ascii = name.split('.')[0];
      return route.fulfill({ json: {
        query: { ascii, exactDomain: exact ? name : null },
        domains: [{ domain: exact ? name : ascii + '.com', ending: exact ? 'si' : 'com', status: 'taken' }],
      } });
    });
    await page.goto(site + '/sf/');
    const trend = page.locator('.ai-trend');
    const trendRows = data.batches.map(row => {
      const ai = row.endings['.ai']?.count ?? 0;
      return [row.batch, `${Number((100 * ai / row.websites).toFixed(1))}%`, row.websites];
    });
    assert.deepEqual(await trend.locator('.trend-row').evaluateAll(rows => rows.map(row => [
      row.firstElementChild.textContent, row.querySelector('b').textContent,
      Number(row.querySelector('.trend-size').firstChild.textContent.replaceAll(',', '')),
    ])), trendRows);
    const trendNote = await trend.locator('.chart-note').innerText();
    const aiCount = row => row.endings['.ai']?.count ?? 0;
    const peak = data.batches.reduce((best, row) =>
      aiCount(row) * best.websites > aiCount(best) * row.websites ? row : best);
    for (const row of [peak, data.batches.at(-1)]) {
      assert.ok(trendNote.includes(row.batch));
      assert.ok(trendNote.includes(`(${aiCount(row).toLocaleString('en-US')} of ${row.websites.toLocaleString('en-US')} sites)`));
    }
    const body = page.locator('#company-table tbody tr');
    const more = page.getByRole('button', { name: 'Show all', exact: true });
    await more.waitFor();
    assert.equal(await body.count(), 50);
    const funded = companies.filter(row => row.funding);
    const highest = Math.max(...funded.map(row => row.funding.sold));
    assert.equal(await body.first().locator('.amount').innerText(), '$' + highest.toLocaleString('en-US'));
    await more.click();
    assert.equal(await body.count(), data.websites);
    await page.locator('#funding-sort').selectOption('funding:asc');
    const lowest = Math.min(...funded.map(row => row.funding.sold));
    assert.equal(await body.first().locator('.amount').innerText(), '$' + lowest.toLocaleString('en-US'));
    if (funded.length < companies.length) assert.equal(await body.last().locator('.amount').innerText(), 'No match');
    await page.getByRole('button', { name: 'Show 50' }).click();
    assert.equal(await body.count(), 50);
    const first = data.batches[0];
    await page.getByRole('button', { name: new RegExp('^' + first.batch) }).click();
    assert.equal(await page.locator('#batch-select').inputValue(), first.batch);
    await page.getByText('All endings in this batch', { exact: true }).click();
    assert.equal(await page.locator('caption').innerText(), first.batch);
    assert.equal(await page.locator('.batch-details tbody tr').count(), Object.keys(first.endings).length);
    await page.locator('#batch-select').selectOption(data.batches[1].batch);
    assert.equal(await page.locator('.column[aria-pressed=true]').getAttribute('data-batch'), data.batches[1].batch);
    assert.equal(await page.locator('#weekly').isVisible(), false);
    await page.getByRole('link', { name: 'Check a name' }).click();
    const forms = page.locator('.name-check');
    assert.equal(await forms.count(), 2);
    for (const [i, name] of ['example', 'secondexample'].entries()) {
      const form = forms.nth(i);
      await form.getByLabel('Name or domain').fill(name);
      await form.getByRole('button', { name: 'Check endings' }).click();
      await form.getByText(name + '.si', { exact: true }).waitFor();
      assert.deepEqual(await form.locator('.matches b').allTextContents(), [name + '.com', name + '.si']);
    }
    assert.deepEqual(checked, ['example', 'example.si', 'secondexample', 'secondexample.si']);
    assert.equal(page.url(), site + '/sf/#check');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.equal(requests.filter(url => url.origin === site && url.search).length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('company table reconciles to the chart and to distinct SEC offerings', () => {
  assert.equal(new Set(companies.map(row => row.id)).size, data.websites);
  const counts = {};
  const issuers = new Set();
  for (const row of companies) {
    counts[row.batch] ??= {};
    counts[row.batch][row.ending] = (counts[row.batch][row.ending] || 0) + 1;
    const brandCom = row.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    if (row.has_com) {
      if (row.com_redirect) {
        assert.deepEqual(new Set([row.com_redirect.from_host, row.com_redirect.to_host]), new Set([row.domain, brandCom]));
      } else {
        assert.ok(row.domain === brandCom || row.domain.endsWith('.' + brandCom));
      }
    } else {
      assert.equal(row.has_com, null);
    }
    if (!row.funding) continue;
    const { cik, filings, sold, latest_filing } = row.funding;
    assert.match(cik, /^\d{10}$/);
    assert.ok(!issuers.has(cik));
    issuers.add(cik);
    assert.equal(latest_filing, filings.map(f => f.date).sort().at(-1));
    const latest = new Map();
    for (const f of filings) {
      assert.match(f.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
      latest.set(f.file_number, f.sold);
    }
    assert.equal(sold, [...latest.values()].reduce((a, b) => a + b, 0));
  }
  for (const batch of data.batches) {
    assert.deepEqual(counts[batch.batch], Object.fromEntries(Object.entries(batch.endings).map(([k, v]) => [k, v.count])));
  }
});
