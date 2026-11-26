const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { deflateSync } = require('node:zlib');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const site = 'https://domainhound.dev';
const api = 'https://search-api.example';
const checkedAt = '2026-11-25T12:00:00.000Z';
const breather = 'Too many searches. Try again in a few minutes.';
let browser;
before(async () => { browser = await webkit.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function receipt(name, domain) {
  const records = [[domain, 0, 625, 1650, 1]];
  const json = JSON.stringify([checkedAt, [[name, 0, '', records]]]);
  return site + '/r/#2.' + deflateSync(json).toString('base64url');
}

function price(domain, overrides = {}) {
  return {
    shop: 'Spaceship', firstYearUsd: 6.25, renewalUsd: 16.5, minimumYears: 1,
    firstPaymentUsd: 6.25, renewalPaymentUsd: 16.5, threeYearUsd: 39.25,
    renewalJump: true, needsCloudflareDns: false, dataOnly: false, checkedAt: '2026-11-25',
    buyUrl: 'https://www.spaceship.com/domain-search/?query=' + domain, ...overrides
  };
}

function domainRow(domain, status = 'available') {
  return {
    domain, ending: domain.split('.').pop(), status, checkedAt, cached: false,
    evidence: { taken: 'dns-ns', available: 'rdap-404', unknown: null }[status],
    reason: null, premium: null, eligibility: null, note: null, priceShown: true,
    prices: [
      price(domain, { shop: 'Gandi', firstYearUsd: 14, firstPaymentUsd: 14,
        renewalUsd: 9, renewalPaymentUsd: 9, threeYearUsd: 32, renewalJump: false,
        buyUrl: 'https://shop.gandi.net/en/domain/suggest?search=' + domain }),
      price(domain, { shop: 'Porkbun', firstYearUsd: 2, firstPaymentUsd: 2, buyUrl: null, dataOnly: true }),
      price(domain)
    ]
  };
}

// The Worker's choice view of one registrar offer on a row.
function choiceFor(row, shop = 'Gandi') {
  const offer = row?.prices.find(candidate => candidate.shop === shop);
  if (!offer) return { pick: null, cheapest: null, bestValue: null, capUsd: 60 };
  const { firstPaymentUsd, renewalUsd, renewalPaymentUsd, minimumYears, threeYearUsd, renewalJump,
    needsCloudflareDns, buyUrl } = offer;
  return { pick: { domain: row.domain, shop, firstPaymentUsd, renewalUsd, renewalPaymentUsd, minimumYears,
    threeYearUsd, renewalJump, needsCloudflareDns, buyUrl }, cheapest: null, bestValue: null, capUsd: 60 };
}

function checkReply(withDetails = false) {
  const name = 'Mapfern';
  const domains = ['com', 'dev', 'app'].map((ending, i) =>
    domainRow('mapfern.' + ending, ['available', 'taken', 'unknown'][i]));
  return { version: 1, query: { name, ascii: 'mapfern', exactDomain: null }, checkedAt, complete: false,
    domains, choice: choiceFor(domains[0]), share: { url: receipt(name, domains[0].domain) },
    details: withDetails ? detailToken('mapfern') : null };
}

function detailToken(name) {
  return { id: name, path: '/v1/check/details?id=' + name, pending: ['appStore', 'googlePlay', 'trademarks', 'handles'] };
}

function profileChecks(name) {
  return {
    complete: true, name, appStore: { status: 'no_match_found', matches: [] },
    googlePlay: { status: 'check', link: 'https://play.google.com/store/search?q=' + name },
    trademarks: { us: { status: 'no_exact_match_found', marks: [], searchUrl: 'https://tmsearch.uspto.gov/' } },
    handles: [
      { platform: 'YouTube', handle: name, state: 'taken', link: 'https://www.youtube.com/@' + name },
      { platform: 'Instagram', handle: name, state: 'not-found', link: 'https://www.instagram.com/' + name },
      { platform: 'Facebook', handle: name, state: 'check', link: 'https://www.facebook.com/' + name },
      { platform: 'New Network', handle: name, state: 'check', link: 'https://social.example/' + name }
    ]
  };
}

const webEndings = ['com', 'ai', 'io', 'dev', 'app', 'co', 'so', 'me', 'si', 'no', 'xyz', 'tech'];
const pickOrder = ['com', 'io', 'dev', 'app', 'co', 'so', 'me', 'si', 'xyz', 'tech'];

// A bare-name check: every ending taken unless listed. The pick follows the Worker's quality order.
function bareReply(ascii, statuses = {}, name = ascii) {
  const domains = webEndings.map(ending => domainRow(ascii + '.' + ending, statuses[ending] || 'taken'));
  const first = pickOrder.map(ending => domains.find(row => row.domain === ascii + '.' + ending))
    .find(row => row.status === 'available');
  return { version: 1, query: { name, ascii, exactDomain: null }, checkedAt, complete: true, domains,
    choice: choiceFor(first), share: null, details: { id: null, status: 'unavailable', pending: [] } };
}

async function openPage(t, handler, { width = 390, javaScriptEnabled = true, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    javaScriptEnabled, reducedMotion, serviceWorkers: 'block'
  });
  const calls = [];
  const unexpected = [];
  const page = await context.newPage();
  page.setDefaultTimeout(3500);
  page.on('pageerror', error => unexpected.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(unexpected, []);
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === api) {
      const body = request.postDataJSON();
      const call = { method: request.method(), path: url.pathname, query: url.searchParams, body };
      calls.push(call);
      const reply = await handler(call);
      return route.fulfill({ status: reply.status || 200, json: reply.json,
        headers: { 'access-control-allow-origin': site } });
    }
    if (url.origin !== site || request.method() !== 'GET') {
      unexpected.push(request.method() + ' ' + url.href);
      return route.abort();
    }
    if (url.pathname === '/') {
      // Exercise the configurable API origin; never contact the hosted service.
      const html = readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace(/(<meta name="domain-hound-api" content=")[^"]+/, '$1' + api);
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    const file = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    return route.fulfill({ path: path.join(root, file) });
  });
  await page.goto(site);
  assert.equal(calls.length, 0);
  return { page, calls };
}

// Supply the per-name checks for tests focused on shortlist ranking and steering.
async function openShortlistPage(t, handler, options) {
  const names = new Map();
  return openPage(t, async call => {
    const name = call.query.get('name')?.toLowerCase();
    if (call.path === '/v1/check' && names.has(name)) {
      const entry = names.get(name);
      const domains = entry.domains.map(row => ({ ...domainRow(row.domain, row.status), ...row,
        ...(entry.domain.domain === row.domain && { prices: entry.domain.prices || [entry.domain] }) }));
      return { json: { domains, details: detailToken(name) } };
    }
    if (call.path === '/v1/check/details') return { json: profileChecks(call.query.get('id')) };
    const response = await handler(call);
    for (const entry of response.json?.names || []) names.set(entry.name.toLowerCase(), entry);
    return response;
  }, options);
}

async function search(page, mode, value) {
  if (mode === 'personal') {
    const field = page.getByRole('textbox', { name: 'What’s your full name?', exact: true });
    if (!await field.isVisible()) {
      await page.locator('#name').focus();
      await page.getByText('Use my own name', { exact: true }).click();
    }
    await field.fill(value);
    await page.getByRole('button', { name: 'Find my domain', exact: true }).click();
    return;
  }
  await page.getByRole('textbox', { name: 'Name or idea', exact: true }).fill(value);
  const wanted = mode === 'name' ? 'Name search' : 'Name ideas';
  if (await page.locator('#search-hint-text').textContent() !== wanted) {
    await page.getByRole('button', { name: mode === 'name' ? 'Search as a name' : 'Search as an idea' }).click();
  }
  await page.getByRole('button', { name: 'Find it here', exact: true }).click();
}

async function screenshot(page, filename, target = page) {
  const dir = process.env.SEARCH_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await target.screenshot({ ...(target === page && { fullPage: true }), path: path.join(dir, filename + '.png'), animations: 'disabled' });
}

