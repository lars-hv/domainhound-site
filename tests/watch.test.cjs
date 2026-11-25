const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const site = 'https://site.invalid';
const checks = readFileSync(path.join(__dirname, 'watch-browser.js'), 'utf8');
let browser;

before(async () => { browser = await webkit.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function withLocalSite(width, check) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    serviceWorkers: 'block'
  });
  try {
    const unexpected = [];
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== site || request.method() !== 'GET') {
        unexpected.push(request.method() + ' ' + url.href);
        return route.abort();
      }
      const local = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      return route.fulfill({ path: path.join(root, local) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => unexpected.push(error.message));
    await check(page);
    assert.deepEqual(unexpected, []);
  } finally {
    await context.close();
  }
}

for (const width of [390, 1440]) {
  for (const dedicated of [false, true]) {
    test(`${dedicated ? '/watch/' : '/'} signup at ${width}px`, async () => {
      await withLocalSite(width, async page => {
        const target = dedicated ? '/watch/?domain=B%C3%9CCHER.com' : '/?domain=%3Cinvalid%3E';
        await page.goto(site + target + '&email=ignored%40example.com&name=Ignored&news=yes');
        await page.addScriptTag({ content: checks });
        await page.evaluate(options => checkWatch(options), { dedicated, width });
        await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
        assert.equal(new URL(page.url()).hash, '#watch');
        assert.equal(await page.locator(':target').innerText(), 'Domain watch alerts');
        assert.match(await page.locator('section[aria-labelledby="watch"]').innerText(), /delete unconfirmed sign-ups after 7 days/i);
        assert.match(await page.locator('section[aria-labelledby="news"]').innerText(), /address hash on our do-not-send list/i);
      });
    });
  }

  test(`/land/ request at ${width}px`, () => withLocalSite(width, async page => {
    await page.goto(site + '/land/?d=B%C3%9CCHER.com&email=ignored%40example.com&name=Ignored&note=Ignored&news=yes');
    const domain = page.locator('#land-domain');
    const email = page.locator('#land-email');
    const name = page.locator('#land-name');
    const note = page.locator('#land-note');
    const news = page.locator('#land-news');
    const submit = page.locator('#land button[type="submit"]');
    const status = page.getByRole('status');
    assert.equal(await domain.inputValue(), 'xn--bcher-kva.com');
    for (const field of [email, name, note]) assert.equal(await field.inputValue(), '');
    assert.equal(await note.getAttribute('required'), null);
    assert.equal(await news.isChecked(), false);
    assert.equal(await news.getAttribute('required'), null);
    assert.equal(await news.evaluate(input => input.labels[0].textContent.trim()),
      'Yes, email me news about Domain Hound and other developer tools from BrightBoard AS. At most twice a month. Unsubscribe any time.');
    assert.equal(await page.locator('#land').evaluate(form => [...new FormData(form)].length), 0);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const button = await submit.boundingBox();
    assert.ok(button.height >= 44 && button.y + button.height <= (width === 390 ? 844 : 900));

    await page.evaluate(() => {
      window.calls = [];
      window.fetch = async (url, options) => {
        window.calls.push({ url, method: options.method, credentials: options.credentials, payload: JSON.parse(options.body) });
        return window.calls.length === 1
          ? new Response('{}', { status: 429 })
          : new Response('{"ok":true}', { status: 202 });
      };
    });
    await submit.click();
    await status.filter({ hasText: 'Enter a valid email address.' }).waitFor();
    assert.equal(await email.getAttribute('aria-invalid'), 'true');
    await email.fill('reader@example.com');
    await note.evaluate(input => { input.value = 'x'.repeat(501); });
    await submit.click();
    await status.filter({ hasText: 'Use 500 characters or fewer' }).waitFor();
    assert.equal(await note.getAttribute('aria-invalid'), 'true');
    await note.fill('');
    await submit.click();
    await status.filter({ hasText: 'Too many tries.' }).waitFor();
    assert.equal(await email.inputValue(), 'reader@example.com');
    await name.fill('  Example Reader  ');
    await note.fill('  It’s the domain for my new app.  ');
    await news.check();
    await submit.click();
    await status.filter({ hasText: 'Check your inbox to confirm.' }).waitFor();
    const payload = { domain: 'xn--bcher-kva.com', email: 'reader@example.com', source: 'site', website: '' };
    const request = { url: 'https://domainhound-alerts.domainhound.workers.dev/v1/landed', method: 'POST', credentials: 'omit' };
    assert.deepEqual(await page.evaluate(() => window.calls), [
      { ...request, payload },
      { ...request, payload: { ...payload, name: 'Example Reader', note: 'It’s the domain for my new app.', news: 'yes' } }
    ]);
    for (const field of [email, name, note]) assert.equal(await field.inputValue(), '');
    assert.equal(await news.isChecked(), false);
    await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
    assert.equal(new URL(page.url()).hash, '#land-requests');
    assert.match(await page.locator(':target').innerText(), /(?:12|twelve) months/i);
  }));
}
