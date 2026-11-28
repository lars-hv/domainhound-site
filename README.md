# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## SF startup endings

The static page at `/sf/` combines domain counts from publicly launched Bay Area YC companies with a 50-company ranking by announced funding. The snapshot timestamp, input revision, digest and Public Suffix List version are in [the ending dataset](data/sf/endings.json). The page includes coverage, name-shape rules and source terms.

To refresh manually, use Python 3.10+, Node 22.12+, and headless WebKit. From the repository root, install the build tools outside the checkout and run:

```sh
SF_TOOLS=$(mktemp -d)
python3 -m venv "$SF_TOOLS/venv"
"$SF_TOOLS/venv/bin/pip" install tldextract==5.4.0
npm install --prefix "$SF_TOOLS" --no-audit --no-fund playwright-core@1.65.1
"$SF_TOOLS/node_modules/.bin/playwright-core" install webkit
export NODE_PATH="$SF_TOOLS/node_modules"
"$SF_TOOLS/venv/bin/python" scripts/sf/refresh.py
```

The command downloads the current YC OSS revision, registry suffix rules and a pinned WordNet 3.0 dictionary. It rebuilds the directory and ending datasets, static HTML and 1200 × 630 share image. Pass `--revision <yc-oss-commit>` to use an earlier directory snapshot with the current suffix rules. The independently dated funding table reads the checked-in research in `data/sf/top50.json`. To update the layout from the checked-in datasets, run `node scripts/sf/render.cjs`. Edit the page text in `scripts/sf/page.tmpl`.

The public feed lists current websites, which can reflect rebrands. Geography matches [Bay Area municipalities](https://abag.ca.gov/about-abag/what-we-do/our-members) plus Stanford. Each season is assigned a calendar quarter in winter, spring, summer, fall order for the snapshot cutoff. [YC OSS](https://github.com/yc-oss/api) supplies the feed. [YC terms](https://www.ycombinator.com/legal#tou) cover the underlying directory and restrict commercial reuse. [WordNet](https://www.nltk.org/howto/wordnet.html) supplies the dictionary. Search input never enters the research data. The weekly section stays hidden pending ending-only counts with a minimum of 20 per ending per week.

### Company funding

The [top 50 dataset](data/sf/top50.json) stores the rounds, public source URLs and the Verisign RDAP and redirect evidence used for the table. Candidates are the largest teams in the YC snapshot and all confirmed Form D matches. Sum distinct public financing rounds, use Form D amounts sold where relevant and avoid counting a filing and announcement for the same round. The .com check uses the registered label of the listed domain. A listed .com or a redirect to the listed site counts as a match. A Verisign 404 indicates no registration.

The [company data](data/sf/companies.json) includes public YC names, listed hostnames and verified Form D matches. The refresh looks up each company's current name, former names and reviewed legal name in the SEC's CIK index. It compares complete names, retaining legal suffixes. A unique exact name plus the same website in SEC submissions and YC can match automatically. Before adding a row to [the issuer list](scripts/sf/issuers.csv), check the public company's identity against the primary issuer and an officer on its Form D. Record the YC ID, exact legal name, ten-digit CIK and a company notice or YC profile. Shared names, conflicting CIKs and unreviewed identities stay unmatched.

The refresh reads recent and historical submissions for each verified CIK through the directory snapshot date. It groups live Form D and D/A filings by offering file number, uses the latest amount sold per offering, and sums those amounts in USD. Unresolved offering histories stay blank. Each matched record includes its latest filing date and the original XML links. SEC requests are sequential, with a quarter-second pause and the declared contact in the User-Agent. [SEC data access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

The directory dataset keeps the earlier exact-company-name .com annotations. To update [those redirect observations](scripts/sf/com-redirects.csv), verify a public HTTP redirect in either direction and record the hostnames and date.
