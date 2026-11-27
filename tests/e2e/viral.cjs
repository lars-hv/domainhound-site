// Set VOTE_WORKER_URL to the companion local Worker's origin and its DH_VOTE_SITE to http://localhost:47991.
// Only search answers are fixtures. Link creation, image generation, voting and tally reads reach workerd.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { webkit } = require('playwright-core');

const api = new URL(process.env.VOTE_WORKER_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(api.hostname));
const site = 'http://localhost:47991';
const root = path.resolve(__dirname, '../..');
const output = process.env.VOTE_SCREENSHOTS;
let browser;
before(async () => { browser = await webkit.launch(); });
after(async () => { await browser?.close(); });

const checkedAt = '2026-11-25T12:00:00.000Z';
const name = 'Mapfern';
const domain = 'mapfern.example.com';
const quote = { shop: 'Gandi', firstYearUsd: 8, renewalUsd: 12, minimumYears: 1, firstPaymentUsd: 8, renewalPaymentUsd: 12,
  threeYearUsd: 32, buyUrl: 'https://shop.example/mapfern', checkedAt };
const lookup = { query: { name, ascii: 'mapfern', exactDomain: null }, checkedAt, complete: true,
  domains: [{ domain, ending: 'com', evidence: 'rdap-404', checkedAt, status: 'available', priceShown: true, prices: [quote] }],
  choice: { pick: { domain, ...quote }, capUsd: 60 }, details: null, appStore: { status: 'no_match_found' },
  googlePlay: { status: 'no_match_found' }, trademarks: { us: { status: 'no_exact_match_found' } } };
const receipt = '#2.' + deflateSync(JSON.stringify([checkedAt, [
  ['Mapfern', 1, '', [['mapfern.example.com', 0, 800, 1200, 1]], { p: 0 }],
  ['Trailfin', 2, '', [['trailfin.example.org', 0, 650, 1500, 1]], { p: 0 }],
]])).toString('base64url');

async function context(t, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
  ctx.setDefaultTimeout(5000);
  // Keep test copies off the system clipboard.
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
    async writeText(url) { window.copiedLink = url; },
    async write(items) { window.copiedLink = await (await items[0].getType('text/plain')).text(); }
  } }));
  const errors = [];
  t.after(async () => { await ctx.close(); assert.deepEqual(errors, []); });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === api.origin) {
      if (url.pathname === '/v1/check') return route.fulfill({ json: lookup, headers: { 'Access-Control-Allow-Origin': '*' } });
      if (url.pathname === '/v1/event') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.continue();
    }
    if (![site, 'https://domainhound.dev'].includes(url.origin)) throw new Error('Unexpected host ' + url.origin);
    const filename = path.join(root, url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
    if (filename.endsWith('.html')) {
      const body = readFileSync(filename, 'utf8').replaceAll('https://domainhound-mcp.domainhound.workers.dev', api.origin)
        .replace('<title>', '<meta name="domain-hound-api" content="' + api.origin + '"><title>');
      return route.fulfill({ contentType: 'text/html', body });
    }
    return route.fulfill({ path: filename, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return ctx;
}
async function shot(page, name, target = page) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await target.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled', ...(target === page && { fullPage: true }) });
}
for (const width of [390, 1440]) test('create, share, vote and revisit at ' + width, async t => {
  const owner = await context(t, width);
  const page = await owner.newPage();
  await page.goto(site);
  await page.locator('#name').fill(name);
  await page.locator('#name').press('Enter');
  await page.getByRole('button', { name: 'Ask a friend' }).waitFor();
  await shot(page, 'result-' + width, page.locator('#search-results'));
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedLink), site + '/');
  await page.getByRole('button', { name: 'Ask a friend' }).click();
  const tally = page.getByRole('link', { name: 'See tally' });
  const single = await tally.getAttribute('href');
  assert.match(await (await fetch(single.split('#')[0])).text(), /mapfern\.example\.com/);
  await page.goto(site + '/r/' + receipt);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await page.getByText('Link copied.', { exact: true }).waitFor();
  const shared = await page.evaluate(() => window.copiedLink);
  assert.ok(shared.startsWith(api.origin + '/v/') && shared.endsWith(receipt));
  await page.goto(shared);
  await page.getByRole('heading', { name: 'Trailfin' }).waitFor();
  await page.getByRole('button', { name: 'Ask a friend' }).click();
  const ownerUrl = await tally.getAttribute('href');
  const voteUrl = ownerUrl.split('#')[0];
  await page.getByRole('button', { name: 'Copy vote link' }).click();
  assert.equal(await page.evaluate(() => window.copiedLink), voteUrl);
  const other = await context(t, width);
  const voter = await other.newPage();
  await voter.goto(voteUrl);
  await voter.getByRole('button', { name: 'Vote for Trailfin' }).waitFor();
  assert.equal(await voter.locator('.vote:visible').count(), 3);
  assert.equal(await voter.locator('.count:visible').count(), 0);
  assert.equal(await voter.locator('html').evaluate(el => el.scrollWidth <= innerWidth), true);
  await shot(voter, 'vote-' + width);
  const imageUrl = voteUrl + '/card.png';
  for (const bot of ['Twitterbot', 'LinkedInBot', 'Slackbot-LinkExpanding']) {
    const res = await fetch(voteUrl, { headers: { 'User-Agent': bot } });
    const html = await res.text();
    for (const [tag, value] of [['og:title', 'Help me choose. Mapfern / Trailfin'], ['og:url', voteUrl],
      ['og:image', imageUrl], ['twitter:card', 'summary_large_image'], ['twitter:image', imageUrl]]) {
      assert.ok(html.includes('="' + tag + '" content="' + value + '"'), tag);
    }
  }
  const image = await fetch(imageUrl);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1200, 630]);
  assert.ok(bytes.length < 5000000);
  if (output) writeFileSync(path.join(output, 'share-card.png'), bytes);
  const cardPage = await other.newPage();
  await cardPage.goto(imageUrl);
  await shot(cardPage, 'share-card-' + width, cardPage.locator('img'));
  await page.goto(ownerUrl);
  await page.getByRole('button', { name: 'Refresh tally' }).waitFor();
  assert.deepEqual(await page.locator('.count').allTextContents(), ['0 votes', '0 votes', '0 votes']);
  await voter.getByRole('button', { name: 'Vote for Trailfin' }).click();
  await voter.getByText('Thanks for voting.').waitFor();
  await voter.reload();
  await voter.getByText('Thanks for voting.').waitFor();
  assert.equal(await voter.locator('.vote:visible').count(), 0);
  await page.getByRole('button', { name: 'Refresh tally' }).click();
  await page.getByText('1 vote', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.count').allTextContents(), ['0 votes', '1 vote', '0 votes']);
  await shot(page, 'tally-' + width);
  assert.deepEqual(await other.cookies(), []);
  await voter.locator('#own-name').fill(name);
  await voter.getByRole('button', { name: 'Check name' }).click();
  await voter.locator('.best-domain').waitFor();
  assert.equal(await voter.locator('#name').inputValue(), name);
});
