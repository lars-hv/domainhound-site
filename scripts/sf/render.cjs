const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
const output = stage || path.join(root, 'sf');
const input = path.join(stage || path.join(root, 'data/sf'), 'endings.json');
const data = JSON.parse(fs.readFileSync(input));
const directory = JSON.parse(fs.readFileSync(path.join(path.dirname(input), 'companies.json'))).companies;
const fundingTable = require('../../sf/funding.mjs');
const { companies, funding_checked: fundingDate, candidate_count: candidates } = JSON.parse(fs.readFileSync(path.join(root, 'data/sf/top50.json')));
if (companies.length !== 50) throw new Error('Expected 50 sourced company rows');
const ranked = fundingTable.sorted(companies, 'raised_usd', 'desc');
const com = ranked.filter(row => row.com.status === 'yes').length;
const { batches, facts, endings } = data;
const first = batches[0];
const latest = batches.at(-1);
const share = (batch, ending) => batch.endings[ending]?.pct || 0;
const count = number => number.toLocaleString('en-US');
const headlineLead = 'Your .com is taken.';
const headlineFollowup = `Here's what ${count(data.websites)} SF startups did.`;
const shortSeason = { Winter: 'W', Spring: 'Sp', Summer: 'Su', Fall: 'F' };
const years = Map.groupBy(batches, row => row.batch.split(' ')[1]);
const stamp = new Date(data.source.updated);
const formatDate = options => stamp.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

function column(row) {
  const com = row.endings['.com']?.count || 0;
  const ai = row.endings['.ai']?.count || 0;
  const io = row.endings['.io']?.count || 0;
  const counts = [com, ai, io, row.websites - com - ai - io];
  const fills = counts.map((n, i) => `<i class="${['com', 'ai', 'io', 'rest'][i]}" style="flex-grow:${n}"></i>`).join('');
  const label = `${row.batch}, ${row.websites} sites, ${share(row, '.com')}% .com, ${share(row, '.ai')}% .ai, ${share(row, '.io')}% .io`;
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

const topEndings = Object.entries(endings)
  .sort(([a, left], [b, right]) => right.count - left.count || a.localeCompare(b)).slice(0, 10);
const examples = {
  '.com': ['greptile.com', 'Greptile reviews code for software teams.'],
  '.ai': ['happyrobot.ai', 'HappyRobot builds AI for business operations.'],
  '.io': ['every.io', 'Every handles payroll and banking for startups.'],
};
const picks = topEndings.slice(0, 3).map(([ending, { count: sites, pct }]) => {
  const [preferredDomain, description] = examples[ending] || [];
  const example = directory.find(row => row.domain === preferredDomain && row.ending === ending)
    || directory.find(row => row.ending === ending);
  const sentence = example.domain === preferredDomain ? description : 'One startup using it is ' + fundingTable.escape(example.company) + '.';
  const domain = fundingTable.escape(example.domain);
  return `<li><h3>${ending}</h3><span class="pick-stat">${count(sites)} sites · ${pct}%</span>
    <p><b>${domain}</b> · ${sentence}</p></li>`;
}).join('\n');
const topTen = topEndings.map(([ending, { count: sites, pct }], i) =>
  `<tr><td>${i + 1}</td><th scope="row">${ending}</th><td>${count(sites)}</td><td>${pct}%</td></tr>`).join('\n');
const emergent = ranked.find(row => row.id === 29765);
const millions = amount => (amount / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 });
const dek = `The team at ${emergent.domain} has raised $${millions(emergent.raised_usd)} million.`;

function checkBox(id) {
  return `<form class="name-check" hidden autocomplete="off">
    <label for="${id}">Name or domain <span>· Free check</span></label>
    <div class="field"><input id="${id}" type="text" maxlength="253" required placeholder="Your startup name" autocapitalize="none" spellcheck="false">
    <button type="submit">Check endings</button></div>
    <p class="check-status" role="status"></p><ul class="matches"></ul>
  </form><noscript><p>Turn on JavaScript to check a name.</p></noscript>`;
}