for (const width of [390, 1440]) {
  test('homepage search and installer at ' + width + 'px', async t => {
    const { page } = await openPage(t, () => assert.fail('Unexpected search'), { width });
    const hero = page.locator('.hero');
    const field = hero.getByRole('textbox', { name: 'Name or idea', exact: true });
    const submit = hero.getByRole('button', { name: 'Find it here', exact: true });
    await field.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await hero.locator('.stamp').textContent(), 'Name it already.');
    assert.equal((await hero.locator('h1').innerText()).replace(/\s+/g, ' '), 'Find a startup name you can actually buy.');
    assert.equal(await hero.locator('.subline').textContent(), "Say what you're building. The Hound sniffs out names that are available everywhere, at the best price.");
    assert.equal(await field.getAttribute('placeholder'), "A name, or what you’re building");
    assert.equal(await hero.getByRole('textbox').count(), 1);
    assert.equal(await hero.locator('.search-hint').isVisible(), false);
    assert.equal(await hero.getByRole('link', { name: 'Need name ideas?' }).count(), 0);
    assert.deepEqual(await hero.locator('.search-paths a').allTextContents(), ['Use my own name']);
    assert.equal(await page.getByRole('heading', { name: 'A real search.' }).count(), 0);
    assert.match(await page.locator('#real-search').innerText(), /tripfixer\.app[\s\S]*\$8\.28[\s\S]*\$14\.49/);
    const install = page.locator('#install');
    const claude = install.getByRole('tab', { name: 'Claude Code' });
    const connect = hero.getByRole('button', { name: 'Find it in your agent' });
    const first = await submit.boundingBox();
    const second = await connect.boundingBox();
    assert.ok(Math.abs(first.width - second.width) <= 1 && first.height === second.height);
    assert.ok(second.y + second.height <= (width === 390 ? 844 : 900));
    assert.equal(await claude.isVisible(), false);
    assert.equal(await page.locator('.search-paths').isVisible(), false);
    const receipt = hero.locator('#real-search');
    assert.equal(await receipt.locator('s').textContent(), 'concierge.com · Taken');
    assert.equal(await receipt.locator('time').getAttribute('datetime'), '2026-11-24');
    assert.match(await receipt.innerText(), /360 names sniffed. One winner./);
    const how = await page.locator('#how').innerText();
    for (const fact of ['shops', 'renewal', 'App Store', 'Google Play', 'LinkedIn', 'X', 'Instagram',
      'TikTok', 'YouTube', 'GitHub', 'connects your site', 'owner', 'offer']) assert.ok(how.includes(fact), fact);
    const questions = page.locator('#faq details');
    assert.equal(await questions.count(), 2);
    assert.equal(await page.locator('#faq details[open]').count(), 0);
    const faqData = await page.locator('script[type="application/ld+json"]').evaluate(node =>
      JSON.parse(node.textContent)['@graph'].find(entity => entity['@type'] === 'FAQPage').mainEntity);
    for (const [index, item] of faqData.entries()) {
      const question = questions.nth(index);
      const summary = question.locator('summary');
      assert.equal(await summary.innerText(), item.name);
      await summary.click();
      assert.equal(await question.locator('p').innerText(), item.acceptedAnswer.text);
      await summary.click();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const visible = await page.locator('main').innerText();
    assert.doesNotMatch(visible, /\b(?:free|registered|unavailable|patents?|patented|triage|screening|MCP|connector|registrar|crawl|scan|query)\b|recurring fee|ongoing cost|handle available/i);
    assert.ok(await field.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight));
    await screenshot(page, 'front-' + width);
    await connect.click();
    await claude.waitFor();
    assert.equal(await install.getByRole('tab').count(), 4);
    await connect.click();
    await page.locator('#close').getByRole('link', { name: 'Find it in your agent' }).click();
    await claude.waitFor();
    await page.locator('#close').getByRole('link', { name: 'Find it here' }).click();
    assert.ok(await field.evaluate(node => document.activeElement === node));
    const opener = hero.getByRole('link', { name: 'Use my own name' });
    await opener.focus();
    await opener.press('Enter');
    await hero.getByRole('textbox', { name: 'What’s your full name?' }).waitFor();
    assert.equal(await opener.getAttribute('aria-expanded'), 'true');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });

  test('name search shows availability, prices and agent setup at ' + width + 'px', async t => {
    const { page } = await openPage(t, call => {
      assert.equal(call.path, '/v1/check');
      assert.equal(call.query.get('name'), 'Mapfern');
      return { json: checkReply() };
    }, { width });
    await search(page, 'name', 'Mapfern');
    const results = page.getByRole('region', { name: 'Search results' });
    const best = results.locator('.best-domain');
    await best.getByRole('link', { name: /Buy .* at Gandi/ }).waitFor();
    assert.equal((await best.locator('.domain-title').innerText()).replace(/\s+/g, ' '), 'mapfern.com');
    assert.match(await best.innerText(), /\$14\.00 first year\s+Renewal \$9\.00\/year/);
    await results.locator('.taken-list b').waitFor();
    await results.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'name-' + width);
    const installLink = results.locator('.taken-group a[href="#install"]');
    await installLink.click();
    const setup = page.locator('#install');
    await setup.getByRole('tab', { name: 'Codex', exact: true }).waitFor();
    if (width === 390) {
      await page.locator('#connect').click();
      await installLink.click();
      await setup.getByRole('tab', { name: 'Codex', exact: true }).waitFor();
    }
  });
}

test('a dotted name reaches the API as an exact domain', async t => {
  const { page } = await openPage(t, call => {
    assert.equal(call.path, '/v1/check');
    assert.equal(call.query.get('name'), 'mapfern.com');
    return { json: { ...checkReply(), query: { name: 'mapfern', ascii: 'mapfern', exactDomain: 'mapfern.com' },
      domains: [domainRow('mapfern.com')], choice: null } };
  });
  await search(page, 'name', 'mapfern.com');
  await page.getByRole('link', { name: /Buy .* at Spaceship/ }).waitFor();
});

test('confirmed endings remain usable when automatic details have expired', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check/details') return { status: 410, json: { error: 'expired' } };
    assert.equal(call.path, '/v1/check');
    assert.equal(call.method, 'GET');
    assert.equal(call.query.get('name'), 'Mapfern');
    return { json: checkReply(true) };
  });
  await search(page, 'name', 'Mapfern');
  const book = page.getByRole('link', { name: /Buy .* at Gandi/i });
  await book.waitFor();
  assert.equal(await book.getAttribute('href'), 'https://shop.gandi.net/en/domain/suggest?search=mapfern.com');
  assert.equal(await page.locator('.ending-list').getByText('mapfern.com', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('link', { name: /^Buy /i }).count(), 1);
  await page.getByRole('link', { name: 'Watch mapfern.dev' }).waitFor();
  assert.equal(await page.getByText('mapfern.app', { exact: true }).count(), 0);
  await page.getByText(/checks expired/).waitFor();
  assert.equal(calls[1].query.get('id'), 'mapfern');
  assert.equal(await book.isVisible(), true);
  const share = page.getByRole('link', { name: 'Share results' });
  const watch = page.locator('a[href="/watch/?domain=mapfern.dev"]');
  assert.equal(await share.getAttribute('href'), receipt('Mapfern', 'mapfern.com'));
  await share.click();
  await page.getByRole('heading', { name: 'Mapfern', exact: true }).waitFor();
  await page.goBack();
  if (!(await watch.isVisible())) await search(page, 'name', 'Mapfern');
  await watch.click();
  assert.equal(await page.locator('#watch-domain').inputValue(), 'mapfern.dev');
});

test('rate limited and unavailable searches can be retried', async t => {
  const responses = [
    { status: 429, json: { error: 'rate-limited', retryAfterSeconds: 120 } },
    { status: 503, json: { error: 'unavailable' } },
    { json: checkReply() }
  ];
  const { page } = await openPage(t, call => call.path.includes('/details')
    ? { status: 410, json: { error: 'expired' } } : responses.shift());
  await search(page, 'name', 'Mapfern');
  await page.getByText(breather, { exact: true }).waitFor();
  await search(page, 'name', 'Mapfern');
  await page.getByText('Couldn’t finish the search. Try again.').waitFor();
  await search(page, 'name', 'Mapfern');
  await page.getByRole('link', { name: /Buy .* at Gandi/i }).waitFor();
  assert.equal(responses.length, 0);
});

