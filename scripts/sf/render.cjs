const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
const output = stage || path.join(root, 'sf');
const input = path.join(stage || path.join(root, 'data/sf'), 'endings.json');
const data = JSON.parse(fs.readFileSync(input));
const readData = file => JSON.parse(fs.readFileSync(path.join(path.dirname(input), file)));
const { companies, as_of: directoryDate } = readData('companies.json');
const checks = readData('com-taken.json');
const examples = readData('examples.json');
const byId = new Map(companies.map(row => [row.id, row]));
const nonCom = companies.filter(row => row.ending !== '.com');
const expected = new Set(nonCom.map(row => row.id));
if (companies.length !== data.websites || directoryDate !== data.source.updated.slice(0, 10) ||
    checks.length !== expected.size || !checks.every(row => {
      const startup = byId.get(row.id);
      return expected.delete(row.id) && startup.domain === row.listed_domain &&
        row.com === startup.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com' &&
        ['registered', 'unregistered'].includes(row.registration);
    })) throw new Error('Incomplete or inconsistent directory and registry snapshots');
const registered = checks.filter(row => row.registration === 'registered').length;
const redirected = checks.filter(row => row.redirect_to_startup === 'redirect').length;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const safeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const { batches, facts, endings } = data;
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
    `<tr><th scope="row">${key}</th><td title="${value.pct}% of sites">${count(value.count)}</td></tr>`).join('\n');
}

const topTen = Object.entries(endings).sort((a, b) =>
  b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, 10);

function ranking(entries, bars) {
  return entries.map(([ending, { count, pct }], i) =>
    `<li><span class="rank" aria-hidden="true">${i + 1}</span><b class="ending">${ending}</b>
      ${bars ? `<span class="track" aria-hidden="true"><i style="width:${pct / topTen[0][1].pct * 100}%"></i></span>` : ''}
      <span class="count">${count}</span><span class="share">${pct}%</span></li>`).join('\n');
}

const groups = Object.entries(examples).map(([ending, rows]) => {
  const items = rows.map(({ id }) => {
    const row = byId.get(id);
    if (row?.ending !== ending) throw new Error('Example outside ending group: ' + id);
    return `<li><b>${escape(row.company)}</b><span>${escape(row.domain)}</span></li>`;
  });
  return `<section><h3>${ending}</h3><ul>${items.join('')}</ul></section>`;
}).join('\n');

const labelLength = row => row.domain.slice(0, -row.ending.length).split('.').at(-1).length;
const checkDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles'
});
const dates = [...new Set(checks.map(row => checkDate.format(new Date(row.checked_utc))))];
const values = {
  total: count(data.websites), day: formatDate({ month: 'short', day: 'numeric', year: 'numeric' }),
  leaders: ranking(topTen.slice(0, 3), false), ranking: ranking(topTen, true), groups,
  description: topTen.slice(0, 3).map(([ending, value]) => `${ending} (${value.pct}%)`).join(', '),
  registered, nonCom: nonCom.length, takenPct: Math.round(100 * registered / nonCom.length),
  redirected, checked: dates.join(' / '),
  bars: [...years].map(([year, rows]) => `<div class="year" style="--batches:${rows.length}">
    <div class="columns">${rows.map(column).join('')}</div><span class="year-label">${year}</span></div>`).join('\n'),
  options: batches.map(row => `<option${row === latest ? ' selected' : ''}>${row.batch}</option>`).join(''),
  latest: latest.batch, first: first.batch, tableRows: tableRows(latest.endings), batchData: safeJSON(batches),
  summary: `${latest.websites} sites · ${share(latest, '.com')}% .com · ${share(latest, '.ai')}% .ai`,
  firstAi: share(first, '.ai'), lastAi: share(latest, '.ai'),
  compound: data.brand_shapes.Compound.count, ...facts.exact_prefixes,
  shortest: facts.shortest_label, longest: facts.longest_label,
  shortestDomain: escape(companies.find(row => labelLength(row) === facts.shortest_label).domain),
  longestDomain: escape(companies.find(row => labelLength(row) === facts.longest_label).domain),
  eligible: count(data.eligible_companies), excluded: data.excluded_websites,
  source: escape(data.source.snapshot.replace('raw.githubusercontent.com/yc-oss/api/', 'github.com/yc-oss/api/blob/')),
};

async function render() {
  const html = fs.readFileSync(path.join(__dirname, 'page.tmpl'), 'utf8').replace(/{{(\w+)}}/g, (_, key) => {
    if (!(key in values)) throw new Error('Missing template value ' + key);
    return values[key];
  }).replace(/^[ \t]+$/gm, '');
  // Raster social cards work in link unfurlers without client JavaScript.
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    const font = fs.readFileSync(path.join(root, 'assets/mulish-latin-wght-normal.woff2')).toString('base64');
    const dog = fs.readFileSync(path.join(root, 'assets/hound-mark.svg')).toString('base64');
    const palette = fs.readFileSync(path.join(root, 'assets/palette.css'), 'utf8')
      .replace('mulish-latin-wght-normal.woff2', 'data:font/woff2;base64,' + font);
    const skin = fs.readFileSync(path.join(root, 'sf/palette.css'), 'utf8');
    const bridge = html.match(/<svg class="postcard-scene"[\s\S]*?<\/svg>/)[0];
    await page.setContent(`<style>${palette}${skin}
      *{box-sizing:border-box}body{margin:0;padding:32px 54px;background:var(--paper);color:var(--pine);font:750 27px Mulish,sans-serif}
      header,footer{display:flex;align-items:center;justify-content:space-between}
      header{border-bottom:2px solid var(--pine);padding-bottom:12px}header span,footer{font:600 20px monospace}
      img{width:52px;vertical-align:middle;margin-right:12px}
      main{display:grid;grid-template-columns:1.08fr 1fr;align-items:center;gap:48px;height:442px}
      h1{font-size:78px;line-height:.95;letter-spacing:-3px;margin:0 0 18px}p{margin:0}
      aside{background:var(--mist);border:2px solid var(--pine);padding:16px 24px;transform:rotate(-2deg)}
      h2{margin:0;border-bottom:2px solid;font-size:30px}ol{list-style:none;margin:0;padding:0}
      li{display:grid;grid-template-columns:22px 1fr 56px 94px;align-items:baseline;gap:10px;border-bottom:1px solid var(--mint)}
      .ending{font-size:44px}.rank,.count,.share{font:700 21px monospace}.share{text-align:right}
      svg{display:block;width:100%;height:84px}footer{border-top:2px solid var(--leaf);padding-top:15px}
    </style><header><b><img src="data:image/svg+xml;base64,${dog}" alt="">Domain Hound</b><span>San Francisco Bay Area</span></header>
    <main><div><h1>Your .com is taken.</h1><p>Here’s what ${values.total} SF startups did.</p></div>
    <aside><h2>The top 3</h2><ol>${values.leaders}</ol>${bridge}</aside></main>
    <footer><span>${values.total} listed YC websites</span><span>domainhound.dev/sf/</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
