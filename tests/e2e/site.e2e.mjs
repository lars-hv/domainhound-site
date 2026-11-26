import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWatchWorker, watchOrigin } from './watch-worker.mjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const site = new URL(process.env.SITE_BASE || 'http://127.0.0.1:8798');
const api = new URL(process.env.API_BASE || 'http://127.0.0.1:8797');
const publishedOrigin = 'https://domainhound.dev';
const publishedApi = 'https://domainhound-mcp.domainhound.workers.dev';
const isLoopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const preview = isLoopback(site) && isLoopback(api);
const engines = (process.env.E2E_ENGINES || 'webkit,chromium').split(',');
const widths = (process.env.E2E_WIDTHS || '390,1440').split(',').map(Number);
const screenshots = process.env.SCREENSHOT_DIR;
const platformHosts = {
  'App Store': ['apps.apple.com'], 'Google Play': ['play.google.com'], LinkedIn: ['linkedin.com'],
  X: ['x.com', 'twitter.com'], Instagram: ['instagram.com'], Threads: ['threads.com', 'threads.net'],
  TikTok: ['tiktok.com'], YouTube: ['youtube.com'], GitHub: ['github.com'], Facebook: ['facebook.com'],
  Twitch: ['twitch.tv'], Reddit: ['reddit.com']
};
const shops = {
  Spaceship: ['www.spaceship.com', 'query'], Porkbun: ['porkbun.com', 'q'],
  Namecheap: ['www.namecheap.com', 'domain'], Dynadot: ['www.dynadot.com', 'domain'],
  Cloudflare: ['www.cloudflare.com', 'q'], Gandi: ['shop.gandi.net', 'search']
};
const installText = {
  'Claude Code': 'claude mcp add domain-hound -- npx -y domain-hound',
  Codex: 'codex mcp add domain-hound -- npx -y domain-hound',
  ChatGPT: publishedApi + '/mcp',
  'Other MCP': '{"mcpServers":{"domain-hound":{"command":"npx","args":["-y","domain-hound"]}}}'
};
const idea = 'an app that fixes delayed flights';
const allTaken = 'qaorchidfern';
const fixtureName = 'qaorbitfern';
const checksName = 'qacheckfern';
const checksId = 'qachecks';
const variants = ['get' + allTaken, 'try' + allTaken, allTaken + 'hq', allTaken + 'app'];
const missingPath = '/__site-qa-page-that-does-not-exist__/';
const unique = randomBytes(3).toString('hex');
const name = Array.from({ length: 18 }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(26)]).join('');
const results = [];

function exact(text) {
  return { name: text, exact: true };
}

function catalogRow(domain, status, prices = []) {
  return { domain, status, checkedAt: new Date().toISOString(), evidence: status === 'taken' ? 'dns-ns' : 'rdap-404',
    priceShown: prices.length > 0, prices };
}

function fixtureReply(request, detailsAttempts) {
  const url = new URL(request.url());
  const queried = url.searchParams.get('name');
  if (url.pathname === '/v1/check' && [allTaken + '.ai', allTaken, fixtureName, checksName, ...variants].includes(queried)) {
    const exactDomain = queried.includes('.') ? queried : null;
    const label = queried.split('.')[0];
    const endings = exactDomain ? ['ai'] : label === allTaken ? ['com', 'ai', 'io', 'dev', 'app'] : ['com'];
    const taken = label === allTaken || variants.slice(1).includes(label);
    const domains = endings.map(ending => {
      const domain = label + '.' + ending;
      return catalogRow(domain, taken ? 'taken' : 'available', taken ? [] : [fixturePrice(domain)]);
    });
    return { query: { name: label, ascii: label, exactDomain }, complete: true, domains,
      choice: label === variants[0] ? { pick: { domain: domains[0].domain, ...domains[0].prices[0] } } : undefined,
      details: label === checksName ? { path: '/v1/check/details?id=' + checksId } : undefined };
  }
  if (url.pathname === '/v1/check/details' && url.searchParams.get('id') === checksId) {
    const complete = detailsAttempts > 0;
    return { name: checksName, complete, appStore: { status: complete ? 'taken' : 'unknown' },
      trademarks: { us: complete ? { status: 'exact_match_found', marks: [] } : { status: 'unknown' } } };
  }
  if (url.pathname !== '/v1/generate' || request.method() !== 'POST') return null;
  const body = request.postDataJSON();
  if (body.idea !== 'names like ' + allTaken && !(body.idea === idea && body.round === 2)) return null;
  const domain = fixtureName + '.com';
  const prices = [fixturePrice(domain)];
  return { stage: 'final', complete: true, names: [{
    name: fixtureName, domain: { domain, prices }, domains: [catalogRow(domain, 'available', prices)],
    score: { total: 80, band: 'Strong', reasons: ['Confirmed .com availability'] }
  }] };
}