test('search has a readable fallback when scripts are off', async t => {
  const { page } = await openPage(t, () => assert.fail('Unexpected request'), { javaScriptEnabled: false });
  assert.match(await page.locator('#search').innerText(), /Turn on JavaScript to search/i);
  const setup = page.locator('#install');
  if (!await setup.locator('code').first().isVisible()) await setup.locator('summary').click();
  for (const command of ['claude mcp add', 'codex mcp add']) {
    assert.ok(await setup.locator('code').filter({ hasText: command }).isVisible());
  }
});

test('agent setup offers working copy actions for both terminals and the hosted connector', async t => {
  const { page } = await openPage(t, () => assert.fail('Unexpected search'));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText(text) { window.copiedSetup = text; } }
  }));
  const setup = page.locator('#install');
  await page.locator('#connect').click();
  for (const [client, expected] of [
    ['Claude Code', 'claude mcp add domain-hound -- npx -y domain-hound'],
    ['Codex', 'codex mcp add domain-hound -- npx -y domain-hound'],
    ['ChatGPT', 'https://domainhound-mcp.domainhound.workers.dev/mcp'],
    ['Other MCP', '{"mcpServers":{"domain-hound":{"command":"npx","args":["-y","domain-hound"]}}}']
  ]) {
    await setup.getByRole('tab', { name: client, exact: true }).click();
    await setup.getByRole('button', { name: /copy/i }).click();
    assert.equal(await page.evaluate(() => window.copiedSetup), expected);
  }
});

test('a stale name response cannot replace a newly selected search', async t => {
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  const { page } = await openShortlistPage(t, async call => {
    if (call.path === '/v1/check') {
      started();
      await pending;
      return { json: checkReply() };
    }
    assert.equal(call.path, '/v1/generate');
    return { json: ideas([['Trailfin', 'trailfin.com']]) };
  });
  await search(page, 'name', 'Mapfern');
  await requestStarted;
  assert.match(await page.locator('main').innerText(), /checking|searching|looking/i);
  await search(page, 'idea', ideaText);
  const results = page.locator('#search-results');
  await results.getByRole('heading', { name: 'Trailfin' }).waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await results.getByRole('article').count(), 1);
  assert.ok(await results.getByRole('heading', { name: 'Trailfin' }).isVisible());
});

test('two-year bookings use the full upfront charge and premium results withhold checkout', async t => {
  const ai = domainRow('mapfern.ai');
  ai.prices = [price(ai.domain, {
    minimumYears: 2, firstYearUsd: 65, firstPaymentUsd: 130, renewalUsd: 70,
    renewalPaymentUsd: 140, threeYearUsd: 270, renewalJump: false
  })];
  const premium = { ...domainRow('mapf.com'), premium: 'registry premium', priceShown: false, prices: [] };
  const { page } = await openPage(t, () => ({ json: {
    ...checkReply(), domains: [ai, premium], details: { id: null, status: 'unavailable' }, complete: true
  } }));
  await search(page, 'name', 'Mapfern');
  const book = page.getByRole('link', { name: /Buy .* at Spaceship/i });
  await book.waitFor();
  const result = await page.locator('#search-results').innerText();
  assert.match(result, /\$140/);
  assert.match(result, /2 years|two.year/i);
  assert.match(result, /premium/i);
  assert.equal(await page.getByRole('link', { name: /^Buy /i }).count(), 1);
});

function ideas(names) {
  return {
    complete: true, path: 'qwen', names: names.map(([name, domain, status = 'available', total]) => {
      const row = domainRow(domain, status);
      const pick = { domain, ...row.prices[0], prices: row.prices, evidence: row.evidence, checkedAt };
      const scoreTotal = total ?? (name === 'Trailfin' ? 68 : name === 'Mossfold' ? 56 : 74);
      const score = { total: scoreTotal,
        band: scoreTotal >= 80 ? 'Strong' : scoreTotal >= 60 ? 'Workable' : 'Risky',
        reasons: ['.' + row.ending + ' is available.', 'US trademarks not checked.',
          name === 'Trailfin' ? 'The GitHub handle is taken.' : name === 'Mossfold' ? 'The .com is taken.' : 'One obvious spelling.'] };
      return { name, score, domain: pick, domains: [
        { domain, status, evidence: row.evidence, checkedAt }
      ], share: { url: receipt(name, domain) } };
    })
  };
}
const ideaText = 'A field notebook for people who map forest trails';
const shortlist = [['Mapfern', 'mapfern.com'], ['Trailfin', 'trailfin.com'], ['Mossfold', 'mossfold.app'],
  ['Takenname', 'takenname.dev', 'taken'], ['Unverified', 'unverified.dev', 'unknown']];
const generationId = 'opaque-synthetic-generation-token';
const collectingNames = 'Sniffing out more names…';

function initialIdeas(names) {
  return { ...ideas(names), version: 2, stage: 'initial', complete: false,
    details: { id: generationId, path: '/v1/generate/details', pollAfterMs: 25,
      expiresAt: new Date(Date.now() + 60_000).toISOString() } };
}

function finalIdeas(names) {
  return { ...ideas(names), version: 2, stage: 'final', complete: false, details: null };
}

for (const width of [390, 1440]) {
  test('idea names stay in place until the final scores arrive at ' + width + 'px', async t => {
    const first = [['Trailfin', 'trailfin.com', 'available', 68], ['Notepad', 'notepad.example'], ['Mapfern', 'mapfern.com']];
    const initial = initialIdeas(first);
    initial.names[1].banned = true;
    const final = finalIdeas([
      ['Trailfin', 'trailfin.com', 'available', 63], first[1], ['Mapfern', 'mapfern.com', 'available', 88],
      ['Mossfold', 'mossfold.app'], ['Cedarink', 'cedarink.com', 'available', 92], ['Paperclip', 'paperclip.dev'],
      ['Driftpen', 'driftpen.com', 'available', 84], ['Notebook', 'notebook.dev']
    ]);
    final.names[1].banned = true;
    final.names[7].generic = true;
    let releaseFinal;
    const held = new Promise(resolve => { releaseFinal = resolve; });
    t.after(() => releaseFinal());
    const pollTimes = [];
    const { page, calls } = await openShortlistPage(t, async call => {
      if (call.path === '/v1/generate') return { json: initial };
      assert.equal(call.path, '/v1/generate/details');
      assert.equal(call.method, 'POST');
      assert.equal(call.query.size, 0);
      assert.deepEqual(call.body, { id: generationId });
      pollTimes.push(performance.now());
      if (pollTimes.length === 1) return { status: 202, json: { version: 2, stage: 'pending', retryAfterMs: 70 } };
      await held;
      return { json: final };
    }, { width, reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const firstPoll = page.waitForResponse(reply => reply.url() === api + '/v1/generate/details' && reply.status() === 202);
    await search(page, 'idea', ideaText);
    const results = page.locator('#search-results');
    const cardNames = results.locator('article h3');
    const progress = results.getByRole('status').filter({ hasText: collectingNames });
    await progress.waitFor();
    assert.deepEqual(await cardNames.allTextContents(), ['Trailfin', 'Mapfern']);
    assert.equal(await results.getByRole('combobox').count(), 0);
    assert.doesNotMatch(await results.innerText(), /Some domains couldn’t be checked/);
    const previewRow = results.locator('.idea-list > li').first();
    const before = await previewRow.elementHandle();
    const position = await previewRow.evaluate(row => row.offsetTop);
    await firstPoll;
    await screenshot(page, 'initial-' + width, results);
    assert.equal(await previewRow.evaluate(row => row.offsetTop), position);
    assert.equal(await progress.isVisible(), true);
    const booking = previewRow.getByRole('link', { name: /^Buy / });
    await booking.focus();
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      document.documentElement.dataset.cardAnimations = '0';
      Element.prototype.animate = function (...args) {
        if (this.matches('.idea-list > li')) document.documentElement.dataset.cardAnimations++;
        return animate.apply(this, args);
      };
    });
    releaseFinal();
    await results.getByRole('heading', { name: 'Cedarink', exact: true }).waitFor();
    assert.deepEqual(await cardNames.allTextContents(), ['Cedarink', 'Mapfern', 'Driftpen', 'Paperclip', 'Trailfin', 'Mossfold']);
    assert.equal(await results.locator('.idea-progress').textContent(), '');
    assert.match(await results.innerText(), /Some domains couldn’t be checked/);
    assert.equal(await results.getByText('Name score 63/100', { exact: false }).count(), 1);
    assert.equal(await before.evaluate(row => row.contains(document.activeElement)), true);
    assert.equal(await page.evaluate(() => Number(document.documentElement.dataset.cardAnimations)), width === 390 ? 0 : 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(page, 'final-' + width, results);
    await page.waitForLoadState('networkidle');
    assert.equal(calls.filter(call => call.path.startsWith('/v1/generate')).length, 3);
    assert.deepEqual(calls.filter(call => call.path === '/v1/check/details').map(call => call.query.get('id')).sort(),
      ['cedarink', 'driftpen', 'mapfern', 'mossfold', 'paperclip', 'trailfin']);
    assert.ok(pollTimes[1] - pollTimes[0] >= 65);
  });
}

test('a zero-name preview waits for the continuation before showing the empty state', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page } = await openPage(t, async call => {
    if (call.path === '/v1/generate') return { json: initialIdeas([]) };
    assert.equal(call.path, '/v1/generate/details');
    await held;
    return { json: { ...finalIdeas([]), complete: true } };
  });
  await search(page, 'idea', ideaText);
  await page.getByText(collectingNames, { exact: true }).waitFor();
  assert.equal(await page.getByText(/No available names confirmed/).count(), 0);
  release();
  await page.getByText(/No available names confirmed/).waitFor();
});

