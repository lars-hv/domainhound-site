# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## SF startup endings

The static page at `/sf/` combines domain counts from publicly launched Bay Area YC companies with reported Form D funding. The snapshot timestamp, input revision, digest and Public Suffix List version are in [the dataset](data/sf/endings.json). The page includes coverage, name-shape rules and source terms.

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

The command downloads the current YC OSS revision, registry suffix rules and a pinned WordNet 3.0 dictionary. It rebuilds both datasets, the static HTML and 1200 × 630 share image together. Pass `--revision <yc-oss-commit>` to use an earlier directory snapshot with the current suffix rules. To update the layout from the checked-in counts, run `node scripts/sf/render.cjs`. Edit the page text in `scripts/sf/page.tmpl`.

The public feed lists current websites, which can reflect rebrands. Geography matches [Bay Area municipalities](https://abag.ca.gov/about-abag/what-we-do/our-members) plus Stanford. Each season is assigned a calendar quarter in winter, spring, summer, fall order for the snapshot cutoff. [YC OSS](https://github.com/yc-oss/api) supplies the feed. [YC terms](https://www.ycombinator.com/legal#tou) cover the underlying directory and restrict commercial reuse. [WordNet](https://www.nltk.org/howto/wordnet.html) supplies the dictionary. Search input never enters the research data. The weekly section stays hidden pending ending-only counts with a minimum of 20 per ending per week.

### Company funding

The [company data](data/sf/companies.json) includes public YC names, listed hostnames and verified Form D matches. The refresh looks up each company's current name, former names and reviewed legal name in the SEC's CIK index. It compares complete names, retaining legal suffixes. A unique exact name plus the same website in SEC submissions and YC can match automatically. Before adding a row to [the issuer list](scripts/sf/issuers.csv), check the public company's identity against the primary issuer and an officer on its Form D. Record the YC ID, exact legal name, ten-digit CIK and a company notice or YC profile. Shared names, conflicting CIKs and unreviewed identities stay unmatched.

The refresh reads recent and historical submissions for each verified CIK through the directory snapshot date. It groups live Form D and D/A filings by offering file number, uses the latest amount sold per offering, and sums those amounts in USD. Unresolved offering histories stay blank. Each matched record includes its latest filing date and the original XML links. SEC requests are sequential, with a quarter-second pause and the declared contact in the User-Agent. [SEC data access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

A brand-matching .com uses the listed name in lowercase letters and digits. “Yes” needs either a listed website on that .com or a dated redirect between the two domains. To update [redirect observations](scripts/sf/com-redirects.csv), verify a public HTTP redirect in either direction and record the hostnames and date. A timeout, parked site or different destination leaves ownership unverified. The headline counts listed .com websites among matched issuers, regardless of additional domains.