function fixturePrice(domain) {
  return { shop: 'Spaceship', firstYearUsd: 6, renewalUsd: 12, minimumYears: 1,
    firstPaymentUsd: 6, renewalPaymentUsd: 12, threeYearUsd: 30,
    buyUrl: 'https://www.spaceship.com/domain-search/?query=' + domain, checkedAt: new Date().toISOString() };
}

function safeAddress(input) {
  const url = new URL(input);
  return url.origin + url.pathname;
}

function assertShopLink(href, shop, domain) {
  const url = new URL(href);
  const [host, query] = shops[shop] || [];
  assert.equal(url.protocol, 'https:', href);
  assert.equal(url.host, host, shop + ' link for ' + domain);
  assert.equal(url.searchParams.get(query), domain, shop + ' link must carry the searched domain');
  assert.ok(!url.username && !url.password);
}

function expectedOutcome(title, data) {
  const row = title === 'App Store' ? data.appStore : title === 'Google Play' ? data.googlePlay
    : data.handles.find(handle => handle.platform === title);
  const state = row?.state || row?.status;
  if (state === 'taken' && Number.isInteger(row.seenYear)) return 'Found in ' + row.seenYear;
  if (['taken', 'exact_match_found'].includes(state)) return 'Taken';
  if (state === 'not-seen') return 'No page found in public archives';
  if (['not-found', 'no_match_found'].includes(state)) return title.endsWith('Store') || title === 'Google Play'
    ? 'No app found' : 'No profile found';
  return "Couldn't check";
}

