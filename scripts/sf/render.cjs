const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
const output = stage || path.join(root, 'sf');
const input = path.join(stage || path.join(root, 'data/sf'), 'endings.json');
const data = JSON.parse(fs.readFileSync(input));
const fundingTable = require('../../sf/funding.mjs');
const { companies, as_of: fundingDate } = JSON.parse(fs.readFileSync(path.join(path.dirname(input), 'companies.json')));
if (companies.length !== data.websites || fundingDate !== data.source.updated.slice(0, 10)) {
  throw new Error('Funding and chart snapshots differ');
}
const ranked = fundingTable.sorted(companies, 'funding', 'desc');
const matched = ranked.filter(row => row.funding);
const top = matched.slice(0, 20);
const com = top.filter(row => row.ending === '.com').length;
const { batches, facts, endings } = data;
const prices = require('../../data/sf/prices.json');
const first = batches[0];
const latest = batches.at(-1);
const share = (batch, ending) => batch.endings[ending]?.pct || 0;
const count = number => number.toLocaleString('en-US');
const shortSeason = { Winter: 'W', Spring: 'Sp', Summer: 'Su', Fall: 'F' };
const years = Map.groupBy(batches, row => row.batch.split(' ')[1]);
const stamp = new Date(data.source.updated);
const formatDate = options => stamp.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

function column(row) {
  const com = row.endings['.com']?.count || 0;
  const ai = row.endings['.ai']?.count || 0;
  const counts = [com, ai, row.websites - com - ai];
  const fills = counts.map((n, i) => `<i class="${['com', 'ai', 'rest'][i]}" style="flex-grow:${n}"></i>`).join('');
  const label = `${row.batch}, ${row.websites} sites, ${share(row, '.com')}% .com, ${share(row, '.ai')}% .ai`;
  return `<button disabled class="column" aria-label="${label}" aria-pressed="${row === latest}" data-batch="${row.batch}">
    <span class="stack" aria-hidden="true">${fills}</span><span class="season">${shortSeason[row.batch.split(' ')[0]]}</span></button>`;
}

function tableRows(entries) {
  return Object.entries(entries).map(([key, value]) =>
    `<tr><th scope="row">${key}</th><td>${count(value.count)}</td><td>${value.pct}%</td></tr>`).join('\n');
}

const aiCount = batch => batch.endings['.ai']?.count || 0;
const aiRatio = batch => aiCount(batch) / batch.websites;
const aiPercent = batch => Number((100 * aiRatio(batch)).toFixed(1));
const aiSample = batch => `${count(aiCount(batch))} of ${count(batch.websites)} sites`;
const trendPeak = batches.reduce((best, row) => aiRatio(row) > aiRatio(best) ? row : best);

// Time runs down the page so every batch label and denominator fits on a phone.
function trend() {
  const limit = Math.max(50, ...batches.map(row => Math.ceil(10 * aiRatio(row)) * 10));
  const position = row => 100 * aiRatio(row) / limit * 100;
  const points = batches.map((row, i) => `${position(row)},${i + .5}`);
  const rows = batches.map(row =>
    `<div class="trend-row"><span>${row.batch}</span><span class="trend-track" aria-hidden="true"><i style="left:${position(row)}%"></i></span>
      <b>${aiPercent(row)}%</b><span class="trend-size">${count(row.websites)}<span class="trend-sites"> sites</span></span></div>`);
  return `<div class="trend-line" aria-hidden="true"><svg viewBox="0 0 100 ${batches.length}" preserveAspectRatio="none">
    <polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>${rows.join('')}`;
}

const priceDay = new Date(prices.checked).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const verdict = {
  '.com': 'Get your exact name here if it’s available at the standard price.',
  '.ai': 'If you build AI, this ending says so before anyone clicks.',
  '.si': 'Keep the name and a small renewal bill if you’re happy to spell out the ending.',
};
const dollars = value => '$' + value.toFixed(2);
const cheapest = offers => offers.reduce((a, b) => a.threeYearUsd <= b.threeYearUsd ? a : b);

function pickCard(ending, offers) {
  const best = cheapest(offers);
  const sites = endings[ending]?.count ?? 0;
  const term = best.minimumYears > 1
    ? `Pay for ${best.minimumYears} years at a time. ${dollars(best.firstPaymentUsd)} upfront.` : '';
  return `<article><h3>${ending}</h3>
    <p>${count(sites)} of ${count(data.websites)} sites · ${share(data, ending)}%</p>
    <dl><div><dt>First year</dt><dd>${dollars(best.firstYearUsd)}</dd></div>
    <div><dt>Yearly renewal</dt><dd>${dollars(best.renewalUsd)}</dd></div></dl>
    <p class="shop">${best.shop}${term ? ' · ' + term : ''}</p>
    <p>${verdict[ending]}</p></article>`;
}

function checkBox(id) {
  return `<form class="name-check" hidden autocomplete="off">
    <label for="${id}">Name or domain <span>· Free check</span></label>
    <div class="field"><input id="${id}" type="text" maxlength="253" required placeholder="Your startup name" autocapitalize="none" spellcheck="false">
    <button type="submit">Check endings</button></div>
    <p class="check-status" role="status"></p><ul class="matches"></ul>
  </form><noscript><p>Turn on JavaScript to check a name.</p></noscript>`;
}

