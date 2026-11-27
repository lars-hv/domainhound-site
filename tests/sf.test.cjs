const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { webkit } = require('playwright-core');
const data = require('../data/sf/endings.json');

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
      checked.push(url.searchParams.get('name'));
      return route.fulfill({ json: { domains: [{ domain: 'example.com', status: 'taken' }] } });
    });
    await page.goto(site + '/sf/');
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
    await page.getByLabel('Name or domain').fill('example');
    await page.getByRole('button', { name: 'Check endings' }).click();
    await page.getByText('Taken', { exact: false }).waitFor();
    assert.deepEqual(checked, ['example']);
    assert.equal(page.url(), site + '/sf/#check');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.equal(requests.filter(url => url.origin === site && url.search).length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
