# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## SF startup domains

The [SF page](sf/index.html) compares the listed names and current addresses of Bay Area companies in the public YC directory. The [snapshot](data/sf/endings.json) contains aggregate counts, batch sizes, provenance and the hand-check result.

To rebuild the HTML and social image from the checked-in counts, run `node scripts/sf/render.cjs` with Node 22.12+ and Playwright's WebKit installed. Edit the page text in `scripts/sf/page.tmpl`.

To reproduce the underlying counts, install the tools outside the checkout and run:

```sh
SF_TOOLS=$(mktemp -d)
python3 -m venv "$SF_TOOLS/venv"
"$SF_TOOLS/venv/bin/pip" install tldextract==5.4.0
npm install --prefix "$SF_TOOLS" --no-audit --no-fund playwright-core@1.65.1
"$SF_TOOLS/node_modules/.bin/playwright-core" install webkit
export NODE_PATH="$SF_TOOLS/node_modules"
"$SF_TOOLS/venv/bin/python" scripts/sf/refresh.py --revision 3164430271c7fd083eee684c2abe5de3c79b6bfc
```

The refresh uses the [YC OSS feed](https://github.com/yc-oss/api), the current registry section of the [Public Suffix List](https://publicsuffix.org/list/) and listed Bay Area locations. For a new snapshot, omit the revision and update the dated audit before publishing counts. Draw 50 usable records with Python’s `random.Random(seed).sample(sorted(company_ids), 50)`. Inspect the listed brand and website independently. Record the four-way labels in draw order in `scripts/sf/audit.json` (E/D for exact/different and C/O for .com/other). The refresh compares these labels with its classifications. Company-level inputs stay out of the output. [YC terms](https://www.ycombinator.com/legal#tou)

The site uses the shared Domain Hound name checker. To package a portable preview, run `python3 scripts/sf/artifact.py <output-folder>`. Its live .com and .ai checks read the public registries directly because the hosted checker restricts browser origins. A missing registry record does not establish that a domain is available to purchase.
