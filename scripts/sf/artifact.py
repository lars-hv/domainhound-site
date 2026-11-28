"""Package the SF page for an offline artifact at any path."""
import argparse
import json
from pathlib import Path
import re
from shutil import copy2

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one copy of {old!r}")
    return text.replace(old, new)


def inline_data(name, fields):
    data = json.loads((ROOT / f"data/sf/{name}.json").read_text())
    return json.dumps({key: data[key] for key in fields}, separators=(",", ":"))


def portable_script():
    chart = (ROOT / "sf/page.mjs").read_text()
    chart = replace_once(chart, """  const response = await fetch('/data/sf/endings.json');
  if (!response.ok) return;
  const { batches } = await response.json();""", "  const { batches } = endings;")
    chart = replace_once(chart, """  const { runSearch } = await import('/assets/search-api.mjs');
  signal.throwIfAborted();
  return runSearch('name', { name, extraEnding: 'io' }, signal);""", """  const query = name.normalize('NFKC').toLowerCase().replace(/\\.$/, '');
  const domains = new Set(companies.filter(row =>
    row.company.normalize('NFKC').toLowerCase() === query ||
    row.domain === query || row.domain.slice(0, -row.ending.length) === query
  ).map(row => row.domain));
  return { items: [...domains].map(domain => ({ domain, status: 'listed' })) };""")
    chart = replace_once(chart, "taken: 'Taken'", "listed: 'Listed in the snapshot'")
    chart = replace_once(chart, "'Domain check results' : 'No endings confirmed. Try another name.'",
                         "'Snapshot matches' : 'We couldn’t find that name in this snapshot.'")
    chart = replace_once(chart, "new URL('/sf/', location.origin)", "new URL('./index.html', location.href)")

    funding = re.sub(r"^export ", "", (ROOT / "sf/funding.mjs").read_text(), flags=re.M)
    table = (ROOT / "sf/funding-table.mjs").read_text().split("\n", 1)[1]
    table = replace_once(table, """  const response = await fetch('/data/sf/top50.json');
  if (!response.ok) return;
  const { companies } = await response.json();
""", "  const { companies } = top50;\n")

    endings = inline_data("endings", ["batches"])
    companies = inline_data("companies", ["companies"])
    top50 = inline_data("top50", ["companies"])
    return (f"(() => {{\nconst endings = {endings};\nconst {{ companies }} = {companies};\n"
            f"const top50 = {top50};\n(() => {{\n{chart}}})();\n{funding}{table}}})();\n")


def package(output):
    files = ["assets/home.css", "assets/palette.css", "assets/mulish-latin-wght-normal.woff2",
             "assets/OFL.txt", "assets/hound-mark.svg", "sf/page.css", "sf/palette.css", "sf/share.png",
             "data/sf/endings.json", "data/sf/companies.json", "data/sf/top50.json"]
    for file in files:
        target = output / file
        target.parent.mkdir(exist_ok=True, parents=True)
        copy2(ROOT / file, target)

    html = (ROOT / "sf/index.html").read_text()
    html = re.sub(r'<a\b[^>]*\sdownload\b[^>]*>[^<]*</a>', '', html)
    html = re.sub(r'<a href="(https://[^"<>]+)"([^<>]*)>([^<]*)</a>',
                  lambda match: (f'<span{match[2]}>{match[3]}</span>' if ' title=' in match[2]
                                 else f'<span title="{match[1]}"{match[2]}>{match[3]}</span>'), html)
    html = html.replace('<a href="/privacy/">Privacy</a>',
                        '<span title="Name lookups in this preview run on your device.">Privacy</span>')
    html = html.replace('href="/"', 'href="#top"').replace('<body>', '<body id="top">')
    html = html.replace('aria-label="Domain Hound home"', 'aria-label="Back to top"')
    html = html.replace('https://domainhound.dev/sf/share.png', 'sf/share.png')
    html = html.replace('https://domainhound.dev/sf/', 'index.html')
    html = html.replace('"/assets/', '"assets/').replace('"/sf/', '"sf/')
    html = replace_once(html, '''  <script type="module" src="sf/page.mjs"></script>
  <script type="module" src="sf/funding-table.mjs"></script>''',
                        '  <script defer src="sf/page.js"></script>')
    html = html.replace('· Free check', '· Snapshot lookup')
    html = html.replace('Check endings</button>', 'Look up name</button>')
    html = html.replace('Turn on JavaScript to check a name.',
                        'Turn on JavaScript to look up a name in this snapshot.')
    html = replace_once(html, 'Check what’s available and what your exact name costs to renew.',
                        'Look up a company or domain in this directory snapshot.')
    html = replace_once(html, '>Check a name</a>', '>Look up a name</a>')
    (output / "index.html").write_text(html)
    (output / "sf/page.js").write_text(portable_script())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    package(parser.parse_args().output)