const values = {
  headline: `${headlineLead} ${headlineFollowup}`, headlineLead, headlineFollowup,
  closingCheck: checkBox('closing-candidate'), picks, topTen, candidates, dek,
  shCount: endings['.sh']?.count || 0,
  picksTitle: `${topEndings[0][0]} leads. ${topEndings[1][0]} is the closest rival.`,
  tenNote: `${topEndings[3][0]} trails ${topEndings[2][0]} by ${count(topEndings[2][1].count - topEndings[3][1].count)} sites.`,
  trendTitle: `${aiPercent(latest)}% of the latest batch uses .ai`,
  leadAmount: `$${millions(emergent.raised_usd)}M`, leadSource: emergent.rounds.at(-1).source_url,
  corgiAmount: `$${millions(ranked.find(row => row.id === 29646).raised_usd)} million`,
  fundingHeadline: `${com} of the 50 use a .com or have one that redirects to their site.`,
  fundingDay: new Date(fundingDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  companyRows: fundingTable.tableRows(ranked),
  fundingHeaders: Object.entries(fundingTable.columns).map(([key, label]) =>
    `<th scope="col" data-key="${key}"${key === 'raised_usd' ? ' aria-sort="descending"' : ''}><button type="button" disabled>${label}</button></th>`).join(''),
  total: count(data.websites),
  month: formatDate({ month: 'short', year: 'numeric' }),
  day: formatDate({ month: 'long', day: 'numeric', year: 'numeric' }),
  description: `${dek} Explore the domains of ${count(data.websites)} Bay Area YC startups.`,
  bars: [...years].map(([year, rows]) => `<div class="year" style="--batches:${rows.length}">
    <div class="columns">${rows.map(column).join('')}</div><span class="year-label">${year}</span></div>`).join('\n'),
  options: batches.map(row => `<option${row === latest ? ' selected' : ''}>${row.batch}</option>`).join(''),
  latest: latest.batch, batches: batches.length, tableRows: tableRows(latest.endings),
  summary: `${latest.websites} sites · ${share(latest, '.com')}% .com · ${share(latest, '.ai')}% .ai · ${share(latest, '.io')}% .io`,
  firstBatch: first.batch, firstAi: share(first, '.ai'),
  trendPeak: `${aiPercent(trendPeak)}% in ${trendPeak.batch} (${aiSample(trendPeak)})`,
  trendLatest: `${aiPercent(latest)}% (${aiSample(latest)})`, trend: trend(),
  median: facts.median_label, shortest: facts.shortest_label, longest: facts.longest_label,
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
    const sfPalette = fs.readFileSync(path.join(root, 'sf/palette.css'), 'utf8');
    await page.setContent(`<style>${palette}
${sfPalette}
      *{box-sizing:border-box}body{margin:0;padding:48px 64px;background:var(--paper);color:var(--pine);font:750 32px Mulish,sans-serif}
      header,footer{display:flex;align-items:center;justify-content:space-between}
      header{border-bottom:2px solid var(--leaf);padding-bottom:20px} header span{font:600 23px monospace}
      img{width:64px;vertical-align:middle;margin-right:12px} main{display:flex;align-items:center;gap:50px;height:360px}
      h1{font-size:64px;line-height:1.04;letter-spacing:-2px;margin:0;max-width:590px}
      aside{background:var(--mist);border-top:6px solid var(--leaf);color:var(--pine);padding:20px 30px 28px;transform:rotate(-3deg);text-align:center}
      strong{display:block;font-size:108px;line-height:1.05;letter-spacing:-3px} aside span{font-size:28px}
      footer{border-top:2px dashed var(--leaf);padding-top:26px;font-size:25px}
    </style><header><b><img src="data:image/svg+xml;base64,${dog}" alt="">Domain Hound</b><span>${values.month}</span></header>
    <main><h1>${headlineLead}<br>${headlineFollowup}</h1><aside><strong>${values.leadAmount}</strong><span>raised by emergent.sh</span></aside></main>
    <footer><span>${values.total} Bay Area YC startup websites</span><span>domainhound.dev/sf/</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
