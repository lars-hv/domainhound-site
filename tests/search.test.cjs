const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
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

function checkReply() {
  const name = 'Mapfern';
  const domains = ['com', 'dev', 'app'].map((ending, i) =>
    domainRow('mapfern.' + ending, ['available', 'taken', 'unknown'][i]));
  return { version: 1, query: { name, ascii: 'mapfern', exactDomain: null }, checkedAt, complete: false,
    domains, share: { url: receipt(name, domains[0].domain) },
    details: { id: 'synthetic-details-token-for-the-browser-test', path: '/v1/check/details?id=synthetic-details-token-for-the-browser-test', pending: ['handles'] } };
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

async function search(page, tab, value) {
  const button = page.getByRole('tab', { name: tab, exact: true });
  await button.click();
  const panelId = await button.getAttribute('aria-controls');
  const panel = page.locator('#' + panelId);
  await panel.getByRole('textbox').first().fill(value);
  await panel.locator('button[type=submit]').first().click();
}

async function screenshot(page, filename) {
  const dir = process.env.SEARCH_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(dir, filename + '.png'), animations: 'disabled' });
}

for (const width of [390, 1440]) {
  test('homepage search and all three doors at ' + width + 'px', async t => {
    const { page } = await openPage(t, () => assert.fail('Unexpected search'), { width });
    await page.getByRole('tab', { name: 'I have an idea' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const name of ['I have an idea', 'I have a name', 'My own name']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      const panel = page.locator('#' + await tab.getAttribute('aria-controls'));
      assert.equal(await panel.getByRole('textbox').isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.getByRole('tab', { name: 'I have an idea' }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await screenshot(page, 'search-' + width);
  });
}

test('all endings show registry verdicts; only an available domain gets a booking link', async t => {
  const { page, calls } = await openPage(t, call => {
    if (call.path === '/v1/check/details') return { status: 410, json: { error: 'expired' } };
    assert.equal(call.path, '/v1/check');
    assert.equal(call.method, 'GET');
    assert.equal(call.query.get('name'), 'Mapfern');
    return { json: checkReply() };
  });
  await search(page, 'I have a name', 'Mapfern');
  const book = page.getByRole('link', { name: /Book it at Spaceship for \$6\.25/i });
  await book.waitFor();
  assert.equal(await book.getAttribute('href'), price('mapfern.com').buyUrl);
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
  if (!(await watch.isVisible())) await search(page, 'I have a name', 'Mapfern');
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
  await search(page, 'I have a name', 'Mapfern');
  await page.getByText(breather, { exact: true }).waitFor();
  await search(page, 'I have a name', 'Mapfern');
  await page.getByText('Couldn’t finish the search. Try again in a moment.').waitFor();
  await search(page, 'I have a name', 'Mapfern');
  await page.getByRole('link', { name: /Book it at Spaceship/i }).waitFor();
  assert.equal(responses.length, 0);
});

test('search has a readable fallback when scripts are off', async t => {
  const { page } = await openPage(t, () => assert.fail('Unexpected request'), { javaScriptEnabled: false });
  assert.match(await page.locator('#search').innerText(), /Turn on JavaScript to search/i);
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
    ['ChatGPT', 'https://domainhound-mcp.domainhound.workers.dev/mcp']
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
  const { page } = await openPage(t, async () => {
    started();
    await pending;
    return { json: checkReply() };
  });
  await search(page, 'I have a name', 'Mapfern');
  await requestStarted;
  assert.match(await page.locator('main').innerText(), /checking|searching|looking/i);
  await page.getByRole('tab', { name: 'My own name' }).click();
  release();
  // A background tab may retain the response for later. Wait for its DOM to
  // settle before asserting that the selected tab stayed on top.
  await page.locator('#search-results article').first().waitFor({ state: 'attached' });
  await page.getByRole('textbox', { name: /full name/i }).waitFor();
  assert.equal(await page.getByRole('link', { name: /Book it at/i }).isVisible(), false);
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
  await search(page, 'I have a name', 'Mapfern');
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
    complete: true, path: 'qwen', names: names.map(([name, domain, status = 'available']) => {
      const row = domainRow(domain, status);
      const pick = { domain, ...row.prices[0], prices: row.prices, evidence: row.evidence, checkedAt };
      const score = { total: name === 'Trailfin' ? 68 : name === 'Mossfold' ? 56 : 74,
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
      return { json: ideas(call.body.round === 2 ? [['Flintmap', 'flintmap.com']] : shortlist) };
    }, { width });
    await search(page, 'I have an idea', ideaText);
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
    await screenshot(page, 'results-' + width);

    const boxes = results.getByRole('combobox');
    for (const [i, name] of ['Mapfern', 'Trailfin', 'Mossfold'].entries()) await boxes.nth(i).selectOption(name);
    await results.getByRole('button', { name: 'Find more names' }).click();
    await results.getByRole('heading', { name: 'Flintmap' }).waitFor();
    assert.deepEqual(calls[1].body, { idea: ideaText, round: 2, wanted: ['Mapfern', 'Trailfin'], avoid: ['Mossfold'] });
  });
}

test('personal search sends only the full name and shows the matched domain', async t => {
  const { page } = await openPage(t, call => {
    assert.equal(call.path, '/v1/personal');
    assert.equal(call.method, 'POST');
    assert.deepEqual(call.body, { fullName: 'Alex Sample' });
    assert.equal(call.query.size, 0);
    return { json: { results: [{ ...domainRow('alexsample.me'), bestPrice: price('alexsample.me') }], complete: true } };
  });
  await search(page, 'My own name', 'Alex Sample');
  await page.getByRole('heading', { name: 'alexsample.me' }).waitFor();
  const book = page.getByRole('link', { name: /Book it at Spaceship/ });
  assert.equal(await book.getAttribute('href'), price('alexsample.me').buyUrl);
  assert.equal(new URL(page.url()).search, '');
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
  await search(page, 'I have a name', 'Mapfern');
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
  await search(page, 'I have an idea', ideaText);
  await page.getByText(/No available names confirmed/).waitFor();
  assert.equal(await page.locator('#search-results article').count(), 0);
});

test('single-offer API replies disclose the three-year basis on both naming tabs', async t => {
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
  for (const [tab, input] of [['I have an idea', ideaText], ['My own name', 'Alex Sample']]) {
    await search(page, tab, input);
    await page.getByRole('article').getByText('Lowest three-year cost · $32.00', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Book it at Gandi for $14.00' }).waitFor();
    if (tab === 'I have an idea') await page.getByText(/Price snapshot 2026-11-24/).waitFor();
  }
});
