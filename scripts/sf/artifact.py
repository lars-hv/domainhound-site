"""Package the SF preview for a static host at any path."""
import argparse
from pathlib import Path
from shutil import copy2

ROOT = Path(__file__).resolve().parents[2]


def package(output):
    files = ["assets/home.css", "assets/palette.css", "assets/mulish-latin-wght-normal.woff2",
             "assets/OFL.txt", "assets/hound-mark.svg", "sf/page.css", "sf/page.mjs",
             "sf/share.png", "data/sf/endings.json"]
    for file in files:
        target = output / file
        target.parent.mkdir(exist_ok=True, parents=True)
        copy2(ROOT / file, target)
    html = (ROOT / "sf/index.html").read_text().replace('<html lang="en">', '<html lang="en" data-registry-preview>')
    html = html.replace('"../assets/', '"assets/').replace('"../data/', '"data/')
    html = html.replace('"page.css"', '"sf/page.css"').replace('"page.mjs"', '"sf/page.mjs"')
    html = html.replace('"https://domainhound.dev/sf/share.png"', '"sf/share.png"')
    (output / "index.html").write_text(html)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    package(parser.parse_args().output)
