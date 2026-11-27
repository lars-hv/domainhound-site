const fs = require('node:fs');
const path = require('node:path');
const { webkit } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
const output = stage || path.join(root, 'sf');
const input = path.join(stage || path.join(root, 'data/sf'), 'endings.json');
const data = JSON.parse(fs.readFileSync(input));
const { batches, audit } = data;
const latest = batches.at(-1);
const pct = (n, total) => Number((100 * n / total).toFixed(1));
const peak = batches.reduce((a, b) => b.ai / b.websites > a.ai / a.websites ? b : a);
const count = n => n.toLocaleString('en-US');
const labels = {
  exactOther: 'Exact brand, other ending', exactCom: 'Exact brand, .com',
  differentOther: 'Different name, other ending', differentCom: 'Different name, .com',
};
function chart(row) {
  const max = Math.max(...Object.values(row.choices));
  const bars = Object.entries(labels).map(([key, label]) => {
    const n = row.choices[key];
    return `<li><div><span>${label}</span><b>${n}</b></div><i aria-hidden="true" style="width:${pct(n, max)}%"></i></li>`;
  });
  return `<section data-batch="${row.batch}" aria-label="${row.batch}"${row === latest ? '' : ' hidden'}>
    <p class="sites">${row.websites} listed sites</p><ul class="bars">${bars.join('')}</ul></section>`;
}

// Time runs down the page so every batch label and denominator fits on a phone.
function trend() {
  const limit = Math.max(50, ...batches.map(b => Math.ceil(10 * b.ai / b.websites) * 10));
  const position = b => (100 * b.ai / b.websites) / limit * 100;
  const points = batches.map((b, i) => `${position(b)},${i + .5}`);
  const rows = batches.map(b => {
    const share = pct(b.ai, b.websites);
    return `<div class="plot-row"><span>${b.batch}</span><span class="point-track"><i style="left:${position(b)}%"></i></span>
      <b>${share}%</b><span class="batch-size">${b.websites}<span class="sr-only"> sites</span></span></div>`;
  });
  return `<div class="line" aria-hidden="true"><svg viewBox="0 0 100 ${batches.length}" preserveAspectRatio="none">
    <polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>${rows.join('')}`;
}
const isoDate = data.source.updated.slice(0, 10);
const values = {
  total: count(data.websites), eligible: count(data.eligible_companies), excluded: data.excluded_websites,
  date: new Date(isoDate).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }), isoDate,
  sample: audit.sample, errors: audit.errors, errorRate: pct(audit.errors, audit.sample),
  batches: batches.length, latest: latest.batch, latestAi: pct(latest.ai, latest.websites),
  peakAi: pct(peak.ai, peak.websites), peakBatch: peak.batch,
  si: data.endings['.si'] || 0, siNote: (data.endings['.si'] || 0) <= 1 ? 'Too little evidence for a trend.' : '',
  description: `Compare brand names and domain endings across ${count(data.websites)} Bay Area YC startup websites.`,
  options: batches.toReversed().map(b => `<option${b === latest ? ' selected' : ''}>${b.batch}</option>`).join(''),
  charts: batches.map(chart).join('\n'), trend: trend(),
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
    </style><header><b><img src="data:image/svg+xml;base64,${dog}" alt="">Domain Hound</b><span>${values.latest}</span></header>
    <main><h1>Keep the name or keep the .com?</h1><aside><strong>${latest.choices.exactOther}</strong><span>exact brand, other ending</span></aside></main>
    <footer><span>${values.total} Bay Area YC startup websites</span><span>domainhound.dev/sf/</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
