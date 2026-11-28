const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webkit } = require('playwright-core');
const { batches } = require('../../data/sf/endings.json');
const { companies } = require('../../data/sf/companies.json');
const examples = require('../../data/sf/examples.json');

const [copyPath, artifactDirectory] = process.argv.slice(2);
if (!copyPath || !artifactDirectory) {
  throw new Error('Usage: node scripts/sf/verify-copy.cjs COPY-v10.md /path/to/offline-artifact');
}

const copy = fs.readFileSync(copyPath, 'utf8');
const lines = copy.trim().split(/\r?\n/);
const seasons = { Winter: 'W', Spring: 'Sp', Summer: 'Su', Fall: 'F' };
const latest = batches.at(-1);
const exampleText = Object.entries(examples).flatMap(([ending, rows]) => [ending,
  ...rows.flatMap(({ id }) => {
    const { company, domain } = companies.find(row => row.id === id);
    return [company, domain];
  })]);
const chartText = ['.com', '.ai', 'Other endings', '100%', '50%', '0%'];
for (const [year, rows] of Map.groupBy(batches, row => row.batch.split(' ')[1])) {
  chartText.push(...rows.map(row => seasons[row.batch.split(' ')[0]]), year);
}
const batchEndings = Object.entries(latest.endings).sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b));
for (const [ending, { count }] of batchEndings.slice(0, 5)) {
  const share = count / latest.websites * 100;
  chartText.push(ending, share.toFixed(share < 10 ? 1 : 0) + '%');
}
if (batchEndings.length > 5) chartText.push(`+${batchEndings.length - 5} other endings`);

const visible = [];
for (const line of lines) {
  if (!line || /^(# |Numbers: |Share card: |Remove: |\(On the site: )/.test(line)) continue;
  if (line.startsWith('(bar list, same data: ')) {
    visible.push(...line.slice('(bar list, same data: '.length, -1).split(', '));
  } else if (line.startsWith('(keep the five lists exactly as v9: ')) {
    visible.push(...exampleText);
  } else if (line.startsWith('(chart as v9; ')) {
    visible.push(...chartText);
  } else {
    assert.ok(!line.startsWith('('), `Unrecognized copy instruction: ${line}`);
    visible.push(line.replace(/^(## |KICKER: |H1: |DEK: |BIG: |BUTTON: |FOOTER: )/, '')
      .replace('Method (small, bottom)', 'Method')
      .replace('taken. / Here’s', 'taken. Here’s'));
  }
}
const normalize = value => value.replace(/\s+/g, ' ').trim();
const headline = lines.find(line => line.startsWith('H1: ')).slice(4).replace(' / ', ' ');
const dek = lines.find(line => line.startsWith('DEK: ')).slice(5);
const leaders = lines.filter(line => /^[123] \./.test(line));
const metadata = {
  'name="description"': dek,
  'property="og:title"': headline,
  'property="og:description"': dek,
  'property="og:image:alt"': [headline, 'The top 3', ...leaders].join(' ')
};
const root = path.resolve(__dirname, '../..');
const artifact = pathToFileURL(path.resolve(artifactDirectory, 'index.html')).href;

(async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('https://site.example/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ path: path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname) });
    });
    for (const url of ['https://site.example/sf/', artifact]) {
      await page.goto(url);
      assert.equal(normalize(await page.locator('body').innerText()), normalize(visible.join(' ')), url);
      assert.equal(await page.title(), headline);
      for (const [attribute, value] of Object.entries(metadata)) {
        assert.equal(await page.locator(`meta[${attribute}]`).getAttribute('content'), value);
      }
      assert.deepEqual(await page.locator('#batch-select option').allTextContents(), batches.map(row => row.batch));
      assert.equal(await page.locator('#batch-select').inputValue(), latest.batch);
      assert.equal(await page.locator('#candidate').getAttribute('placeholder'), null);
      assert.doesNotMatch(await page.content(), /raised|funding|Form D/i);
    }
    console.log('0 unexpected strings');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