test('a failed continuation keeps the first cards and ends polling', async t => {
  const { page, calls } = await openShortlistPage(t, call => {
    if (call.path === '/v1/generate') return { json: initialIdeas([['Mapfern', 'mapfern.com']]) };
    assert.equal(call.path, '/v1/generate/details');
    return { status: 410, json: { error: 'expired' } };
  });
  await search(page, 'idea', ideaText);
  const results = page.locator('#search-results');
  await results.getByText('Couldn’t load more names.', { exact: true }).waitFor();
  assert.deepEqual(await results.locator('article h3').allTextContents(), ['Mapfern']);
  await results.getByText('Refine these ideas').click();
  assert.equal(await results.getByRole('combobox').count(), 3);
  await page.waitForLoadState('networkidle');
  assert.equal(calls.filter(call => call.path.startsWith('/v1/generate')).length, 2);
});

test('editing the idea cancels an in-flight continuation and ignores a late final list', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page } = await openShortlistPage(t, async call => {
    if (call.path === '/v1/generate') return { json: initialIdeas([['Mapfern', 'mapfern.com']]) };
    if (call.path === '/v1/check') return { json: bareReply('trailfin', { com: 'available' }) };
    assert.equal(call.path, '/v1/generate/details');
    await held;
    return { json: finalIdeas([['Cedarink', 'cedarink.com']]) };
  });
  const started = page.waitForRequest(request => request.url() === api + '/v1/generate/details');
  await search(page, 'idea', ideaText);
  await started;
  await search(page, 'name', 'Trailfin');
  await page.locator('.best-domain').getByText('trailfin.com', { exact: true }).waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByRole('heading', { name: 'Cedarink', exact: true }).count(), 0);
});

test('editing the main field stops a pending second shortlist', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { page } = await openShortlistPage(t, async call => {
    if (call.path === '/v1/generate') return { json: call.body.round === 2
      ? initialIdeas([['Trailfin', 'trailfin.com']]) : ideas([['Mapfern', 'mapfern.com']]) };
    assert.equal(call.path, '/v1/generate/details');
    await held;
    return { json: finalIdeas([['Cedarink', 'cedarink.com']]) };
  });
  await search(page, 'idea', ideaText);
  await page.getByText('Refine these ideas').click();
  await page.getByRole('combobox').first().selectOption('Mapfern');
  await page.getByRole('button', { name: 'Find more names' }).click();
  const results = page.locator('#search-results');
  await results.getByText(collectingNames, { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Name or idea', exact: true }).fill('Cedar');
  assert.equal(await results.getByText(collectingNames, { exact: true }).count(), 0);
  release();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await results.locator('article h3').allTextContents(), ['Trailfin']);
});

for (const width of [390, 1440]) {
  test('idea search filters names and uses steering for the second round at ' + width + 'px', async t => {
    const { page, calls } = await openShortlistPage(t, call => {
      assert.equal(call.path, '/v1/generate');
      assert.equal(call.method, 'POST');
      return { json: ideas(call.body.round === 2 ? [['Flintmap', 'flintmap.com']] : [...shortlist].reverse()) };
    }, { width });
    await search(page, 'idea', ideaText);
    const results = page.locator('#search-results');
    const cards = results.getByRole('article');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    const card = cards.first();
    assert.ok(await card.locator('.name-score').isVisible());
    assert.equal(await card.locator('.reason-list').isVisible(), false);
    assert.ok(await card.getByRole('link', { name: 'Share', exact: true }).isVisible());
    await card.getByText('Why this name?').click();
    const content = await card.innerText();
    for (const pattern of [/74\/100/, /Workable/, /mapfern.com/, /\$6\.25/, /\$16\.50/,
      /US trademarks not checked/]) assert.match(content, pattern);
    assert.equal(await card.locator('li').count(), 3);
    assert.equal(await card.getByRole('link', { name: 'Share', exact: true }).getAttribute('href'),
      receipt('Mapfern', 'mapfern.com'));
    assert.equal(calls[0].body.idea, ideaText);
    assert.doesNotMatch(await results.innerText(), /takenname|unverified/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await results.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'idea-' + width);

    await results.getByText('Refine these ideas').click();
    const boxes = results.getByRole('combobox');
    for (const [i, name] of ['Mapfern', 'Trailfin', 'Mossfold'].entries()) await boxes.nth(i).selectOption(name);
    await results.getByRole('button', { name: 'Find more names' }).click();
    await results.getByRole('heading', { name: 'Flintmap' }).waitFor();
    assert.deepEqual(calls.filter(call => call.path === '/v1/generate')[1].body, { idea: ideaText, round: 2, wanted: ['Mapfern', 'Trailfin'], avoid: ['Mossfold'] });
  });
}

for (const mode of ['personal']) {
  test(mode + ' field routes a full name to personal search', async t => {
    const { page } = await openPage(t, call => {
      if (call.path === '/v1/check') return { json: bareReply('alexsample', { me: 'available' }) };
      assert.equal(call.path, '/v1/personal');
      assert.equal(call.method, 'POST');
      assert.deepEqual(call.body, { fullName: 'Alex Sample' });
      assert.equal(call.query.size, 0);
      return { json: { results: [{ ...domainRow('alexsample.me'), bestPrice: price('alexsample.me') }], complete: true } };
    });
    await search(page, mode, 'Alex Sample');
    await page.getByText('alexsample.me', { exact: true }).waitFor();
    const book = page.getByRole('link', { name: /Buy .* at Spaceship/ });
    assert.equal(await book.getAttribute('href'), price('alexsample.me').buyUrl);
    assert.equal(new URL(page.url()).search, '');
  });
}

test('a full name in the main field is checked as a name, never routed to personal search', async t => {
  const { page, calls } = await openPage(t, call => {
    assert.equal(call.path, '/v1/check');
    assert.equal(call.query.get('name'), 'Alex Sample');
    return { json: bareReply('alexsample', { com: 'available' }, 'Alex Sample') };
  });
  await search(page, 'name', 'Alex Sample');
  await page.locator('.best-domain').getByText('alexsample.com', { exact: true }).waitFor();
  assert.equal(calls.length, 1);
  assert.equal(await page.getByText('Check as a startup name').count(), 0);
});

test('details use manual links for unknowns and restrict platform destinations', async t => {
  const { page } = await openPage(t, call => {
    if (call.path === '/v1/check') return { json: checkReply(true) };
    assert.equal(call.path, '/v1/check/details');
    return { json: {
      complete: false, appStore: { status: 'unknown', matches: [] },
      trademarks: { us: { status: 'no_exact_match_found', marks: [], searchUrl: 'https://tmsearch.uspto.gov/' } },
      googlePlay: { status: 'check', link: 'https://play.google.com/store/search?q=mapfern' },
      handles: [
        { platform: 'GitHub', state: 'not-found', link: 'https://github.com/mapfern' },
        { platform: 'Instagram', state: 'check', link: 'https://social.example/mapfern' },
        { platform: 'Community', state: 'check', link: 'http://social.example/reader' },
        { platform: 'Reader', state: 'check', link: 'https://reader.example/profile?name=mapfern' }
      ]
    } };
  });
  await search(page, 'name', 'Mapfern');
  await page.getByRole('link', { name: /No public profile found/ }).waitFor();
  const details = page.locator('.detail-checks');
  assert.doesNotMatch(await details.innerText(), /trademark/i);
  assert.equal(await details.locator('a[href*="social.example"]').count(), 0);
  assert.equal(await details.locator('a[href="https://reader.example/profile?name=mapfern"]').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Google Play · Check' }).getAttribute('href'),
    'https://play.google.com/store/search?q=mapfern');
});

