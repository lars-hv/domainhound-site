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

for (const width of [390, 1440]) {
  for (const dedicated of [false, true]) {
    test(`${dedicated ? '/watch/' : '/'} signup at ${width}px`, async () => {
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
        const target = dedicated ? '/watch/?domain=B%C3%9CCHER.com' : '/?domain=%3Cinvalid%3E';
        await page.goto(site + target + '&email=ignored%40example.com&name=Ignored&news=yes');
        await page.addScriptTag({ content: checks });
        await page.evaluate(options => checkWatch(options), { dedicated, width });
        await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
        assert.equal(new URL(page.url()).hash, '#watch');
        assert.equal(await page.locator(':target').innerText(), 'Domain watch alerts');
        assert.match(await page.locator('section[aria-labelledby="watch"]').innerText(), /delete unconfirmed sign-ups after 7 days/i);
        assert.match(await page.locator('section[aria-labelledby="news"]').innerText(), /address hash on our do-not-send list/i);
        assert.deepEqual(unexpected, []);
      } finally {
        await context.close();
      }
    });
  }
}
