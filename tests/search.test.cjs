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
const breather = 'The hound needs a breather. Try again in a few minutes.';
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

function checkReply() {
  const name = 'Mapfern';
  const domains = ['com', 'dev', 'app'].map((ending, i) =>
    domainRow('mapfern.' + ending, ['available', 'taken', 'unknown'][i]));
  return { version: 1, query: { name, ascii: 'mapfern', exactDomain: null }, checkedAt, complete: false,
    domains, choice: choiceFor(domains[0]), share: { url: receipt(name, domains[0].domain) },
    details: { id: 'synthetic-details-token-for-the-browser-test', path: '/v1/check/details?id=synthetic-details-token-for-the-browser-test', pending: ['handles'] } };
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

async function openPage(t, handler, { width = 390, javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    javaScriptEnabled, serviceWorkers: 'block'
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

async function search(page, mode, value) {
  if (mode === 'personal') {
    const field = page.getByRole('textbox', { name: 'What’s your full name?', exact: true });
    if (!await field.isVisible()) await page.getByText('Use my own name', { exact: true }).click();
    await field.fill(value);
    await page.getByRole('button', { name: 'Find my domain', exact: true }).click();
    return;
  }
  await page.getByRole('textbox', { name: 'Name or idea', exact: true }).fill(value);
  const wanted = mode === 'name' ? 'Checking a name' : 'Finding free names for your idea';
  if (await page.locator('#search-hint-text').textContent() !== wanted) {
    await page.getByRole('button', { name: mode === 'name' ? 'Search this as a name instead' : 'Use this as an idea instead' }).click();
  }
  await page.getByRole('button', { name: 'Sniff it', exact: true }).click();
}

async function screenshot(page, filename) {
  const dir = process.env.SEARCH_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(dir, filename + '.png'), animations: 'disabled' });
}

for (const width of [390, 1440]) {
  test('homepage search and installer at ' + width + 'px', async t => {
    const { page } = await openPage(t, () => assert.fail('Unexpected search'), { width });
    const hero = page.locator('.hero');
    const field = hero.getByRole('textbox', { name: 'Name or idea', exact: true });
    const submit = hero.getByRole('button', { name: 'Sniff it', exact: true });
    await field.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await hero.locator('.stamp').textContent(), 'Name it already.');
    assert.equal((await hero.locator('h1').innerText()).replace(/\s+/g, ' '), 'Find a startup name you can actually buy.');
    assert.equal(await hero.locator('.subline').textContent(), 'Search domains right here for free. Or ask Claude or Codex to check domains, app names and Google.');
    assert.equal(await field.getAttribute('placeholder'), "A name, or what you're building");
    assert.equal(await hero.getByRole('textbox').count(), 1);
    assert.equal(await hero.locator('.search-hint').isVisible(), false);
    assert.equal(await hero.getByRole('link', { name: 'Need name ideas?' }).count(), 0);
    assert.deepEqual(await hero.locator('.search-paths a').allTextContents(), ['Use my own name']);
    assert.equal(await page.getByRole('heading', { name: 'A real search.' }).count(), 0);
    const install = page.locator('#install');
    const claude = install.getByRole('tab', { name: 'Claude Code' });
    const checkBounds = await submit.boundingBox();
    const installBounds = await install.boundingBox();
    if (width === 390) {
      const row = install.getByText('Install for Claude or Codex', { exact: true });
      assert.ok(await row.isVisible());
      assert.equal(await claude.isVisible(), false);
      assert.ok(checkBounds.y + checkBounds.height <= installBounds.y);
      const rowBounds = await row.boundingBox();
      assert.ok(rowBounds.y + rowBounds.height <= 844, 'Install row falls below first screen');
    } else {
      assert.ok(await claude.isVisible());
      assert.ok(installBounds.x >= checkBounds.x + checkBounds.width);
      assert.ok(installBounds.y < checkBounds.y + checkBounds.height);
    }
    await screenshot(page, 'hero-' + width);
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
    await best.getByRole('link', { name: 'Book it at Gandi for $14.00' }).waitFor();
    assert.equal((await best.locator('h3').innerText()).replace(/\s+/g, ' '), 'Best domain: mapfern.com');
    assert.match(await best.innerText(), /\$14\.00 first year, \$9\.00 renewal/);
    await page.getByText('Let your agent buy and watch it', { exact: true }).waitFor();
    await results.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'name-' + width);
    const installLink = results.locator('a[href="#install"]');
    await installLink.click();
    const setup = page.locator('#install');
    await setup.getByRole('tab', { name: 'Codex', exact: true }).waitFor();
    if (width === 390) {
      await setup.locator('summary').click();
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
  await page.getByRole('link', { name: 'Book it at Spaceship for $6.25' }).waitFor();
});

test('all endings show registry verdicts; only an available domain gets a booking link', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check/details') return { status: 410, json: { error: 'expired' } };
    assert.equal(call.path, '/v1/check');
    assert.equal(call.method, 'GET');
    assert.equal(call.query.get('name'), 'Mapfern');
    return { json: checkReply() };
  });
  await search(page, 'name', 'Mapfern');
  const book = page.getByRole('link', { name: /Book it at Gandi for \$14\.00/i });
  await book.waitFor();
  assert.equal(await book.getAttribute('href'), 'https://shop.gandi.net/en/domain/suggest?search=mapfern.com');
  assert.equal(await page.locator('.ending-list').getByText('mapfern.com', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: /Book it at/i }).count(), 1);
  for (const domain of ['mapfern.dev', 'mapfern.app']) {
    await page.getByText(domain, { exact: true }).first().waitFor();
  }
  await page.getByText('Check apps, trademarks and handles', { exact: true }).click();
  await page.getByText(/checks expired/).waitFor();
  assert.equal(calls[1].query.get('id'), 'synthetic-details-token-for-the-browser-test');
  assert.equal(await book.isVisible(), true);
  const share = page.getByRole('link', { name: 'Share shortlist' });
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
  await page.getByText('Couldn’t finish the search. Try again in a moment.').waitFor();
  await search(page, 'name', 'Mapfern');
  await page.getByRole('link', { name: /Book it at Gandi/i }).waitFor();
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
  await setup.locator('summary').click();
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
  const { page } = await openPage(t, async call => {
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
  const book = page.getByRole('link', { name: /Book it at Spaceship for \$130/i });
  await book.waitFor();
  const result = await page.locator('#search-results').innerText();
  assert.match(result, /\$140/);
  assert.match(result, /2 years|two.year/i);
  assert.match(result, /premium/i);
  assert.equal(await page.getByRole('link', { name: /Book it at/i }).count(), 1);
});