test('an unconfirmed or over-budget idea never becomes a bookable suggestion', async t => {
  const reply = ideas([['Mapfern', 'mapfern.com'], ['Trailfin', 'trailfin.com']]);
  reply.names[0].domains[0].evidence = null;
  for (const offer of reply.names[1].domain.prices) offer.threeYearUsd = 84;
  const { page } = await openPage(t, () => ({ json: reply }));
  await search(page, 'idea', ideaText);
  await page.getByText(/No available names confirmed/).waitFor();
  assert.equal(await page.locator('#search-results article').count(), 0);
});

test('single-offer API replies show the actual purchase and renewal prices on idea and personal searches', async t => {
  const { page } = await openShortlistPage(t, call => {
    if (call.path === '/v1/generate') {
      const reply = ideas([['Mapfern', 'mapfern.com']]);
      delete reply.names[0].domain.prices;
      reply.priceSnapshot = { checkedAt: '2026-11-24' };
      return { json: reply };
    }
    if (call.path === '/v1/check') return { json: { domains: [{ ...domainRow('alexsample.me'), prices: [domainRow('alexsample.me').prices[0]] }] } };
    const row = domainRow('alexsample.me');
    const { shop, buyUrl, firstPaymentUsd, renewalUsd, minimumYears, threeYearUsd, checkedAt } = row.prices[0];
    delete row.prices;
    return { json: { results: [{ ...row, bestPrice: { shop, buyUrl, firstPaymentUsd, renewalUsd,
      minimumYears, threeYearUsd, checkedAt } }], complete: true } };
  });
  for (const [mode, input] of [['idea', ideaText], ['personal', 'Alex Sample']]) {
    await search(page, mode, input);
    await page.getByRole('article').getByText('$14.00 first year', { exact: true }).waitFor();
    await page.getByRole('link', { name: /Buy .* at Gandi/ }).waitFor();
    await page.getByRole('article').getByText('Renewal $9.00/year').waitFor();
  }
});

test('the field guesses a name or an idea', async () => {
  const { guessMode } = await import(pathToFileURL(path.join(root, 'assets/search-mode.mjs')).href);
  const cases = [
    ['', null], ['   ', null],
    ['Mapfern', 'name'], ['mapfern.com', 'name'], ['example.co.uk', 'name'], ['Example Studio', 'name'],
    ['my trip app', 'name'], ['  my   trip   app  ', 'name'], ['trip-app', 'name'], ['Grønn Stue', 'name'],
    ['abcdefghijklmnopqrstuvwxyz1234', 'name'], ['abcdefghijklmnopqrstuvwxyz12345', 'idea'],
    ['four words make ideas', 'idea'], ['A trip planner for people who travel by train', 'idea'],
    ['Name my trip app.', 'name'], ['A planner for trains. Simple.', 'name'],
    ['Hello, world', 'idea'], ['what?', 'idea'], ['Wren & Willow', 'idea'], ['Mira’s app', 'idea'],
    ['-mapfern', 'idea'], ['trip app!', 'idea']
  ];
  for (const [text, mode] of cases) assert.equal(guessMode(text), mode, JSON.stringify(text));
});

test('the hint follows typing and one click switches name and idea before, during and after a search', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let checks = 0;
  const { page, calls } = await openShortlistPage(t, async call => {
    if (call.path === '/v1/check') {
      assert.equal(call.query.get('name'), 'my trip app');
      checks += 1;
      if (checks === 1) await held;
      return { json: bareReply('mytripapp', { com: 'available' }, 'my trip app') };
    }
    assert.equal(call.path, '/v1/generate');
    assert.deepEqual(call.body, { idea: 'my trip app' });
    return { json: ideas([['Railnest', 'railnest.com']]) };
  });
  const field = page.getByRole('textbox', { name: 'Name or idea', exact: true });
  const hint = page.locator('#search-hint-text');
  const toIdea = page.getByRole('button', { name: 'Search as an idea' });
  const toName = page.getByRole('button', { name: 'Search as a name' });
  const sniff = page.getByRole('button', { name: 'Find it here', exact: true });
  const results = page.locator('#search-results');
  await field.fill('Mapfern');
  assert.equal(await hint.textContent(), 'Name search');
  await field.fill('A trip planner for people who travel by train');
  assert.equal(await hint.textContent(), 'Name ideas');
  await field.fill('');
  assert.equal(await page.locator('.search-hint').isVisible(), false);
  assert.equal(await hint.textContent(), '');

  // Before a search, the switch only changes the route; typing resets it.
  await field.fill('my trip app');
  assert.equal(await hint.textContent(), 'Name search');
  await toIdea.click();
  assert.equal(await hint.textContent(), 'Name ideas');
  assert.equal(calls.length, 0);
  await field.fill('my trip app');
  assert.equal(await hint.textContent(), 'Name search');

  // During a name check, one click runs the idea search and the late name answer is dropped.
  await sniff.click();
  await page.getByText('Checking domains and prices…').waitFor();
  await toIdea.click();
  await results.getByRole('heading', { name: 'Railnest' }).waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await results.locator('.best-domain').getByText('mytripapp.com', { exact: true }).count(), 0);
  assert.equal(await results.getByRole('heading', { name: 'my trip app' }).count(), 0);

  // A new submission on the same text keeps the chosen route.
  await sniff.click();
  await page.waitForFunction(() => document.querySelector('.hunt-submit').getAttribute('aria-disabled') === null);
  assert.equal(calls.filter(call => call.path === '/v1/generate').length, 2);

  // After an answer, one click runs the name check and replaces the shortlist.
  await toName.click();
  await results.locator('.best-domain').getByText('mytripapp.com', { exact: true }).waitFor();
  assert.equal(await results.getByRole('heading', { name: 'Railnest' }).count(), 0);
  assert.equal(checks, 2);
  await field.press('End');
  await field.press('s');
  assert.equal(await hint.textContent(), 'Name search');
});

test('the best domain shows only a server pick that matches a confirmed row and its registrar offer', async t => {
  const exact = checkReply();
  const tampered = [
    reply => { reply.choice.pick.firstPaymentUsd = 13; },
    reply => { reply.choice.pick.shop = 'Porkbun'; reply.choice.pick.buyUrl = null; },
    reply => { reply.choice.pick.domain = 'mapfern.dev'; reply.choice.pick.buyUrl = 'https://shop.gandi.net/en/domain/suggest?search=mapfern.dev'; },
    reply => { reply.domains[0].evidence = null; },
    reply => { reply.domains[0].priceShown = false; },
    reply => { reply.choice = null; delete reply.query; }
  ].map(change => { const reply = checkReply(); change(reply); return reply; });
  const replies = [exact, ...tampered];
  const { page } = await openPage(t, call => ({ json: replies.shift() }));
  await search(page, 'name', 'Mapfern');
  await page.locator('.best-domain').getByRole('link', { name: /Buy .* at Gandi/ }).waitFor();
  for (let i = 0; i < tampered.length; i++) {
    await search(page, 'name', 'Mapfern');
    await page.getByRole('heading', { name: 'Mapfern', exact: true }).waitFor();
    assert.equal(await page.locator('.best-domain').count(), 0, 'tampered pick ' + i);
  }
  assert.equal(replies.length, 0);
});