const values = {
  heroCheck: checkBox('candidate'), closingCheck: checkBox('closing-candidate'),
  picks: Object.entries(prices.offers).map(([ending, offers]) => pickCard(ending, offers)).join('\n'),
  priceDay, sampleSize: prices.availableNames.length,
  priceSources: Object.entries(prices.offers).map(([ending, offers]) => {
    const best = cheapest(offers);
    return `<a href="${best.source}">${ending} at ${best.shop}</a>`;
  }).join(' · '),
  siCount: endings['.si']?.count ?? 0,
  fundingHeadline: top.length ? `${com} of the top ${top.length} by funding use .com` : 'Funding by company',
  matched: count(matched.length), visible: count(Math.min(fundingTable.pageSize, ranked.length)),
  companyRows: fundingTable.tableRows(ranked.slice(0, fundingTable.pageSize)),
  fundingHeaders: Object.entries(fundingTable.columns).map(([key, label]) =>
    `<th scope="col" data-key="${key}"${key === 'funding' ? ' aria-sort="descending"' : ''}><button type="button" disabled>${label}</button></th>`).join(''),
  total: count(data.websites), ai: share(data, '.ai'), aiCount: count(endings['.ai']?.count || 0),
  years: `2023 to ${latest.batch.split(' ')[1]}`, month: formatDate({ month: 'short', year: 'numeric' }),
  day: formatDate({ month: 'long', day: 'numeric', year: 'numeric' }),
  description: `${share(data, '.ai')}% of ${count(data.websites)} Bay Area YC startup websites use .ai.`,
  bars: [...years].map(([year, rows]) => `<div class="year" style="--batches:${rows.length}">
    <div class="columns">${rows.map(column).join('')}</div><span class="year-label">${year}</span></div>`).join('\n'),
  options: batches.map(row => `<option${row === latest ? ' selected' : ''}>${row.batch}</option>`).join(''),
  latest: latest.batch, batches: batches.length, tableRows: tableRows(latest.endings),
  summary: `${latest.websites} sites · ${share(latest, '.com')}% .com · ${share(latest, '.ai')}% .ai`,
  firstBatch: first.batch, firstAi: share(first, '.ai'),
  trendPeak: `${aiPercent(trendPeak)}% in ${trendPeak.batch} (${aiSample(trendPeak)})`,
  trendLatest: `${aiPercent(latest)}% (${aiSample(latest)})`, trend: trend(),
  median: facts.median_label, shortest: facts.shortest_label, longest: facts.longest_label,
  prefixCount: Object.values(facts.exact_prefixes).reduce((a, b) => a + b, 0),
  ...facts.exact_prefixes, comCount: endings['.com']?.count || 0, different: facts.different_com,
  distinct: facts.distinct_endings, single: facts.singleton_endings, hyphen: facts.hyphenated, digits: facts.digits,
  shapes: tableRows(data.brand_shapes).replace('Possibly made-up', 'Possibly invented'), eligible: count(data.eligible_companies), excluded: data.excluded_websites,
};

async function render() {
  const html = fs.readFileSync(path.join(__dirname, 'page.tmpl'), 'utf8').replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in values)) throw new Error('Missing template value ' + key);
    return values[key];
  });
  // Raster social cards work in link unfurlers without client JavaScript.
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    const font = fs.readFileSync(path.join(root, 'assets/mulish-latin-wght-normal.woff2')).toString('base64');
    const dog = fs.readFileSync(path.join(root, 'assets/hound-mark.svg')).toString('base64');
    const palette = fs.readFileSync(path.join(root, 'assets/palette.css'), 'utf8')
      .replace('mulish-latin-wght-normal.woff2', 'data:font/woff2;base64,' + font);
    await page.setContent(`<style>${palette}
      *{box-sizing:border-box}body{margin:0;padding:48px 64px;background:var(--forest);color:var(--paper);font:750 32px Mulish,sans-serif}
      header,footer{display:flex;align-items:center;justify-content:space-between}
      header{border-bottom:2px solid var(--leaf);padding-bottom:20px} header span{font:600 23px monospace}
      img{width:64px;vertical-align:middle;margin-right:12px} main{display:flex;align-items:center;gap:50px;height:360px}
      h1{font-size:78px;line-height:1;letter-spacing:-2px;margin:0;max-width:540px}
      aside{background:var(--mint);color:var(--pine);padding:20px 30px 28px;transform:rotate(-3deg);text-align:center}
      strong{display:block;font-size:108px;line-height:1.05;letter-spacing:-3px} aside span{font-size:28px}
      footer{border-top:2px dashed var(--leaf);padding-top:26px;font-size:25px}
    </style><header><b><img src="data:image/svg+xml;base64,${dog}" alt="">Domain Hound</b><span>${values.month}</span></header>
    <main><h1>Your .com is taken. Now what?</h1><aside><strong>${values.ai}%</strong><span>of sites end in .ai</span></aside></main>
    <footer><span>${values.total} Bay Area YC startup websites</span><span>domainhound.dev/sf/</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
