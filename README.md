# domainhound.dev

Static landing page for Domain Hound. Served by GitHub Pages.
Brand icons: Simple Icons (CC0), trademarks belong to their owners. Font: Mulish (OFL).

## SF startup endings

The page at `/sf/` compares the listed domain endings of Bay Area YC startups. The [directory snapshot](data/sf/endings.json) records its input revision, digest and Public Suffix List version. The [registry observations](data/sf/com-taken.json) are dated separately.

To render the checked-in edition with Node 22.12+ and headless WebKit:

```sh
SF_TOOLS=$(mktemp -d)
npm install --prefix "$SF_TOOLS" --no-audit --no-fund playwright-core@1.65.1
"$SF_TOOLS/node_modules/.bin/playwright-core" install webkit
export NODE_PATH="$SF_TOOLS/node_modules" DOMAIN_HOUND_OPEN=off
node scripts/sf/render.cjs
node scripts/sf/artifact.cjs "$SF_TOOLS/preview"
```

The second command builds a standalone preview. The form on the hosted page opens Domain Hound’s checker in the same tab. The form in the offline preview opens the hosted checker in a new tab. Edit the article in `scripts/sf/page.tmpl`. Use `node scripts/sf/verify-copy.cjs /path/to/COPY-v10.md "$SF_TOOLS/preview"` to verify the rendered edition against the approved copy.

To collect a new edition, install Python 3.10+, curl and `tldextract==5.4.0` in a virtual environment, then run `python scripts/sf/refresh.py` in that environment with the same Node settings. The refresh stages the directory counts, examples, registry checks and rendered files together. Pass `--revision <yc-oss-commit>` to choose a directory revision. Registry and redirect checks always observe the date of the run.

The feed lists current websites and may reflect rebrands. Geography matches Bay Area municipalities plus Stanford. Each season maps to a calendar quarter for the cutoff. Examples rank first by the YC top-company flag, then listed team size, with ties broken by name and YC ID. [YC directory](https://www.ycombinator.com/companies) · [YC OSS](https://github.com/yc-oss/api) · [YC terms](https://www.ycombinator.com/legal#tou) · [WordNet](https://www.nltk.org/howto/wordnet.html)

To recheck only the matching .coms, run `python3 scripts/sf/check-com.py --cache /path/to/new-run.jsonl` and render again. Reuse the cache path to resume that run. Each company on another ending contributes one observation. Companies with the same normalized brand reuse a network check. Verisign RDAP supplies registration status. Public HTTP redirects are checked separately, with one shared rate limit and the research contact in the User-Agent.