function ideas(names) {
  return {
    complete: true, path: 'qwen', names: names.map(([name, domain, status = 'available', total]) => {
      const row = domainRow(domain, status);
      const pick = { domain, ...row.prices[0], prices: row.prices, evidence: row.evidence, checkedAt };
      const score = { total: total ?? (name === 'Trailfin' ? 68 : name === 'Mossfold' ? 56 : 74),
        band: name === 'Mossfold' ? 'Risky' : 'Workable',
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

for (const width of [390, 1440]) {
  test('idea search filters names and uses steering for the second round at ' + width + 'px', async t => {
    const { page, calls } = await openPage(t, call => {
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
    const content = await card.innerText();
    for (const pattern of [/74\/100/, /Workable/, /mapfern.com/, /\$6\.25/, /\$16\.50/, /Renewal jumps/,
      /US trademarks not checked/]) assert.match(content, pattern);
    assert.equal(await card.locator('li').count(), 3);
    assert.equal(await card.getByRole('link', { name: 'Share', exact: true }).getAttribute('href'),
      receipt('Mapfern', 'mapfern.com'));
    assert.equal(calls[0].body.idea, ideaText);
    assert.doesNotMatch(await results.innerText(), /takenname|unverified/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await results.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'idea-' + width);

    const boxes = results.getByRole('combobox');
    for (const [i, name] of ['Mapfern', 'Trailfin', 'Mossfold'].entries()) await boxes.nth(i).selectOption(name);
    await results.getByRole('button', { name: 'Find more names' }).click();
    await results.getByRole('heading', { name: 'Flintmap' }).waitFor();
    assert.deepEqual(calls[1].body, { idea: ideaText, round: 2, wanted: ['Mapfern', 'Trailfin'], avoid: ['Mossfold'] });
  });
}

for (const mode of ['personal']) {
  test(mode + ' field routes a full name to personal search', async t => {
    const { page } = await openPage(t, call => {
      assert.equal(call.path, '/v1/personal');
      assert.equal(call.method, 'POST');
      assert.deepEqual(call.body, { fullName: 'Alex Sample' });
      assert.equal(call.query.size, 0);
      return { json: { results: [{ ...domainRow('alexsample.me'), bestPrice: price('alexsample.me') }], complete: true } };
    });
    await search(page, mode, 'Alex Sample');
    await page.getByRole('heading', { name: 'alexsample.me' }).waitFor();
    const book = page.getByRole('link', { name: /Book it at Spaceship/ });
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

test('details qualify unknowns, exact US marks and public profile checks', async t => {
  const { page } = await openPage(t, call => {
    if (call.path === '/v1/check') return { json: checkReply() };
    assert.equal(call.path, '/v1/check/details');
    return { json: {
      complete: false, appStore: { status: 'unknown', matches: [] },
      trademarks: { us: { status: 'no_exact_match_found', marks: [], searchUrl: 'https://tmsearch.uspto.gov/' } },
      googlePlay: { status: 'check', link: 'https://play.google.com/store/search?q=mapfern' },
      handles: [{ platform: 'GitHub', state: 'not-found', link: 'https://github.com/mapfern' }]
    } };
  });
  await search(page, 'name', 'Mapfern');
  await page.getByText('Check apps, trademarks and handles', { exact: true }).click();
  await page.getByText('No public profile found.', { exact: false }).waitFor();
  assert.match(await page.locator('.detail-checks').innerText(), /No exact live word mark found/);
  assert.equal(await page.getByRole('link', { name: 'Check Google Play' }).getAttribute('href'),
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

test('single-offer API replies disclose the three-year basis on idea and personal searches', async t => {
  const { page } = await openPage(t, call => {
    if (call.path === '/v1/generate') {
      const reply = ideas([['Mapfern', 'mapfern.com']]);
      delete reply.names[0].domain.prices;
      reply.priceSnapshot = { checkedAt: '2026-11-24' };
      return { json: reply };
    }
    const row = domainRow('alexsample.me');
    const { shop, buyUrl, firstPaymentUsd, renewalUsd, minimumYears, threeYearUsd, checkedAt } = row.prices[0];
    delete row.prices;
    return { json: { results: [{ ...row, bestPrice: { shop, buyUrl, firstPaymentUsd, renewalUsd,
      minimumYears, threeYearUsd, checkedAt } }], complete: true } };
  });
  for (const [mode, input] of [['idea', ideaText], ['personal', 'Alex Sample']]) {
    await search(page, mode, input);
    await page.getByRole('article').getByText('Lowest three-year cost · $32.00', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Book it at Gandi for $14.00' }).waitFor();
    if (mode === 'idea') await page.getByText(/Price snapshot 2026-11-24/).waitFor();
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
  const { page, calls } = await openPage(t, async call => {
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
  const toIdea = page.getByRole('button', { name: 'Use this as an idea instead' });
  const toName = page.getByRole('button', { name: 'Search this as a name instead' });
  const sniff = page.getByRole('button', { name: 'Sniff it', exact: true });
  const results = page.locator('#search-results');
  await field.fill('Mapfern');
  assert.equal(await hint.textContent(), 'Checking a name');
  await field.fill('A trip planner for people who travel by train');
  assert.equal(await hint.textContent(), 'Finding free names for your idea');
  await field.fill('');
  assert.equal(await page.locator('.search-hint').isVisible(), false);
  assert.equal(await hint.textContent(), '');

  // Before a search, the switch only changes the route; typing resets it.
  await field.fill('my trip app');
  assert.equal(await hint.textContent(), 'Checking a name');
  await toIdea.click();
  assert.equal(await hint.textContent(), 'Finding free names for your idea');
  assert.equal(calls.length, 0);
  await field.fill('my trip app');
  assert.equal(await hint.textContent(), 'Checking a name');

  // During a name check, one click runs the idea search and the late name answer is dropped.
  await sniff.click();
  await page.getByText('Checking endings and registrar prices…').waitFor();
  await toIdea.click();
  await results.getByRole('heading', { name: 'Railnest' }).waitFor();
  release();
  await page.waitForLoadState('networkidle');
  assert.equal(await results.locator('.best-domain').count(), 0);
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
  assert.equal(await hint.textContent(), 'Checking a name');
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
  await page.locator('.best-domain').getByRole('link', { name: 'Book it at Gandi for $14.00' }).waitFor();
  for (let i = 0; i < tampered.length; i++) {
    await search(page, 'name', 'Mapfern');
    await page.getByRole('heading', { name: 'Mapfern', exact: true }).waitFor();
    assert.equal(await page.locator('.best-domain').count(), 0, 'tampered pick ' + i);
  }
  assert.equal(replies.length, 0);
});

test('the best domain keeps the two-year term and Cloudflare DNS disclosures', async t => {
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
  await best.getByRole('link', { name: 'Book it at Cloudflare for $130.00' }).waitFor();
  const text = await best.innerText();
  assert.match(text, /\$65\.00 first year, \$70\.00 renewal/);
  assert.match(text, /2-year minimum\. \$130\.00 upfront, then \$140\.00 per 2 years\./);
  assert.match(text, /Needs Cloudflare DNS/);
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

for (const width of [390, 1440]) {
  test('a taken name brings back close free names without another click at ' + width + 'px', async t => {
    const { page, calls } = await openPage(t, call => takenHandler()(call), { width });
    await search(page, 'name', 'Mapfern');
    const results = page.locator('#search-results');
    const recovery = results.getByRole('region', { name: 'Free names close to yours' });
    await recovery.getByRole('heading', { name: 'Taken. Here are free names close to yours', exact: true }).waitFor();
    await recovery.getByRole('heading', { name: 'Fernhaus' }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await results.locator('.best-domain').count(), 0);
    assert.deepEqual(await recovery.locator('article h3').allTextContents(),
      ['getmapfern.com', 'mapfernhq.dev', 'Mapwise', 'Mossmap', 'Fernly', 'Fernpath', 'Trailfern', 'Fernhaus']);
    // Variants book the server pick; generated names book their lowest first-year offer.
    assert.equal(await recovery.getByRole('link', { name: 'Book it at Gandi for $14.00' }).count(), 2);
    assert.equal(await recovery.getByRole('link', { name: 'Book it at Spaceship for $6.25' }).count(), 6);
    assert.equal(await recovery.getByText('getmapfern.com', { exact: true }).count(), 1);
    assert.equal(await recovery.getByRole('status').textContent(), '');
    const owner = recovery.getByRole('link', { name: 'Who owns mapfern.com? See if it can be bought' });
    assert.equal(await owner.getAttribute('href'), '/land/?d=mapfern.com');
    // The ending rows stay, including the low-tier endings that can be booked.
    await results.locator('.ending-list').getByText('mapfern.xyz', { exact: true }).waitFor();
    assert.equal(await results.locator('.ending-list').getByRole('link', { name: /Book it at/ }).count(), 2);
    const checked = calls.filter(call => call.path === '/v1/check').map(call => call.query.get('name'));
    assert.deepEqual(checked.sort(), ['Mapfern', 'getmapfern', 'mapfernapp', 'mapfernhq', 'trymapfern']);
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
  assert.equal(await page.getByText('Taken. Here are free names close to yours').count(), 0);
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
  const recovery = page.getByRole('region', { name: 'Free names close to yours' });
  await recovery.locator('article').nth(3).waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/v1/check').map(call => call.query.get('name')).sort(),
    [name, 'getblåfuru', 'tryblåfuru', 'blåfuruhq', 'blåfuruapp'].sort());
});

test('an exact taken .com checks the bare name and keeps the exact answer separate', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check' && call.query.get('name') === 'mapfern.com') {
      return { json: { ...bareReply('mapfern', {}, 'mapfern'), query: { name: 'mapfern', ascii: 'mapfern', exactDomain: 'mapfern.com' },
        domains: [domainRow('mapfern.com', 'taken')], choice: choiceFor(null) } };
    }
    return takenHandler({ seed: 'mapfern', generate: () => ({ status: 503, json: { error: 'unavailable' } }) })(call);
  });
  await search(page, 'name', 'mapfern.com');
  const results = page.locator('#search-results');
  const recovery = results.getByRole('region', { name: 'Free names close to yours' });
  await recovery.getByText('Couldn’t load name ideas.', { exact: true }).waitFor();
  assert.equal(calls[0].query.get('name'), 'mapfern.com');
  assert.equal(calls[1].query.get('name'), 'mapfern');
  await results.getByRole('heading', { name: 'Other endings for mapfern' }).waitFor();
  // The exact row appears once, as typed and checked.
  assert.equal(await results.locator('.domain-title', { hasText: /^mapfern\.com$/ }).count(), 1);
  await results.locator('a[href="/watch/?domain=mapfern.com"]').waitFor();
  assert.deepEqual(await recovery.locator('article h3').allTextContents(), ['getmapfern.com', 'mapfernhq.dev']);
  assert.equal(await recovery.getByRole('link', { name: 'Who owns mapfern.com? See if it can be bought' })
    .getAttribute('href'), '/land/?d=mapfern.com');
  await results.locator('.more-endings').getByText('mapfern.tech', { exact: true }).waitFor();
});

test('failed close-name lookups say so and never hide the ending rows', async t => {
  const { page } = await openPage(t, call => {
    if (call.path === '/v1/check' && call.query.get('name') === 'Mapfern') {
      return { json: bareReply('mapfern', { xyz: 'available' }, 'Mapfern') };
    }
    return { status: 429, json: { error: 'rate-limited', retryAfterSeconds: 60 } };
  });
  await search(page, 'name', 'Mapfern');
  const recovery = page.getByRole('region', { name: 'Free names close to yours' });
  await recovery.getByText(breather, { exact: true }).waitFor();
  assert.equal(await recovery.locator('article').count(), 0);
  await page.locator('.ending-list').getByText('mapfern.xyz', { exact: true }).waitFor();
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
  assert.equal(await results.getByText('Taken. Here are free names close to yours').count(), 0);
  assert.equal(await results.getByRole('heading', { name: 'Mapwise' }).count(), 0);
});