test('the best domain shows the full two-year payments inline', async t => {
  const ai = domainRow('mapfern.ai');
  ai.prices = [price(ai.domain, {
    shop: 'Cloudflare', minimumYears: 2, firstYearUsd: 65, firstPaymentUsd: 130, renewalUsd: 70,
    renewalPaymentUsd: 140, threeYearUsd: 270, renewalJump: false, needsCloudflareDns: true,
    buyUrl: 'https://www.cloudflare.com/domains/search/?q=mapfern.ai'
  })];
  const { page } = await openPage(t, () => ({ json: {
    ...checkReply(), query: { name: 'mapfern', ascii: 'mapfern', exactDomain: 'mapfern.ai' },
    domains: [ai], choice: choiceFor(ai, 'Cloudflare'), details: { id: null, status: 'unavailable' }
  } }));
  await search(page, 'name', 'mapfern.ai');
  const best = page.locator('.best-domain');
  await best.getByRole('link', { name: /Buy .* at Cloudflare/ }).waitFor();
  const text = await best.innerText();
  assert.match(text, /\$130\.00 for 2 years/);
  assert.match(text, /Renewal \$140\.00 for 2 years/);
  assert.match(text, /You must use Cloudflare DNS/);
  assert.doesNotMatch(await page.locator('#search-results').innerText(), /No endings could be verified/);
});

// Mapfern: .com, .io, .dev and .app confirmed taken; only .xyz and .tech can be booked.
function takenHandler({ generate, seed = 'Mapfern' } = {}) {
  return call => {
    if (call.path === '/v1/generate') {
      assert.deepEqual(call.body, { idea: 'names like ' + seed, wanted: [seed] });
      return generate ? generate(call) : { json: ideas([
        ['Mapfern', 'mapfern.si', 'available', 95], ['Getmapfern', 'getmapfern.com', 'available', 90],
        ['Takenfern', 'takenfern.com', 'taken', 99], ['Fernly', 'fernly.com', 'available', 61],
        ['Mapwise', 'mapwise.dev', 'available', 80], ['Fernpath', 'fernpath.app', 'available', 61],
        ['Mossmap', 'mossmap.com', 'available', 70], ['Trailfern', 'trailfern.me', 'available', 55],
        ['Fernhaus', 'fernhaus.xyz', 'available', 50], ['Mapcrest', 'mapcrest.com', 'available', 45],
        ['Unsure', 'unsure.com', 'unknown', 88]
      ]) };
    }
    assert.equal(call.path, '/v1/check');
    const name = call.query.get('name');
    if (name === 'Mapfern' || name === 'mapfern') return { json: bareReply('mapfern', { xyz: 'available', tech: 'available' }, 'Mapfern') };
    if (name === 'getmapfern') return { json: bareReply('getmapfern', { com: 'available' }) };
    if (name === 'trymapfern') return { json: bareReply('trymapfern') };
    if (name === 'mapfernhq') return { json: bareReply('mapfernhq', { dev: 'available' }) };
    if (name === 'mapfernapp') return { status: 503, json: { error: 'unavailable' } };
    assert.fail('Unexpected check ' + name);
  };
}

test('a taken name shows the idea preview while close variants are still being checked', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const prefix = ['Getmapfern', 'getmapfern.com', 'available', 90];
  const fernly = ['Fernly', 'fernly.com', 'available', 61];
  const fallback = takenHandler({ generate: () => ({ json: initialIdeas([fernly]) }) });
  const { page } = await openShortlistPage(t, async call => {
    if (call.path === '/v1/generate/details') {
      await held;
      return { json: finalIdeas([fernly, prefix, ['Mapwise', 'mapwise.dev', 'available', 80]]) };
    }
    if (call.path === '/v1/check' && call.query.get('name') === 'getmapfern') await held;
    return fallback(call);
  });
  await search(page, 'name', 'Mapfern');
  const recovery = page.getByRole('region', { name: 'Similar names' });
  await recovery.getByText(collectingNames, { exact: true }).waitFor();
  assert.deepEqual(await recovery.locator('article h3').allTextContents(), ['Fernly']);
  release();
  await recovery.getByRole('heading', { name: 'Mapwise' }).waitFor();
  assert.deepEqual(await recovery.locator('article h3').allTextContents(),
    ['getmapfern', 'mapfernhq', 'Mapwise', 'Fernly']);
  assert.equal(await recovery.locator(':scope > [role=status]').textContent(), '');
});

for (const width of [390, 1440]) {
  test('a taken name brings back similar available names without another click at ' + width + 'px', async t => {
    const { page, calls } = await openShortlistPage(t, call => takenHandler()(call), { width });
    await search(page, 'name', 'Mapfern');
    const results = page.locator('#search-results');
    const recovery = results.getByRole('region', { name: 'Similar names' });
    await recovery.getByRole('heading', { name: 'Similar names', exact: true }).waitFor();
    await recovery.getByRole('heading', { name: 'Fernhaus' }).waitFor();
    await page.waitForLoadState('networkidle');
    await results.locator('.best-domain').getByText('mapfern.xyz', { exact: true }).waitFor();
    assert.deepEqual(await recovery.locator('article h3').allTextContents(),
      ['getmapfern', 'mapfernhq', 'Mapwise', 'Mossmap', 'Fernly', 'Fernpath', 'Trailfern', 'Fernhaus']);
    // Variants book the server pick; generated names book their lowest first-year offer.
    assert.equal(await recovery.getByRole('link', { name: /Buy .* at Gandi/ }).count(), 2);
    assert.equal(await recovery.getByRole('link', { name: /Buy .* at Spaceship/ }).count(), 6);
    assert.equal(await recovery.getByText('getmapfern.com', { exact: true }).count(), 1);
    assert.equal(await recovery.locator(':scope > [role=status]').textContent(), '');
    const owner = results.locator(':scope > .wrap > article').getByRole('link', { name: 'how to buy a taken domain' });
    assert.equal(await owner.getAttribute('href'), '/guides/buy-a-taken-domain/');
    // The ending rows stay, including the low-tier endings that can be booked.
    await results.locator('.ending-list').getByText('mapfern.tech', { exact: true }).waitFor();
    assert.equal(await results.locator(':scope article[aria-label="mapfern"] .ending-list').getByRole('link', { name: /^Buy / }).count(), 2);
    const checked = calls.filter(call => call.path === '/v1/check').map(call => call.query.get('name'));
    assert.deepEqual(checked.map(name => name.toLowerCase()).sort(),
      ['mapfern', 'getmapfern', 'mapfernapp', 'mapfernhq', 'trymapfern', 'mapwise', 'mossmap', 'fernly', 'fernpath', 'trailfern', 'fernhaus'].sort());
    await recovery.locator('a[href="https://www.instagram.com/mapwise"]').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await recovery.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'taken-' + width);
  });
}

test('an unknown leading ending keeps the plain result instead of the taken fallback', async t => {
  const { page, calls } = await openPage(t, () => ({
    json: bareReply('mapfern', { io: 'unknown', xyz: 'available' }, 'Mapfern')
  }));
  await search(page, 'name', 'Mapfern');
  await page.locator('.best-domain').getByText('mapfern.xyz', { exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText('Similar names').count(), 0);
  assert.equal(calls.length, 1);
});

test('taken hyphenated international names get four variants without added separators', async t => {
  const name = 'Blå-Furu';
  const ascii = new URL('https://' + name + '.com').hostname.split('.')[0];
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/generate') {
      assert.deepEqual(call.body, { idea: 'names like ' + name, wanted: [name] });
      return { json: ideas([]) };
    }
    const label = call.query.get('name');
    if (label === name) return { json: bareReply(ascii, {}, name) };
    const variant = new URL('https://' + label + '.com').hostname.split('.')[0];
    return { json: bareReply(variant, { com: 'available' }, label) };
  });
  await search(page, 'name', name);
  const recovery = page.getByRole('region', { name: 'Similar names' });
  await recovery.locator('article').nth(3).waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/v1/check').map(call => call.query.get('name')).sort(),
    [name, 'getblåfuru', 'tryblåfuru', 'blåfuruhq', 'blåfuruapp'].sort());
});

