// Package the rendered article for file://, with the checker as an external link.
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
const html = fs.readFileSync(path.join(root, 'sf/index.html'), 'utf8')
  .replace('<script type="module" src="/sf/page.mjs"></script>',
    '<script defer src="sf/page.js"></script>')
  .replace('action="/"', 'action="https://domainhound.dev/" target="_blank" rel="noopener noreferrer"')
  .replaceAll('href="/assets/', 'href="assets/').replaceAll('href="/sf/', 'href="sf/')
  .replace('content="https://domainhound.dev/sf/share.png"', 'content="sf/share.png"')
  .replaceAll('src="/assets/', 'src="assets/').replaceAll('href="/"', 'href="https://domainhound.dev/"')
  .replaceAll('href="/privacy/"', 'href="https://domainhound.dev/privacy/"');
fs.writeFileSync(path.join(output, 'index.html'), html);
