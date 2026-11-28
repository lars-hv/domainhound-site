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
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const { batches, facts, endings } = data;
const first = batches[0];
const latest = batches.at(-1);
const count = number => number.toLocaleString('en-US');
const percentage = (part, total) => {
  const value = 100 * part / total;
  return value.toFixed(value >= 10 ? 0 : 1) + '%';
};
const shortSeason = { Winter: 'W', Spring: 'Sp', Summer: 'Su', Fall: 'F' };
const years = Map.groupBy(batches, row => row.batch.split(' ')[1]);
const stamp = new Date(data.source.updated);

function column(row) {
  const com = row.endings['.com']?.count || 0;
  const ai = row.endings['.ai']?.count || 0;
  const counts = [com, ai, row.websites - com - ai];
  const fills = counts.map((n, i) => `<i class="${['com', 'ai', 'rest'][i]}" style="flex-grow:${n}"></i>`).join('');
  const label = `${row.batch} · ${percentage(com, row.websites)} .com · ${percentage(ai, row.websites)} .ai`;
  return `<button disabled class="column" aria-label="${label}" aria-pressed="${row === latest}" data-batch="${row.batch}">
    <span class="stack" aria-hidden="true">${fills}</span><span class="season">${shortSeason[row.batch.split(' ')[0]]}</span></button>`;
}

function sortedEndings(entries) {
  return Object.entries(entries).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
}

function tableRows(batch) {
  const entries = sortedEndings(batch.endings);
  const rows = entries.slice(0, 5).map(([ending, value]) =>
    `<tr><th scope="row">${escape(ending)}</th><td>${percentage(value.count, batch.websites)}</td></tr>`);
  if (entries.length > 5) rows.push(`<tr><td colspan="2">+${entries.length - 5} other endings</td></tr>`);
  return rows.join('\n');
}

const topTen = sortedEndings(endings).slice(0, 10);
const topThree = topTen.slice(0, 3).map(([ending, value], i) => ({
  rank: i + 1, ending: escape(ending), startups: `· ${count(value.count)} startups ·`,
  share: percentage(value.count, data.websites)
}));

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
const lead = 'Your .com is taken.';
const subhead = `Here’s what ${count(data.websites)} SF startups did.`;
const headline = `${lead} ${subhead}`;
const leaders = topThree.map(({ rank, ending, startups, share }) =>
  `<li><span class="rank" aria-hidden="true">${rank}</span> <b class="ending">${ending}</b> <span class="count">${startups}</span> <span class="share">${share}</span></li>`).join('\n');
const values = {
  lead, subhead, headline, dek: 'More than half of them skipped the .com. You can too.',
  edition: stamp.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  shareAlt: `${headline} The top 3 ${topThree.map(row => Object.values(row).join(' ')).join(' ')}`,
  leaders, groups,
  ranking: topTen.map(([ending, { count }]) => `<li><b class="ending">${escape(ending)}</b>
      <span class="track" aria-hidden="true"><i style="width:${100 * count / topTen[0][1].count}%"></i></span>
      <span class="share">${percentage(count, data.websites)}</span></li>`).join('\n'),
  registered, nonCom: nonCom.length, takenPct: percentage(registered, nonCom.length),
  checked: dates.join(' / '),
  bars: [...years].map(([year, rows]) => `<div class="year" style="--batches:${rows.length}">
    <div class="columns">${rows.map(column).join('')}</div><span class="year-label">${year}</span></div>`).join('\n'),
  options: batches.map(row => `<option${row === latest ? ' selected' : ''}>${row.batch}</option>`).join(''),
  latest: latest.batch, first: first.batch, tableRows: tableRows(latest),
  batchTemplates: batches.map(row => `<template data-batch="${escape(row.batch)}">${tableRows(row)}</template>`).join('\n'),
  compound: data.brand_shapes.Compound.count, prefixed: facts.exact_prefixes.get + facts.exact_prefixes.try,
  shortestDomain: escape(companies.find(row => labelLength(row) === facts.shortest_label).domain),
  longestDomain: escape(companies.find(row => labelLength(row) === facts.longest_label).domain),
  excluded: data.excluded_websites,
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
    const palette = fs.readFileSync(path.join(root, 'assets/palette.css'), 'utf8')
      .replace('mulish-latin-wght-normal.woff2', 'data:font/woff2;base64,' + font);
    const skin = fs.readFileSync(path.join(root, 'sf/palette.css'), 'utf8');
    const bridge = html.match(/<svg class="postcard-scene"[\s\S]*?<\/svg>/)[0];
    await page.setContent(`<style>${palette}${skin}
      *{box-sizing:border-box}body{margin:0;padding:32px 54px;background:var(--paper);color:var(--pine);font:750 27px Mulish,sans-serif}
      main{display:grid;grid-template-columns:1.08fr 1fr;align-items:center;gap:48px;height:566px}
      h1{font-size:78px;line-height:.95;letter-spacing:-3px;margin:0 0 18px}p{margin:0}
      aside{background:var(--mist);border:2px solid var(--pine);padding:16px 24px;transform:rotate(-2deg)}
      h2{margin:0;border-bottom:2px solid;font-size:30px}ol{list-style:none;margin:0;padding:0}
      li{display:grid;grid-template-columns:22px auto 1fr 70px;align-items:baseline;gap:10px;border-bottom:1px solid var(--mint)}
      .ending{font-size:44px}.rank,.count,.share{font:700 21px monospace}.share{text-align:right}
      svg{display:block;width:100%;height:84px}
    </style><main><div><h1>${lead}</h1><p>${subhead}</p></div>
    <aside><h2>The top 3</h2><ol>${leaders}</ol>${bridge}</aside></main>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'share.png') });
    fs.writeFileSync(path.join(output, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
render().catch(error => { console.error(error); process.exitCode = 1; });
