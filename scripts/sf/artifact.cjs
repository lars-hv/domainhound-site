// Package the same rendered page for file://, including a local directory search.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
if (!output) throw new Error('Pass the destination directory for the offline preview');

for (const file of ['assets/home.css', 'assets/palette.css', 'assets/hound-mark.svg',
  'assets/mulish-latin-wght-normal.woff2', 'sf/page.css', 'sf/palette.css', 'sf/share.png']) {
  fs.mkdirSync(path.join(output, path.dirname(file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.copyFileSync(path.join(root, 'sf/page.mjs'), path.join(output, 'sf/page.js'));
const { companies } = JSON.parse(fs.readFileSync(path.join(root, 'data/sf/companies.json')));
const data = JSON.stringify(companies.map(({ company, domain }) => [company, domain])).replaceAll('<', '\\u003c');
const html = fs.readFileSync(path.join(root, 'sf/index.html'), 'utf8')
  .replace('<script type="module" src="/sf/page.mjs"></script>',
    '<script defer src="sf/page.js"></script>')
  .replace('</body>', () => `<script type="application/json" id="offline-directory">${data}</script>\n</body>`)
  .replaceAll('href="/assets/', 'href="assets/').replaceAll('href="/sf/', 'href="sf/')
  .replace('content="https://domainhound.dev/sf/share.png"', 'content="sf/share.png"')
  .replaceAll('src="/assets/', 'src="assets/').replaceAll('href="/"', 'href="https://domainhound.dev/"')
  .replaceAll('href="/privacy/"', 'href="https://domainhound.dev/privacy/"')
  .replace('>Name or domain</label>', '>Name or domain in this directory</label>')
  .replace('>Check endings</button>', '>Look up name</button>')
  .replace('Turn on JavaScript for a live domain check.', 'Turn on JavaScript for the directory lookup.');
fs.writeFileSync(path.join(output, 'index.html'), html);
