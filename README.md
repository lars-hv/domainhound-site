# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## SF startup endings

The static page at `/sf/` uses only aggregate counts from publicly launched Bay Area YC companies. The snapshot timestamp, input revision, digest and Public Suffix List version are in [the dataset](data/sf/endings.json). The page includes coverage, name-shape rules and source terms.

To refresh manually, use Python 3.10+, Node 22+, and headless WebKit. From the repository root, install the build tools outside the checkout and run:

```sh
SF_TOOLS=$(mktemp -d)
python3 -m venv "$SF_TOOLS/venv"
"$SF_TOOLS/venv/bin/pip" install tldextract==5.4.0
npm install --prefix "$SF_TOOLS" --no-audit --no-fund playwright-core@1.65.1
"$SF_TOOLS/node_modules/.bin/playwright-core" install webkit
export NODE_PATH="$SF_TOOLS/node_modules"
"$SF_TOOLS/venv/bin/python" scripts/sf/refresh.py
```

The command downloads the current YC OSS revision, registry suffix rules and a pinned WordNet 3.0 dictionary. It regenerates the JSON, static HTML and 1200 × 630 share image together. Pass `--revision <yc-oss-commit>` to use an earlier directory snapshot with the current suffix rules. To update the layout from the checked-in counts, run `node scripts/sf/render.cjs`. Edit the page text in `scripts/sf/page.tmpl`.

The public feed lists current websites, which can reflect rebrands. Geography matches [Bay Area municipalities](https://abag.ca.gov/about-abag/what-we-do/our-members) plus Stanford. Each season is assigned a calendar quarter in winter, spring, summer, fall order for the snapshot cutoff. [YC OSS](https://github.com/yc-oss/api) supplies the feed. [YC terms](https://www.ycombinator.com/legal#tou) cover the underlying directory and restrict commercial reuse. [WordNet](https://www.nltk.org/howto/wordnet.html) supplies the dictionary. Search input never enters the research data. The weekly section stays hidden pending ending-only counts with a minimum of 20 per ending per week.
