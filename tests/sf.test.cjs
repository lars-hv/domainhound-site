const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { webkit } = require('playwright-core');
const data = require('../data/sf/endings.json');

test('all four choices, endings and hand-check reconcile to the snapshot', () => {
  assert.equal(data.eligible_companies - data.excluded_websites, data.websites);
  assert.equal(Object.values(data.endings).reduce((a, b) => a + b, 0), data.websites);
  let com = 0, ai = 0, sites = 0;
  for (const batch of data.batches) {
    assert.deepEqual(Object.keys(batch.choices).sort(), ['differentCom', 'differentOther', 'exactCom', 'exactOther']);
    assert.equal(Object.values(batch.choices).reduce((a, b) => a + b, 0), batch.websites);
    com += batch.choices.differentCom + batch.choices.exactCom;
    ai += batch.ai;
    sites += batch.websites;
  }
  assert.deepEqual([com, ai, sites], [data.endings['.com'], data.endings['.ai'], data.websites]);
  assert.equal(data.audit.sample, 50);
  assert.ok(data.audit.errors >= 0 && data.audit.errors <= data.audit.sample);
});

test('select and share each batch, check a name and offer only its taken .com', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const origin = 'https://domainhound.dev';
    const errors = [];
    const checked = [];
    let response = 'taken';
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { navigator.share = async payload => { window.shared = payload; }; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        const asset = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        const contentType = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css',
          '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(asset)];
        return route.fulfill({ body: await fs.readFile(path.join(__dirname, '..', asset)), contentType });
      }
      assert.equal(url.pathname, '/v1/check');
      const label = url.searchParams.get('name');
      checked.push(label);
      if (response === 'error') return route.fulfill({ status: 429 });
      return route.fulfill({ json: { domains: [{ domain: label + '.com', status: response },
        { domain: label + '.ai', status: 'taken' }] } });
    });
    const first = data.batches[0].batch;
    const latest = data.batches.at(-1).batch;
    const select = page.getByLabel('YC batch');
    await page.goto(origin + '/sf/');
    assert.equal(await select.inputValue(), latest);
    for (const batch of data.batches) {
      await select.selectOption(batch.batch);
      const active = page.locator('[data-batch]:visible');
      assert.equal(await active.getAttribute('data-batch'), batch.batch);
      assert.deepEqual(await active.locator('li b').allTextContents(), Object.values(batch.choices).map(String));
      assert.match(await active.locator('.sites').textContent(), new RegExp('^' + batch.websites + ' '));
    }
    await select.selectOption(first);
    await page.reload();
    assert.equal(await select.inputValue(), first);
    await select.selectOption(latest);
    await page.goBack();
    assert.equal(await select.inputValue(), first);
    await page.getByLabel('Startup name').fill('Example.ai');
    await page.locator('#share').click();
    const shared = new URL(await page.evaluate(() => window.shared.url));
    assert.deepEqual([...shared.searchParams], [['batch', first]]);
    const submit = page.locator('#check-form button');
    await submit.click();
    const watch = page.getByRole('link', { name: 'Watch the exact .com' });
    await watch.waitFor();
    assert.equal(await watch.getAttribute('href'), 'https://domainhound.dev/watch/?domain=example.com');
    assert.deepEqual(checked, ['example']);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.ok(!page.url().includes('Example'));
    response = 'unknown';
    await submit.click();
    await page.getByText('Unconfirmed', { exact: false }).waitFor();
    assert.equal(await watch.count(), 0);
    response = 'error';
    await submit.click();
    await page.getByText(/Too many checks/).waitFor();
    assert.equal(await page.locator('#matches li').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('portable artifact resolves nested assets and reads both registries without claiming availability on a 404', async () => {
  const { tmpdir } = require('node:os');
  const { execFileSync } = require('node:child_process');
  const output = await fs.mkdtemp(path.join(tmpdir(), 'sf-artifact-'));
  const browser = await webkit.launch({ headless: true });
  try {
    execFileSync('python3', [path.join(__dirname, '../scripts/sf/artifact.py'), output]);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'https://preview.example/artifacts/sf/';
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(base)) {
        const name = new URL(url).pathname.slice(new URL(base).pathname.length) || 'index.html';
        const type = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css',
          '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(name)];
        return route.fulfill({ body: await fs.readFile(path.join(output, name)), contentType: type });
      }
      if (url === 'https://rdap.verisign.com/com/v1/domain/example.com') {
        return route.fulfill({ json: { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' } });
      }
      assert.equal(url, 'https://rdap.identitydigital.services/rdap/domain/example.ai');
      return route.fulfill({ status: 404, json: { errorCode: 404 } });
    });
    await page.goto(base);
    assert.equal(await page.title(), 'SF Startup Domains');
    await page.getByLabel('Startup name').fill('Example');
    await page.locator('#check-form button').click();
    await page.getByText('Live registry results').waitFor();
    assert.match(await page.locator('#matches').innerText(), /example.ai\s+No registry record/);
    assert.ok(await page.locator('#watch-link').isVisible());
    await page.getByLabel('Startup name').fill('Another name');
    assert.equal(await page.locator('#matches li').count(), 0);
    assert.ok(await page.locator('#watch-link').isHidden());
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await fs.rm(output, { recursive: true, force: true });
  }
});
