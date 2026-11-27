const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
const output = stage || path.join(root, 'sf');
const input = path.join(stage || path.join(root, 'data/sf'), 'endings.json');
const data = JSON.parse(fs.readFileSync(input));
const { batches, facts, endings } = data;
const first = batches[0];
const latest = batches.at(-1);
const share = (batch, ending) => batch.endings[ending]?.pct || 0;
const peak = batches.reduce((best, row) => share(row, '.ai') > share(best, '.ai') ? row : best);
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

const values = {
  total: count(data.websites), ai: share(data, '.ai'), aiCount: count(endings['.ai']?.count || 0),
  years: `2023 to ${latest.batch.split(' ')[1]}`, month: formatDate({ month: 'short', year: 'numeric' }),
  day: formatDate({ month: 'long', day: 'numeric', year: 'numeric' }),
  description: `${share(data, '.ai')}% of ${count(data.websites)} Bay Area YC startup websites use .ai.`,
  bars: [...years].map(([year, rows]) => `<div class="year" style="--batches:${rows.length}">
    <div class="columns">${rows.map(column).join('')}</div><span class="year-label">${year}</span></div>`).join('\n'),
  options: batches.map(row => `<option${row === latest ? ' selected' : ''}>${row.batch}</option>`).join(''),
  latest: latest.batch, batches: batches.length, tableRows: tableRows(latest.endings),
  summary: `${latest.websites} sites · ${share(latest, '.com')}% .com · ${share(latest, '.ai')}% .ai`,
  firstAi: share(first, '.ai'), lastAi: share(latest, '.ai'), peakAi: share(peak, '.ai'), peakBatch: peak.batch,
  median: facts.median_label, shortest: facts.shortest_label, longest: facts.longest_label,
  prefixCount: Object.values(facts.exact_prefixes).reduce((a, b) => a + b, 0),
  ...facts.exact_prefixes, comCount: endings['.com']?.count || 0, different: facts.different_com,
  distinct: facts.distinct_endings, single: facts.singleton_endings, hyphen: facts.hyphenated, digits: facts.digits,
  shapes: tableRows(data.brand_shapes), eligible: count(data.eligible_companies), excluded: data.excluded_websites,
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
    <main><h1>What SF startups launch on.</h1><aside><strong>${values.ai}%</strong><span>of sites end in .ai</span></aside></main>
    <footer><span>${values.total} Bay Area YC startup websites</span><span>domainhound.dev/sf/</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