async function runViewport(browser, engine, width, watchWorker) {
  const id = engine + '-' + width;
  const client = '2001:db8:' + unique.slice(0, 4) + ':';
  const caseGroup = unique.slice(4) + (engine === 'webkit' ? '1' : '2') + (width === 390 ? '1' : '2');
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    serviceWorkers: 'block', reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const field = page.locator('#name');
  const main = page.locator('.hunt-form[data-mode="auto"]');
  const region = page.locator('#search-results');
  const answer = region.locator('.results-head h2');
  const watchCalls = [];
  const traffic = [];
  const pending = new Set();
  const errors = [];
  const expectedFailures = new WeakSet();
  let offline = false;
  let expectedMissing = false;
  let takingScreenshot = false;
  let scenario = 0;
  let detailsAttempts = 0;
  let summary = 'setup';

  page.on('pageerror', error => errors.push(summary + ': ' + error.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    // Browsers also log failed resource loads as console errors.
    if (offline && /load resource|network|ERR_|offline/i.test(msg.text())) return;
    if (expectedMissing && /404|not found/i.test(msg.text())) return;
    // WebKit's screenshot helper inserts its own temporary style tag. The
    // share page correctly rejects it under its strict CSP.
    if (takingScreenshot && engine === 'webkit' && new URL(page.url()).pathname === '/r/' &&
      /Refused to apply a stylesheet.*style-src/.test(msg.text())) return;
    errors.push(summary + ': ' + msg.text());
  });
  page.on('requestfailed', request => {
    if (!expectedFailures.has(request)) {
      errors.push(summary + ': ' + request.failure().errorText + ' ' + safeAddress(request.url()));
    }
  });
  page.on('response', response => {
    if (response.status() >= 400 && !(expectedMissing && response.status() === 404 &&
      new URL(response.url()).pathname === missingPath)) {
      errors.push(summary + ': HTTP ' + response.status() + ' ' + safeAddress(response.url()));
    }
    const request = response.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v1/') || !response.ok() || request.method() === 'OPTIONS') return;
    const read = response.json().then(data => traffic.push({
      path: url.pathname, queried: url.searchParams.get('name'), body: request.postDataJSON(), data
    })).catch(error => errors.push(summary + ': ' + error.message));
    pending.add(read);
    void read.finally(() => pending.delete(read));
  });

  // Permit only the known API transports to make browser POSTs. A future form
  // endpoint change must never send the test signup to an external service.
  await context.route('**/*', route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fallback();
    errors.push('Unexpected browser mutation: ' + safeAddress(route.request().url()));
    return route.abort();
  });

  await context.route('**/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.ok([site.origin, api.origin, publishedApi].includes(url.origin), 'Unexpected search origin: ' + url.origin);
    if (offline && url.pathname === '/v1/check') {
      expectedFailures.add(request);
      return route.abort('internetdisconnected');
    }
    const fixture = fixtureReply(request, detailsAttempts);
    if (fixture) {
      if (fixture.name === checksName) detailsAttempts++;
      return route.fulfill({ json: fixture, headers: { 'access-control-allow-origin': site.origin } });
    }
    if (!preview) {
      assert.equal(url.origin, api.origin, 'The live page uses a different API_BASE');
      return route.continue();
    }
    // Keep separate local scenarios from spending each other's rate budgets.
    const headers = { origin: site.origin, 'cf-connecting-ip': client + (parseInt(caseGroup, 16) ^ scenario).toString(16) + '::1' };
    if (request.method() === 'POST') headers['content-type'] = 'application/json';
    const reply = await fetch(new URL(url.pathname + url.search, api), {
      method: request.method(), headers, body: request.postDataBuffer(), redirect: 'error'
    });
    assert.equal(reply.headers.get('access-control-allow-origin'), site.origin);
    return route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers),
      body: Buffer.from(await reply.arrayBuffer()) });
  });

  await context.route(watchOrigin + '/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataBuffer();
    if (request.method() === 'POST') {
      assert.equal(url.pathname, '/watch', 'Only the synthetic sign-up may POST');
      assert.equal(request.headers()['content-type'], 'application/json');
      const payload = request.postDataJSON();
      assert.match(payload.email, /^site-qa-[a-z\d-]+@example\.com$/);
      watchCalls.push(payload);
    } else {
      assert.equal(request.method(), 'GET');
      assert.equal(url.pathname, '/manage');
    }
    const headers = { ...request.headers(), origin: site.origin, 'cf-connecting-ip': client + caseGroup + '::1' };
    const reply = await watchWorker.fetch(url, { method: request.method(), headers, body });
    return route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers),
      body: Buffer.from(await reply.arrayBuffer()) });
  });
  if (preview) {
    // Keep the signed worker page's production asset URLs while serving the
    // matching checkout locally.
    await context.route(publishedOrigin + '/assets/**', async route => {
      const url = new URL(route.request().url());
      const reply = await context.request.get(new URL(url.pathname, site).href);
      return route.fulfill({ response: reply, headers: { ...reply.headers(), 'access-control-allow-origin': '*' } });
    });
  }

  // Clipboard permissions differ by engine. Exercise the real click and copy
  // payload, with a test destination so the user's clipboard is untouched.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async value => { window.__qaClipboard = value; } }
    });
  });

  async function check(label, run) {
    summary = label;
    scenario++;
    try {
      await run();
      results.push({ id, label, status: 'PASS' });
    } catch (error) {
      results.push({ id, label, status: 'FAIL' });
      console.error(id + ' ' + label + '\n' + error.stack);
    }
  }

  async function shot(state, target = page) {
    if (!screenshots) return;
    await mkdir(screenshots, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    takingScreenshot = true;
    try {
      await target.screenshot({ path: resolve(screenshots, id + '-' + state + '.png'), animations: 'disabled' });
    } finally {
      takingScreenshot = false;
    }
  }

  async function home() {
    await page.goto(site.href);
    await main.locator('button[type="submit"]:enabled').waitFor();
    await page.evaluate(() => document.fonts.ready);
  }

  async function submit(value, enter = false) {
    await field.fill(value);
    if (enter) await field.press('Enter');
    else await main.getByRole('button', exact('Find it here')).click();
  }

  async function sawHeading(text) {
    await answer.filter({ hasText: text }).waitFor();
    assert.equal(await answer.innerText(), text);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow in results');
  }

  async function getCall(match, from = 0) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const call = traffic.slice(from).find(match);
      if (call) return call;
      await page.waitForTimeout(100);
    }
    assert.fail('Expected API request was missing');
  }

  async function checkCards(card, data) {
    const offers = card.locator('.offer-row');
    assert.ok(await offers.count(), 'Expected available domains');
    const rows = await offers.all();
    let compared = 0;
    for (const offer of rows) {
      const domain = await offer.getAttribute('data-domain');
      const prices = data.domains.find(row => row.domain === domain).prices;
      const table = offer.getByRole('table');
      if (!prices.length) continue;
      const expand = offer.locator('.more-shops');
      const visibleShops = table.locator('tbody:visible tr');
      assert.equal(await visibleShops.count(), Math.min(3, prices.length), domain);
      if (prices.length > 3) {
        assert.match(await expand.innerText(), new RegExp('^\\+' + (prices.length - 3) + ' more shops?$'));
        await expand.click();
        assert.equal(await expand.getAttribute('aria-expanded'), 'true');
        assert.equal(await visibleShops.count(), prices.length);
        compared++;
      }
      const shown = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
        shop: row.querySelector('.shop-name').textContent,
        href: row.querySelector('.shop-name').getAttribute('href'),
        priceOnly: row.cells[0].textContent.includes('Price only'),
        total: Number(row.cells[3].textContent.replace(/[$,]/g, ''))
      })));
      assert.deepEqual(shown.map(shop => shop.total), prices.map(price => price.threeYearUsd).sort((a, b) => a - b));
      for (const row of shown) {
        const quote = prices.find(price => price.shop === row.shop);
        assert.equal(row.priceOnly, !quote.buyUrl, row.shop + ' Price only');
        assert.equal(row.href, quote.buyUrl);
        if (row.href) assertShopLink(row.href, row.shop, domain);
      }
      const buy = offer.locator(':scope > a.action');
      const best = shown.find(row => row.href);
      assert.equal(await buy.count(), best ? 1 : 0, domain + ' buy button');
      if (best) {
        assert.equal(await buy.getAttribute('href'), best.href);
        assertShopLink(best.href, best.shop, domain);
        const quote = prices.find(price => price.shop === best.shop);
        const warn = offer.locator('.renewal-warning');
        assert.equal(await warn.count(), Number(quote.renewalUsd > 3 * quote.firstYearUsd), domain + ' renewal rule');
        if (await warn.count()) assert.ok((await warn.innerText()).includes(best.shop));
      }
      if (prices.length > 3) {
        await expand.click();
        assert.equal(await expand.getAttribute('aria-expanded'), 'false');
        assert.equal(await visibleShops.count(), 3);
      }
    }
    assert.ok(compared, 'No expandable registrar table was exercised');
  }

  async function checkPanel(card, details) {
    const panel = card.locator('.detail-checks');
    for (const toggle of await card.locator('.checks-toggle').all()) {
      if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.click();
        assert.equal(await panel.isVisible(), false);
      }
      await toggle.click();
      await panel.waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await toggle.getAttribute('aria-controls'), await panel.getAttribute('id'));
      const rows = panel.locator('.check-line');
      assert.equal(await rows.count(), Object.keys(platformHosts).length);
      for (const [title, hosts] of Object.entries(platformHosts)) {
        const line = rows.filter({ has: page.getByText(title, { exact: true }) });
        await line.waitFor();
        const action = line.locator('a');
        assert.equal(await action.innerText(), expectedOutcome(title, details), title);
        const url = new URL(await action.getAttribute('href'));
        assert.equal(url.protocol, 'https:');
        assert.ok(hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host)), title + ' link: ' + url);
      }
      await toggle.click();
      assert.equal(await panel.isVisible(), false);
    }
    assert.doesNotMatch(await card.textContent(), /Check yourself/i);
  }

  try {
    await check('Home and input validation', async () => {
      await home();
      assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
      await shot('home');
      const before = traffic.length;
      await main.getByRole('button', exact('Find it here')).click();
      assert.ok(await field.evaluate(input => input.validity.valueMissing && input.validationMessage));
      assert.equal(await region.isVisible(), false);
      await submit('bad..com', true);
      await main.getByText(/Enter a name or a domain/).waitFor();
      assert.equal(await field.getAttribute('aria-invalid'), 'true');
      assert.equal(traffic.length, before);
      await shot('invalid');
    });

    await check('Installer, keyboard, copy and FAQ', async () => {
      await home();
      const install = page.locator('#install');
      const connect = main.getByRole('button', exact('Find it in your agent'));
      await connect.click();
      const claude = install.getByRole('tab', exact('Claude Code'));
      await claude.waitFor();
      assert.equal(await claude.evaluate(tab => document.activeElement === tab), true);
      await claude.press('End');
      assert.equal(await install.getByRole('tab', exact('Other MCP')).getAttribute('aria-selected'), 'true');
      await install.getByRole('tab', exact('Other MCP')).press('Home');
      assert.equal(await claude.getAttribute('aria-selected'), 'true');
      for (const [client, content] of Object.entries(installText)) {
        const tab = install.getByRole('tab', exact(client));
        await tab.click();
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        const panel = install.getByRole('tabpanel');
        assert.equal(await panel.locator('code').innerText(), content);
        await panel.getByRole('button', { name: /^Copy/ }).click();
        await panel.getByRole('button', exact('Copied')).waitFor();
        assert.equal(await page.evaluate(() => window.__qaClipboard), content);
      }
      await shot('installer', install);
      await connect.click();
      assert.equal(await claude.isVisible(), false);
      await page.locator('#close a[href="#name"]').click();
      assert.equal(new URL(page.url()).hash, '#name');
      await page.locator('#close a[href="#install"]').click();
      await claude.waitFor();
      assert.equal(new URL(page.url()).hash, '#install');
      for (const question of await page.locator('#faq details').all()) {
        await question.locator('summary').click();
        assert.ok(await question.locator('p').isVisible());
        await question.locator('summary').click();
        assert.equal(await question.locator('p').isVisible(), false);
      }
    });

    await check('Brightboard, pick, trademark and shops', async () => {
      await home();
      const from = traffic.length;
      await submit('brightboard', true);
      await sawHeading('brightboard');
      const call = await getCall(entry => entry.queried === 'brightboard', from);
      const checked = await getCall(entry => entry.path === '/v1/check/details' && entry.data.name === 'brightboard', from);
      const card = region.locator('.hunt-card').first();
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      const pick = card.locator('.best-domain');
      assert.equal(await pick.getAttribute('data-domain'), call.data.choice.pick.domain);
      assert.match(await pick.locator('.pick-label').innerText(), /Hound’s pick/);
      assert.match(await pick.locator('.offer-condition').first().innerText(), /Preferred ending at \$[\d.]+ or less over 3 years/);
      assert.match(await pick.locator('.three-year').innerText(), /over 3 years at/);
      const mark = checked.data.trademarks.us;
      if (mark.status === 'exact_match_found') {
        const warning = card.locator('.trademark-warning');
        await warning.waitFor();
        assert.match(await warning.innerText(), /Exact US trademark match/);
        assert.equal(await warning.evaluate(node => Boolean(node.compareDocumentPosition(
          node.closest('.hunt-card').querySelector('.offer-row')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
        for (const filing of await warning.getByRole('link').all()) {
          assert.equal(new URL(await filing.getAttribute('href')).hostname, 'tsdr.uspto.gov');
        }
      }
      console.log('Evidence ' + id + ' brightboard trademark: ' + mark.status);
      await card.locator('.taken-list').getByRole('link', exact('Watch brightboard.com')).waitFor();
      await shot('brightboard', region);
      await checkCards(card, call.data);
      const expanded = card.locator('.offer-row').filter({ has: page.locator('.more-shops') }).first();
      await expanded.locator('.more-shops').click();
      await shot('expanded-shops', expanded);
    });

    await check('Name-check panels and platform outcomes', async () => {
      if ((await answer.textContent().catch(() => '')) !== 'brightboard') {
        await home();
        await submit('brightboard', true);
        await sawHeading('brightboard');
      }
      const card = region.locator('.hunt-card').first();
      const checked = await getCall(entry => entry.path === '/v1/check/details' && entry.data.name === 'brightboard');
      assert.ok(checked.data.appStore && checked.data.googlePlay);
      for (const platform of Object.keys(platformHosts).slice(2)) {
        assert.ok(checked.data.handles.some(handle => handle.platform === platform), 'Worker omitted ' + platform);
      }
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await checkPanel(card, checked.data);
      await card.locator('.checks-toggle').first().click();
      await shot('name-checks', card.locator('.detail-checks'));
    });

    await check('Tripfixer and random 18-letter name', async () => {
      await home();
      await submit('tripfixer');
      await sawHeading('tripfixer');
      await region.locator('.offer-row').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await shot('tripfixer', region);
      await submit(name, true);
      await sawHeading(name);
      await region.locator('.offer-row').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await shot('random', region);
    });

    await check('Taken domain, watch link and available alternatives', async () => {
      await home();
      await submit('brightboard.ai');
      await sawHeading('brightboard.ai is taken.');
      const watch = region.locator('.requested-actions').getByRole('link', exact('Watch brightboard.ai'));
      assert.equal(new URL(await watch.getAttribute('href'), site).searchParams.get('domain'), 'brightboard.ai');
      assert.equal(await region.locator('.taken-list').getByRole('link', exact('Watch brightboard.ai')).count(), 0);
      await region.getByRole('heading', exact('Available instead')).waitFor();
      await region.locator('.offer-row').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await shot('taken-domain', region);
      await region.locator('.requested-actions a[href="#install"]').click();
      await page.locator('#install[open]').waitFor();
      await watch.click();
      await page.waitForURL(url => url.pathname === '/watch/' && url.searchParams.get('domain') === 'brightboard.ai');
      assert.equal(await page.locator('#watch-domain').inputValue(), 'brightboard.ai');
    });

    await check('Available domain comes first', async () => {
      await home();
      await submit('brightboard.dev', true);
      await sawHeading('brightboard.dev');
      const first = region.locator('.offer-row').first();
      assert.equal(await first.getAttribute('data-domain'), 'brightboard.dev');
      assert.match(await first.locator('.pick-label').innerText(), /You asked for this/);
      assert.ok(await region.locator('.offer-row').count() > 1);
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await shot('available-domain', region);
    });

    await check('All endings taken and Find new names', async () => {
      await home();
      const from = traffic.length;
      await submit(allTaken + '.ai');
      await sawHeading(allTaken + '.ai is taken.');
      await region.getByText('All checked endings are taken.', { exact: false }).waitFor();
      assert.equal(await region.locator('.offer-row').count(), 0);
      await shot('all-taken', region);
      await region.getByRole('button', exact('Find new names')).click();
      await sawHeading('Name ideas');
      await region.getByRole('heading', exact(fixtureName)).waitFor();
      await getCall(entry => entry.body?.idea === 'names like ' + allTaken, from);
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
    });

    await check('Bare taken name and automatic similar names', async () => {
      await home();
      const from = traffic.length;
      await submit(allTaken, true);
      await sawHeading(allTaken);
      const recovery = region.locator('.recovery');
      await recovery.getByRole('heading', exact('Similar names')).waitFor();
      await recovery.getByRole('heading', exact(variants[0])).waitFor();
      await recovery.getByRole('heading', exact(fixtureName)).waitFor();
      for (const variant of variants) await getCall(entry => entry.queried === variant, from);
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await shot('similar-names', recovery);
    });

    await check('Retry incomplete name checks', async () => {
      await home();
      await submit(checksName);
      await sawHeading(checksName);
      const panel = region.locator('.detail-checks');
      await panel.getByText('Some checks are still pending.', { exact: true }).waitFor();
      await panel.getByRole('button', exact('Retry checks')).click();
      await panel.getByRole('link', exact('App Store · Taken')).waitFor();
      assert.equal(await panel.getByRole('button', exact('Retry checks')).isVisible(), false);
      assert.equal(detailsAttempts, 2);
      const warning = region.locator('.trademark-warning');
      await warning.waitFor();
      assert.equal(await warning.evaluate(node => Boolean(node.compareDocumentPosition(
        node.closest('.hunt-card').querySelector('.offer-row')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    });

    await check('Sentence, scored ideas and refinement', async () => {
      await home();
      const from = traffic.length;
      await field.fill(idea);
      assert.equal(await page.locator('#search-hint-text').innerText(), 'Name ideas');
      await page.getByRole('button', exact('Search as a name')).click();
      assert.equal(await page.locator('#search-hint-text').innerText(), 'Name search');
      await page.getByRole('button', exact('Search as an idea')).click();
      await main.getByRole('button', exact('Find it here')).click();
      await sawHeading('Name ideas');
      await region.locator('.refine summary').waitFor({ timeout: 90_000 });
      const first = region.locator('.idea-list .hunt-card').first();
      await first.getByText(/Name score \d+\/100/).waitFor();
      await first.getByText('Why this name?', { exact: true }).click();
      await first.locator('.suggestion-foot details[open] .reason-list li').first().waitFor();
      const generated = await getCall(entry => entry.path === '/v1/generate' && entry.body?.idea === idea, from);
      console.log('Evidence ' + id + ' idea source: ' + generated.data.path + ' (' + (generated.data.pathReason ?? 'no fallback') + ')');
      await shot('name-ideas', first);
      await region.getByText('Refine these ideas', { exact: true }).click();
      await region.getByRole('button', exact('Find more names')).click();
      await region.getByText('Choose at least one name.', { exact: true }).waitFor();
      const wanted = region.getByRole('combobox', exact('Like'));
      const choice = await wanted.locator('option').nth(1).getAttribute('value');
      await wanted.selectOption(choice);
      assert.ok(await region.getByRole('combobox', exact('Also like')).locator('option').nth(1).isDisabled());
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'), null, { timeout: 45_000 });
      await region.getByRole('button', exact('Find more names')).click();
      await sawHeading('More name ideas');
      const round = await getCall(entry => entry.body?.round === 2, from);
      assert.deepEqual(round.body.wanted, [choice]);
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
    });

    await check('Own-name disclosure, Escape and search', async () => {
      await home();
      await field.focus();
      const trigger = page.getByRole('link', exact('Use my own name'));
      await trigger.click();
      const personal = page.locator('#personal');
      await personal.waitFor();
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      await personal.press('Escape');
      assert.equal(await personal.isVisible(), false);
      await trigger.click();
      assert.equal(await personal.evaluate(node => document.activeElement === node), true);
      const fullName = 'Avery Fernwood';
      const from = traffic.length;
      await personal.fill(fullName);
      await page.getByRole('button', exact('Find my domain')).click();
      await sawHeading('Domains for ' + fullName);
      await getCall(entry => entry.path === '/v1/personal' && entry.body?.fullName === fullName, from);
      await region.locator('.offer-row').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'), null, { timeout: 40_000 });
      await shot('personal');
    });

    await check('Share result, copy and invalid receipt', async () => {
      await home();
      await submit('brightboard');
      await sawHeading('brightboard');
      const share = region.getByRole('link', exact('Share results'));
      const destination = new URL(await share.getAttribute('href'));
      assert.equal(destination.origin, publishedOrigin);
      assert.equal(destination.pathname, '/r/');
      assert.match(destination.hash, /^#[12]\./);
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
      await page.goto(new URL(destination.pathname + destination.hash, site).href);
      await page.getByRole('heading', exact('brightboard')).waitFor();
      await page.locator('#checked-at').waitFor();
      assert.match(await page.locator('#checked-at').innerText(), /UTC$/);
      await page.getByRole('link', exact('Watch brightboard.com')).waitFor();
      const more = page.locator('.taken-summary summary');
      if (await more.isVisible()) {
        await more.click();
        assert.equal(await more.locator('..').getAttribute('open'), '');
      }
      await page.getByRole('button', exact('Copy share link')).click();
      await page.getByText('Link copied.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__qaClipboard), page.url());
      await shot('shared-result');
      await page.goto(new URL('/r/#2.broken', site).href);
      await page.getByRole('heading', exact('We couldn’t read this link.')).waitFor();
      await page.goto(new URL('/r/', site).href);
      await page.getByRole('heading', exact('This link is incomplete.')).waitFor();
      await shot('invalid-share');
    });

    await check('Watch validation, consent, payload and manage page', async () => {
      await page.goto(new URL('/watch/?domain=Example.COM&email=ignored@example.com', site).href);
      const domain = page.locator('#watch-domain');
      const email = page.locator('#watch-email');
      const news = page.locator('#watch-news');
      const button = page.getByRole('button', exact('Watch for free'));
      assert.equal(await domain.inputValue(), 'example.com');
      assert.equal(await email.inputValue(), '');
      for (const consent of await page.getByRole('checkbox').all()) assert.equal(await consent.isChecked(), false);
      assert.ok(!(await news.getAttribute('required')));
      await shot('watch');
      await page.getByText('What emails will I get?', { exact: true }).click();
      await page.getByText(/Up to four emails per domain/).waitFor();
      await domain.fill('no-ending');
      await button.click();
      await page.getByText('Enter a domain like brightname.com.', { exact: true }).waitFor();
      assert.equal(await domain.getAttribute('aria-invalid'), 'true');
      await domain.fill('https://Example.com/hello');
      await email.fill('invalid-address');
      await button.click();
      await page.getByText('Enter an email like you@example.com.', { exact: true }).waitFor();
      assert.equal(await email.getAttribute('aria-invalid'), 'true');
      assert.equal(watchCalls.length, 0);
      let manageLink;
      for (const optIn of [false, true]) {
        const address = 'site-qa-' + unique + '-' + id + '-' + Number(optIn) + '@example.com';
        await domain.fill('https://Example.com/hello');
        await email.fill(address);
        await news.setChecked(optIn);
        await button.click();
        await page.getByText('Check your email to start your watch.', { exact: true }).waitFor();
        assert.deepEqual(watchCalls.at(-1), { email: address, domain: 'example.com', source: 'site', website: '',
          ...(optIn && { news: 'yes' }) });
        assert.equal(await news.isChecked(), false);
        assert.equal(await email.inputValue(), '');
        // The queue can defer the second mail to respect its sending pace.
        if (!optIn) manageLink = await watchWorker.manageLink(address);
      }
      await shot('watch-accepted');
      const manage = await page.goto(manageLink);
      assert.equal(manage.status(), 200);
      await page.getByRole('heading', exact('You hold the leash.')).waitFor();
      await page.getByRole('heading', exact('Watches')).waitFor();
      await page.getByRole('button', exact('Erase everything')).waitFor();
      await shot('manage');
      assert.equal(watchCalls.length, 2);
      assert.deepEqual(watchWorker.unexpected, []);
    });

    await check('Privacy, guides, data, crawler files and every internal link', async () => {
      const get = async path => {
        const response = await context.request.get(new URL(path, site).href);
        assert.equal(response.status(), 200, path);
        return response.text();
      };
      const sitemap = await get('/sitemap.xml');
      const paths = await page.evaluate(xml => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Sitemap XML does not parse');
        return Array.from(doc.getElementsByTagName('loc'), node => node.textContent);
      }, sitemap);
      assert.equal(new Set(paths).size, paths.length);
      assert.ok(paths.includes(publishedOrigin + '/data/'));
      assert.ok(paths.includes(publishedOrigin + '/privacy/'));
      assert.equal(paths.filter(path => new URL(path).pathname.startsWith('/guides/')).length, 11);
      const anchors = new Set();
      for (const path of paths.map(path => new URL(path).pathname)) {
        const response = await page.goto(new URL(path, site).href);
        assert.equal(response.status(), 200, path);
        await page.locator('main h1').waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow at ' + path);
        for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href))) anchors.add(href);
        for (const disclosure of await page.locator('main details.guide-evidence').all()) {
          await disclosure.locator('summary').click();
          assert.equal(await disclosure.getAttribute('open'), '');
        }
        if (['/privacy/', '/guides/', '/data/'].includes(path)) await shot(path.split('/')[1]);
      }
      const llms = await get('/llms.txt');
      assert.match(llms, /^# Domain Hound/);
      assert.match(await get('/llms-full.txt'), /Domain Hound/);
      assert.match(await get('/robots.txt'), /Sitemap: https:\/\/domainhound\.dev\/sitemap\.xml/);
      for (const match of llms.matchAll(/\]\((https:[^)]+)\)/g)) anchors.add(match[1]);
      for (const href of anchors) {
        const url = new URL(href);
        if (url.protocol === 'mailto:') {
          assert.ok(url.pathname);
          continue;
        }
        if (![site.origin, publishedOrigin].includes(url.origin)) {
          assert.equal(url.protocol, 'https:', 'External link: ' + href);
          continue;
        }
        const body = await get(url.pathname + url.search);
        if (url.hash) {
          const fragment = decodeURIComponent(url.hash.slice(1));
          assert.ok(await page.evaluate(({ body, fragment }) =>
            Boolean(new DOMParser().parseFromString(body, 'text/html').getElementById(fragment)), { body, fragment }),
          'Missing anchor ' + url.pathname + url.hash);
        }
        if (url.pathname.endsWith('.json')) assert.ok(JSON.parse(body));
        if (url.pathname.endsWith('.csv')) assert.match(body, /^[^\n]+,[^\n]+\r?\n.+/);
      }
    });

    await check('404 page and return to search', async () => {
      expectedMissing = true;
      try {
        const response = await page.goto(new URL(missingPath, site).href);
        assert.equal(response.status(), 404);
        if (preview) await page.goto(new URL('/404.html', site).href);
        await page.getByRole('heading', exact('Page not found')).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await shot('404');
        await page.getByRole('link', exact('Search for a domain')).click();
        await page.waitForURL(url => url.pathname === '/' && url.hash === '#search');
      } finally {
        expectedMissing = false;
      }
    });

    await check('API offline, one message and successful retry', async () => {
      await home();
      try {
        offline = true;
        await submit('tripfixer', true);
        const error = main.locator('.hunt-status');
        await error.getByText('Couldn’t finish the search. Try again.', { exact: true }).waitFor();
        assert.equal(await page.locator('.hunt-status:visible').count(), 1);
        assert.equal(await region.isVisible(), false);
        await shot('offline');
      } finally {
        offline = false;
      }
      await main.getByRole('button', exact('Find it here')).click();
      await sawHeading('tripfixer');
      assert.equal(await main.locator('.hunt-status').textContent(), '');
      await page.waitForFunction(() => !document.querySelector('.hunt-card[data-check-pending]'));
    });

    await check('Browser console and network', async () => {
      await Promise.all(pending);
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close();
  }
}

for (const engine of engines) {
  assert.ok(['webkit', 'chromium'].includes(engine), 'Unknown browser engine: ' + engine);
  const browser = await playwright[engine].launch({ headless: true });
  try {
    for (const width of widths) {
      const watchWorker = await startWatchWorker(root, site.origin);
      try {
        await runViewport(browser, engine, width, watchWorker);
      } finally {
        await watchWorker.close();
      }
    }
  } finally {
    await browser.close();
  }
}
const configurations = [...new Set(results.map(row => row.id))];
console.log('| Function | ' + configurations.join(' | ') + ' |');
console.log('| --- | ' + configurations.map(() => '---').join(' | ') + ' |');
for (const label of [...new Set(results.map(row => row.label))]) {
  console.log('| ' + label + ' | ' + configurations.map(id =>
    results.find(row => row.id === id && row.label === label).status).join(' | ') + ' |');
}
if (results.some(row => row.status === 'FAIL')) process.exitCode = 1;