test('an exact taken .com checks other endings and shows the original domain once above available endings', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check' && call.query.get('name') === 'mapfern.com') {
      return { json: { ...bareReply('mapfern', {}, 'mapfern'), query: { name: 'mapfern', ascii: 'mapfern', exactDomain: 'mapfern.com' },
        domains: [domainRow('mapfern.com', 'taken')], choice: choiceFor(null) } };
    }
    return takenHandler({ seed: 'mapfern', generate: () => ({ status: 503, json: { error: 'unavailable' } }) })(call);
  });
  await search(page, 'name', 'mapfern.com');
  const results = page.locator('#search-results');
  const recovery = results.getByRole('region', { name: 'Similar names' });
  await recovery.getByText('Couldn’t load name ideas.', { exact: true }).waitFor();
  assert.equal(calls[0].query.get('name'), 'mapfern.com');
  assert.equal(calls[1].query.get('name'), 'mapfern');
  await results.locator('.top-taken').getByText('mapfern.com', { exact: true }).waitFor();
  // The exact row appears once, as typed and checked.
  assert.equal(await results.locator('.domain-title', { hasText: /^mapfern\.com$/ }).count(), 1);
  await results.locator('a[href="/watch/?domain=mapfern.com"]').waitFor();
  assert.deepEqual(await recovery.locator('article h3').allTextContents(), ['getmapfern', 'mapfernhq']);
  assert.equal(await results.locator(':scope > .wrap > article').getByRole('link', { name: 'how to buy a taken domain' })
    .getAttribute('href'), '/guides/buy-a-taken-domain/');
  const titles = await results.locator('.domain-title').allTextContents();
  assert.ok(titles.indexOf('mapfern.tech') >= 0 && titles.indexOf('mapfern.tech') > titles.indexOf('mapfern.com'));
});

test('failed close-name lookups say so and never hide the ending rows', async t => {
  const { page } = await openPage(t, call => {
    if (call.path === '/v1/check' && call.query.get('name') === 'Mapfern') {
      return { json: bareReply('mapfern', { xyz: 'available' }, 'Mapfern') };
    }
    return { status: 429, json: { error: 'rate-limited', retryAfterSeconds: 60 } };
  });
  await search(page, 'name', 'Mapfern');
  const recovery = page.getByRole('region', { name: 'Similar names' });
  await recovery.getByText(breather, { exact: true }).waitFor();
  assert.equal(await recovery.locator('article').count(), 0);
  await page.locator('.best-domain').getByText('mapfern.xyz', { exact: true }).waitFor();
});

test('editing a taken name aborts its close-name lookups before the next search', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let generating;
  const started = new Promise(resolve => { generating = resolve; });
  const { page } = await openPage(t, async call => {
    if (call.path === '/v1/check' && call.query.get('name') === 'Trailfin') {
      return { json: bareReply('trailfin', { com: 'available' }, 'Trailfin') };
    }
    if (call.path === '/v1/generate') {
      generating();
      await held;
    }
    return takenHandler()(call);
  });
  await search(page, 'name', 'Mapfern');
  await started;
  const results = page.locator('#search-results');
  await page.getByRole('textbox', { name: 'Name or idea' }).fill('Trail');
  await results.waitFor({ state: 'hidden' });
  await search(page, 'name', 'Trailfin');
  await results.locator('.best-domain').getByText('trailfin.com', { exact: true }).waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await results.getByText('Similar names').count(), 0);
  assert.equal(await results.getByRole('heading', { name: 'Mapwise' }).count(), 0);
});

for (const width of [390, 1440]) {
  test('mixed result puts available domains first and loads name checks at ' + width + 'px', async t => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    t.after(release);
    const { page, calls } = await openPage(t, async call => {
      if (call.path === '/v1/check') {
        const reply = checkReply(true);
        reply.domains = ['net', 'xyz', 'com', 'app', 'io', 'dev'].map((ending, i) =>
          domainRow('mapfern.' + ending, ['taken', 'unknown', 'available', 'taken', 'available', 'available'][i]));
        reply.choice = choiceFor(reply.domains.at(-1));
        return { json: reply };
      }
      assert.equal(call.path, '/v1/check/details');
      await held;
      return { json: profileChecks('mapfern') };
    }, { width });
    await search(page, 'name', 'Mapfern');
    const results = page.locator('#search-results');
    const best = results.locator('.best-domain');
    await best.getByText('mapfern.dev', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const top = document.querySelector('.best-domain').getBoundingClientRect();
      return top.top < innerHeight && top.bottom > 0;
    });
    const details = results.locator('.detail-checks');
    await details.getByRole('status').filter({ hasText: /check|load/i }).waitFor();
    assert.equal(await results.getByText('mapfern.xyz', { exact: true }).count(), 0);
    const taken = results.locator('.taken-group');
    assert.deepEqual(await taken.locator('a[href^="/watch/"]').evaluateAll(nodes =>
      nodes.map(node => new URL(node.href).searchParams.get('domain')).sort()), ['mapfern.app', 'mapfern.net']);
    assert.equal(await page.locator('#real-search').isVisible(), false);
    const order = await results.locator('.domain-title').allTextContents();
    assert.deepEqual(order.slice(0, 3), ['mapfern.dev', 'mapfern.com', 'mapfern.io']);
    assert.match(await taken.innerText(), /draft an offer/);
    assert.ok(await taken.locator('a[href="#install"]').isVisible());
    release();
    await details.getByRole('link', { name: /No public profile found/ }).waitFor();
    assert.equal(await details.locator('a[href*="social.example"]').count(), 0);
    assert.deepEqual(await details.locator('.check-chip').allTextContents(),
      ['App Store', 'Google Play', 'LinkedIn', 'X', 'Instagram', 'TikTok', 'YouTube', 'GitHub']);
    assert.ok(await details.evaluate(box => box.previousElementSibling.matches('.ending-list') &&
      box.nextElementSibling.matches('.taken-group') && box.parentElement.matches('article')));
    assert.equal(await details.locator('a[href="https://www.instagram.com/mapfern"]').count(), 1);
    assert.doesNotMatch(await details.innerText(), /No public profile found/i);
    assert.doesNotMatch(await details.innerText(), /\bfree\b|\bavailable\b/i);
    assert.equal(calls.filter(call => call.path === '/v1/check/details').length, 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(page, 'mixed-' + width, results);
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 700 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  });

  test('generator checks each available name once at ' + width + 'px', async t => {
    const names = ['Mapfern', 'Trailfin', 'Mossfold', 'Cedarink', 'Fernpath'];
    const { page, calls } = await openPage(t, call => {
      if (call.path === '/v1/generate') {
        const reply = ideas(names.map((name, i) => [name, name.toLowerCase() + '.com', 'available', 85 - i]));
        for (const item of reply.names) {
          const stem = item.name.toLowerCase();
          item.score.reasons = ['.com is available.', 'One obvious spelling.'];
          item.domains.unshift(domainRow(stem + '.app', 'taken'), domainRow(stem + '.xyz', 'unknown'), domainRow(stem + '.dev'));
        }
        return { json: reply };
      }
      if (call.path === '/v1/check') {
        const stem = call.query.get('name').toLowerCase();
        return { json: { ...bareReply(stem, { com: 'available', dev: 'available', xyz: 'unknown' }), details: detailToken(stem) } };
      }
      assert.equal(call.path, '/v1/check/details');
      return { json: profileChecks(call.query.get('id')) };
    }, { width });
    await search(page, 'idea', ideaText);
    const results = page.locator('#search-results');
    const cards = results.locator('.idea-list article');
    for (let i = 0; i < 5; i++) {
      const card = cards.nth(i);
      const stem = names[i].toLowerCase();
      await card.getByRole('link', { name: /No public profile found/ }).waitFor();
      assert.match(await card.innerText(), new RegExp(stem + '\\.dev|\\.dev\\b'));
      assert.doesNotMatch(await card.innerText(), /\.xyz\b/);
    }
    const queried = () => calls.filter(call => call.path === '/v1/check/details').map(call => call.query.get('id'));
    assert.deepEqual(queried().sort(), names.map(name => name.toLowerCase()).sort());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(page, 'generator-' + width, results);
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 700 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await cards.nth(4).getByRole('link', { name: /No public profile found/ }).waitFor();
    assert.equal(queried().length, 5);
  });
}

test('all available endings stay in quality order after the pick', async t => {
  const domains = ['dev', 'com', 'io'].map(ending => domainRow('mapfern.' + ending));
  const { page } = await openPage(t, () => ({ json: { domains, choice: choiceFor(domains[0]) } }));
  await search(page, 'name', 'Mapfern');
  await page.locator('.best-domain').waitFor();
  assert.deepEqual(await page.locator('#search-results .domain-title').allTextContents(), ['mapfern.dev', 'mapfern.com', 'mapfern.io']);
  assert.equal(await page.locator('.taken-group').isVisible(), false);
});

