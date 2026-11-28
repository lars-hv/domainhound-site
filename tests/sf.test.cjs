const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { webkit } = require('playwright-core');
const data = require('../data/sf/endings.json');
const { companies } = require('../data/sf/companies.json');
const top50 = require('../data/sf/top50.json');
const headline = 'Your .com is taken. Here’s what 1,581 SF startups did.';

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
      const exact = name.endsWith('.io');
      const ascii = name.split('.')[0];
      const domain = exact ? {
        domain: name, ending: 'io', status: 'available', evidence: 'rdap-404',
        checkedAt: '2026-11-27T12:00:00Z', priceShown: true,
        prices: [{ shop: 'Example Shop', minimumYears: 2, firstYearUsd: 8, renewalUsd: 10,
          firstPaymentUsd: 16, renewalPaymentUsd: 20, threeYearUsd: 36 }],
      } : { domain: ascii + '.com', ending: 'com', status: 'taken' };
      return route.fulfill({ json: {
        query: { ascii, exactDomain: exact ? name : null },
        domains: [domain],
      } });
    });
    await page.goto(site + '/sf/');
    assert.equal((await page.locator('h1').innerText()).replace(/\s+/g, ' '), headline);
    assert.equal(await page.title(), headline);
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), headline);
    const pick = page.getByRole('region', { name: 'Which ending should you pick?' });
    const cards = pick.getByRole('article');
    const endings = ['.com', '.ai', '.io'];
    assert.deepEqual(await cards.locator('h3').allTextContents(), endings);
    for (const [index, ending] of endings.entries()) {
      const paragraphs = await cards.nth(index).locator('p').allTextContents();
      assert.equal(paragraphs.length, 2);
      const { count, pct } = data.endings[ending];
      assert.equal(paragraphs[0], `${count.toLocaleString('en-US')} of ${data.websites.toLocaleString('en-US')} sites · ${pct}%`);
      assert.ok(paragraphs[1].endsWith('.'));
    }
    assert.doesNotMatch(await pick.innerText(), /\$|first year|renewal|three years|Spaceship|Dynadot|where the prices come from/i);
    assert.equal(await pick.locator('details').count(), 0);
    assert.equal(await page.locator('.ticket b').first().innerText(), '.io');
    assert.equal(await page.locator('.column .io').count(), data.batches.length);
    await pick.getByRole('link', { name: 'Check yours below.' }).click();
    assert.equal(page.url(), site + '/sf/#check-yours');
    assert.equal(await page.locator(':target .name-check').count(), 1);
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
    const sort = page.locator('#funding-sort');
    await sort.waitFor();
    assert.equal(await body.count(), 50);
    assert.equal(await body.first().locator('.amount').getAttribute('title'),
      '$' + top50.companies[0].raised_usd.toLocaleString('en-US'));
    assert.deepEqual(await page.locator('#company-table thead th').allTextContents(),
      ['Company', 'Domain', 'Ending', 'Raised', 'Team size', 'Owns the .com?']);
    assert.equal(await body.locator('td').count(), 250);
    assert.ok((await body.locator('td').allTextContents()).every(cell => cell.trim()));
    assert.doesNotMatch(await page.content(), /Unverified|No match|unknown|n\/a/i);
    const owners = top50.companies.filter(row => row.com.status === 'yes').length;
    assert.equal(await page.locator('#funding .deck').innerText(), `${owners} of the 50 own their .com.`);
    await sort.selectOption('raised_usd:asc');
    assert.equal(await body.first().locator('.amount').getAttribute('title'),
      '$' + top50.companies.at(-1).raised_usd.toLocaleString('en-US'));
    await sort.selectOption('team_size:desc');
    assert.equal(Number(await body.first().locator('[data-label="Team size"]').textContent()),
      Math.max(...top50.companies.map(row => row.team_size)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Domain', exact: true }).click();
    assert.equal(await page.locator('#company-table [aria-sort]').getAttribute('aria-sort'), 'ascending');
    assert.deepEqual(await body.locator('.site-domain').allTextContents(),
      top50.companies.map(row => row.domain).sort(new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare));
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.setViewportSize({ width: 390, height: 844 });
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
      await form.getByText(name + '.io', { exact: true }).waitFor();
      assert.deepEqual(await form.locator('.matches b').allTextContents(), [name + '.com', name + '.io']);
      assert.deepEqual(await form.locator('.matches li p').allTextContents(), [
        'The owner sets the price.',
        'USD 16.00 upfront for 2 years at Example Shop. USD 20.00 to renew for 2 years.',
      ]);
    }
    assert.deepEqual(checked, ['example', 'example.io', 'secondexample', 'secondexample.io']);
    assert.equal(page.url(), site + '/sf/#check');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.equal(requests.filter(url => url.origin === site && url.search).length, 0);
    assert.ok(requests.every(url => !url.pathname.endsWith('/prices.json')));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('directory snapshot reconciles to the chart and to distinct SEC offerings', () => {
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

test('the 50 ranked companies reconcile to sourced funding rounds and domain observations', () => {
  const directory = new Map(companies.map(row => [row.id, row]));
  const ranked = top50.companies;
  assert.equal(ranked.length, 50);
  assert.equal(new Set(ranked.map(row => row.id)).size, 50);
  assert.deepEqual(ranked.map(row => row.raised_usd), ranked.map(row => row.raised_usd).sort((a, b) => b - a));
  assert.match(top50.directory_snapshot, /^https:\/\/raw\.githubusercontent\.com\/yc-oss\/api\/[\da-f]{40}\/companies\/all\.json$/);
  for (const row of ranked) {
    if (top50.directory_snapshot === data.source.snapshot) {
      for (const key of ['company', 'domain', 'ending']) assert.equal(row[key], directory.get(row.id)[key]);
    }
    assert.ok(Number.isInteger(row.team_size) && row.team_size > 0);
    assert.ok(row.rounds.length > 0 && row.raised_usd > 0);
    assert.equal(row.raised_usd, row.rounds.reduce((sum, round) => sum + round.amount_usd, 0));
    for (const round of row.rounds) {
      assert.ok(Number.isSafeInteger(round.amount_usd) && round.amount_usd > 0);
      assert.match(round.date, /^20\d\d(?:-\d\d(?:-\d\d)?)?$/);
      assert.ok(round.date <= top50.funding_checked);
      assert.match(round.source_url, /^https:\/\//);
    }
    const { com } = row;
    const stem = row.domain.slice(0, -row.ending.length).split('.').at(-1);
    assert.equal(com.domain, stem + '.com');
    assert.equal(com.rdap_url, 'https://rdap.verisign.com/com/v1/domain/' + com.domain);
    assert.match(com.checked, /^20\d\d-\d\d-\d\d$/);
    assert.ok(['yes', 'registered', 'available'].includes(com.status));
    assert.equal(com.rdap_status, com.status === 'available' ? 404 : 200);
    if (com.status === 'yes' && row.ending !== '.com') {
      const root = stem + row.ending;
      const finalHost = new URL(com.final_url).hostname;
      assert.ok(finalHost === root || finalHost.endsWith('.' + root));
    }
  }
});