test('all taken endings have watch links and no checkout', async t => {
  const domains = ['com', 'dev', 'app'].map(ending => domainRow('mapfern.' + ending, 'taken'));
  const { page } = await openPage(t, () => ({ json: { domains, choice: null } }));
  await search(page, 'name', 'Mapfern');
  const taken = page.locator('article');
  await taken.locator('.taken-list b').waitFor();
  assert.deepEqual(await taken.locator('a[href^="/watch/"]').evaluateAll(links =>
    links.map(link => new URL(link.href).searchParams.get('domain')).sort()), domains.map(row => row.domain).sort());
  assert.equal(await page.getByRole('link', { name: /^Buy / }).count(), 0);
});

test('rate-limited name checks can be retried without rechecking domains', async t => {
  let attempts = 0;
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check') return { json: checkReply(true) };
    assert.equal(call.path, '/v1/check/details');
    return ++attempts === 1 ? { status: 429, json: { error: 'rate-limited' } } : { json: profileChecks('mapfern') };
  });
  await search(page, 'name', 'Mapfern');
  const details = page.locator('.detail-checks');
  await details.getByText(breather, { exact: true }).waitFor();
  assert.ok(await page.locator('.best-domain a.action').isVisible());
  await details.getByRole('button', { name: /retry/i }).click();
  await details.getByRole('link', { name: /No public profile found/ }).waitFor();
  assert.deepEqual(calls.map(call => call.path), ['/v1/check', '/v1/check/details', '/v1/check/details']);
});

test('a late handle response cannot attach itself to the next name', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(release);
  const { page } = await openPage(t, async call => {
    if (call.path === '/v1/check') {
      const name = call.query.get('name').toLowerCase();
      return { json: { ...bareReply(name, { com: 'available' }), details: detailToken(name) } };
    }
    const name = call.query.get('id');
    if (name === 'mapfern') await held;
    return { json: profileChecks(name) };
  });
  const started = page.waitForRequest(req => req.url() === api + '/v1/check/details?id=mapfern');
  await search(page, 'name', 'Mapfern');
  await started;
  await search(page, 'name', 'Trailfin');
  const details = page.locator('.detail-checks');
  await details.locator('a[href="https://www.instagram.com/trailfin"]').waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await details.locator('a[href="https://www.instagram.com/mapfern"]').count(), 0);
  assert.ok(await page.locator('.best-domain').getByText('trailfin.com', { exact: true }).isVisible());
});

test('an all-taken name ignores a details token even when the API supplies one', async t => {
  const { page, calls } = await openPage(t, call => ({
    json: call.path === '/v1/check' ? {
      domains: [domainRow('mapfern.io', 'taken')], details: detailToken('mapfern')
    } : profileChecks('mapfern')
  }));
  await page.locator('#name').fill('mapfern.io');
  await page.locator('#name').press('Enter');
  await page.locator('a[href="/watch/?domain=mapfern.io"]').waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(calls.map(call => call.path), ['/v1/check']);
  assert.equal(await page.locator('.detail-checks').count(), 0);
});

test('a suggested name uses the refreshed domain variations before loading its apps and handles', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/generate') return { json: ideas([['Mapfern', 'mapfern.dev'], ['Trailfin', 'trailfin.io']]) };
    if (call.path === '/v1/check/details') return { json: profileChecks(call.query.get('id')) };
    const name = call.query.get('name').toLowerCase();
    return { json: { ...bareReply(name, name === 'mapfern' ? { dev: 'available', app: 'available' } : {}),
      details: detailToken(name) } };
  });
  await search(page, 'idea', ideaText);
  await page.waitForLoadState('networkidle');
  const open = page.locator('article[aria-label="Mapfern"]');
  assert.deepEqual(await open.locator('.top-taken a').allTextContents(), ['mapfern.com Taken · Watch', '.ai', '.io']);
  assert.equal(await open.getByRole('link', { name: 'Buy mapfern.app at Spaceship' }).count(), 1);
  const taken = page.locator('article[aria-label="Trailfin"]');
  assert.equal(await taken.locator('.detail-checks, .offer-row').count(), 0);
  assert.deepEqual(calls.filter(call => call.path === '/v1/check/details').map(call => call.query.get('id')), ['mapfern']);
});

test('older and current shared shortlists show availability without changing the encoded status indexes', async t => {
  const { page } = await openPage(t, () => assert.fail('A receipt should open locally'));
  for (const version of [1, 2]) {
    const group = ['Mapfern', 0, 'mapfern', [['.ai', 0, 13000, 14000, 2], ['.io', 8, null, null, 1]]];
    if (version === 2) group.push({ p: 0 });
    const encoded = deflateSync(JSON.stringify([checkedAt, [group]])).toString('base64url');
    await page.goto(site + '/r/#' + version + '.' + encoded);
    await page.locator('#receipt').waitFor();
    const receipt = await page.locator('#receipt').innerText();
    assert.match(receipt, /Available/);
    assert.match(receipt, /May be available. Check the shop./);
    assert.match(receipt, /\$140\.00 for 2 years/);
    assert.doesNotMatch(receipt, /\bfree\b/i);
  }
});

for (const reducedMotion of ['reduce', 'no-preference']) {
  test('first answer fits the phone and announces the outcome with motion ' + reducedMotion, async t => {
    const reply = checkReply();
    reply.domains = ['com', 'io', 'ai', 'dev', 'net'].map(ending => domainRow('mapfern.' + ending));
    reply.domains[2].eligibility = { need: 'Local registration required.' };
    reply.domains[4].eligibility = {};
    reply.domains[3].prices.forEach(offer => { offer.checkedAt = '2026-11-24'; });
    const { page } = await openPage(t, () => ({ json: reply }), { reducedMotion });
    await page.locator('#name').fill('Mapfern');
    if (reducedMotion === 'reduce') await page.locator('#name').press('Enter');
    else await page.locator('.hunt-submit').first().click();
    await page.locator('.best-domain a').waitFor();
    await page.waitForFunction(() => {
      const rect = document.querySelector('.best-domain').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
    assert.equal(await page.locator('.results-head h2').evaluate(node => node === document.activeElement), true);
    assert.match(await page.locator('#result-announcement').textContent(), /mapfern.com.*available/i);
    assert.match(await page.locator('.offer-row').filter({ hasText: 'mapfern.ai' }).innerText(), /Local registration required/);
    const restricted = page.locator('.offer-row').filter({ hasText: 'mapfern.net' });
    assert.equal(await restricted.getByRole('link', { name: /^Buy / }).count(), 0);
    assert.match(await restricted.innerText(), /Check who can buy this domain/);
    assert.equal(await page.locator('.quote-caption').count(), 2);
  });
}

test('a taken exact domain lands with its watch link and a failed retry keeps the field in view', async t => {
  const domain = 'mapfern.org';
  const responses = [{ json: { domains: [domainRow(domain, 'taken')] } }, { status: 503, json: {} }];
  const { page } = await openPage(t, () => responses.shift(), { reducedMotion: 'reduce' });
  const field = page.locator('#name');
  await field.fill(domain);
  await field.press('Enter');
  const watch = page.getByRole('link', { name: 'Watch ' + domain });
  await watch.waitFor();
  assert.match(await watch.innerText(), /mapfern.org.*Taken.*Watch/);
  const inView = node => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  };
  assert.ok(await watch.evaluate(inView));
  assert.match(await page.locator('#result-announcement').innerText(), /mapfern.org: Taken/);
  await field.press('Enter');
  const error = page.getByRole('status').filter({ hasText: 'Couldn’t finish the search.' });
  await error.waitFor();
  assert.equal(await field.inputValue(), domain);
  assert.ok(await field.evaluate(node => node === document.activeElement));
  for (const node of [field, page.getByRole('button', { name: 'Find it here' }), error]) {
    assert.ok(await node.evaluate(inView));
  }
});

test('the comparison guide exposes the full evidence without scripts', async t => {
  const { page } = await openPage(t, () => assert.fail('Unexpected lookup'), { javaScriptEnabled: false });
  await page.goto(site + '/guides/com-vs-ai-vs-io/');
  const table = page.getByRole('table', { includeHidden: true });
  assert.equal(await table.isVisible(), false);
  assert.match(await page.locator('main > p').first().innerText(), /\$159\.96/);
  await page.getByText('See the prices, checks and sources').click();
  assert.ok(await table.isVisible());
  assert.equal(await page.locator('details[open] .source a').count(), 5);
  await page.getByText('FAQ', { exact: true }).click();
  assert.equal(await page.locator('details[open] dt').count(), 3);
});
