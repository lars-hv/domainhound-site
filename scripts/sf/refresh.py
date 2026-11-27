"""Refresh the Bay Area YC website aggregates. See README for inputs and usage."""
import argparse
import hashlib
import json
import random
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import urlopen

import tldextract

ROOT = Path(__file__).resolve().parents[2]
FEED = "https://yc-oss.github.io/api"
PSL = "https://publicsuffix.org/list/public_suffix_list.dat"
SEASONS = ("Winter", "Spring", "Summer", "Fall")
# ABAG's incorporated cities and towns plus Stanford, a listed unincorporated place.
CITIES = set("""
Alameda|Albany|Berkeley|Dublin|Emeryville|Fremont|Hayward|Livermore|Newark|Oakland|Piedmont|Pleasanton|San Leandro|Union City
Antioch|Brentwood|Clayton|Concord|Danville|El Cerrito|Hercules|Lafayette|Martinez|Moraga|Oakley|Orinda|Pinole|Pittsburg|Pleasant Hill|Richmond|San Pablo|San Ramon|Walnut Creek
Belvedere|Corte Madera|Fairfax|Larkspur|Mill Valley|Novato|Ross|San Anselmo|San Rafael|Sausalito|Tiburon
American Canyon|Calistoga|Napa|St. Helena|Yountville
San Francisco
Atherton|Belmont|Brisbane|Burlingame|Colma|Daly City|East Palo Alto|Foster City|Half Moon Bay|Hillsborough|Menlo Park|Millbrae|Pacifica|Portola Valley|Redwood City|San Bruno|San Carlos|San Mateo|South San Francisco|Woodside
Campbell|Cupertino|Gilroy|Los Altos|Los Altos Hills|Los Gatos|Milpitas|Monte Sereno|Morgan Hill|Mountain View|Palo Alto|San Jose|San José|Santa Clara|Saratoga|Sunnyvale|Stanford
Benicia|Dixon|Fairfield|Rio Vista|Suisun City|Vacaville|Vallejo
Cloverdale|Cotati|Healdsburg|Petaluma|Rohnert Park|Santa Rosa|Sebastopol|Sonoma|Windsor
""".strip().lower().replace("\n", "|").split("|"))


def in_bay_area(locations):
    for place in locations.lower().split(";"):
        city, *region = [part.strip() for part in place.split(",")]
        if city in CITIES and region in (["ca", "usa"], ["california", "usa"]):
            return True
        if city in {"san francisco bay area", "sf bay area"} and region in ([], ["ca", "usa"]):
            return True
    return False


def domain_parts(raw, extractor):
    if not raw:
        return None
    try:
        url = urlsplit(raw.strip())
        if url.scheme not in {"http", "https"} or not url.hostname:
            return None
        host = url.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except (ValueError, UnicodeError):
        return None
    if len(host) > 253 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                                  for label in host.split(".")):
        return None
    result = extractor(host)
    if result.domain and result.suffix:
        return result.domain, "." + result.suffix
    return None


def spelling(value):
    return "".join(c for c in unicodedata.normalize("NFC", value).casefold() if c.isalnum())


def aggregate(rows, as_of, extractor, digest):
    batches = defaultdict(Counter)
    endings = Counter()
    choices = defaultdict(Counter)
    seen = set()
    classified = {}
    for row in rows:
        match = re.fullmatch(r"(Winter|Spring|Summer|Fall) (\d{4})", row["batch"])
        if not match or not in_bay_area(row["all_locations"]):
            continue
        season, year = SEASONS.index(match[1]), int(match[2])
        if year < 2023 or (year, season) > (as_of.year, (as_of.month - 1) // 3) or row["id"] in seen:
            continue
        seen.add(row["id"])
        parts = domain_parts(row["website"], extractor)
        if not parts:
            continue
        label, ending = parts
        if label.startswith("xn--"):
            try:
                label = label.encode("ascii").decode("idna")
            except UnicodeError:
                pass
        exact = spelling(label) == spelling(row["name"])
        key = ("exact" if exact else "different") + ("Com" if ending == ".com" else "Other")
        batch = (year, season)
        batches[batch][ending] += 1
        choices[batch][key] += 1
        endings[ending] += 1
        classified[row["id"]] = key

    # Hand labels are in draw order. Keep company records out of the public site.
    audit = json.loads(Path(__file__).with_name("audit.json").read_text())
    if digest != audit["snapshot_sha256"]:
        raise ValueError("Hand-check 50 pairs for this snapshot and update audit.json before publishing counts.")
    sample = random.Random(audit["seed"]).sample(sorted(classified), 50)
    labels = audit["labels"].split()
    codes = {"EO": "exactOther", "EC": "exactCom", "DO": "differentOther", "DC": "differentCom"}
    if len(labels) != len(sample):
        raise ValueError("Expected 50 hand labels")
    errors = sum(classified[key] != codes[label] for key, label in zip(sample, labels))
    return {
        "eligible_companies": len(seen), "excluded_websites": len(seen) - len(classified),
        "websites": len(classified), "endings": dict(sorted(endings.items())),
        "batches": [{"batch": f"{SEASONS[s]} {y}", "websites": sum(counts.values()),
                     "ai": counts[".ai"], "choices": {key: choices[y, s][key] for key in codes.values()}}
                    for (y, s), counts in sorted(batches.items())],
        "audit": {"date": audit["date"], "sample": len(sample), "errors": errors},
    }


def fetch(url):
    with urlopen(url, timeout=60) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", help="Replay a specific yc-oss/api commit")
    args = parser.parse_args()
    revision = args.revision or json.loads(fetch("https://api.github.com/repos/yc-oss/api/commits/main"))["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Expected a full commit hash")
    base = f"https://raw.githubusercontent.com/yc-oss/api/{revision}"
    meta = json.loads(fetch(base + "/meta.json"))
    raw = fetch(base + "/companies/all.json")
    rows = json.loads(raw)
    if len(rows) != meta["companies"]["all"]["count"]:
        raise ValueError("Directory metadata and company file disagree")
    as_of = date.fromisoformat(meta["last_updated"][:10])
    psl = fetch(PSL)
    digest = hashlib.sha256(raw).hexdigest()
    with TemporaryDirectory() as temp:
        path = Path(temp, "psl.dat")
        path.write_bytes(psl)
        extractor = tldextract.TLDExtract(suffix_list_urls=(path.as_uri(),), cache_dir=None,
                                          fallback_to_snapshot=False, include_psl_private_domains=False)
        data = aggregate(rows, as_of, extractor, digest)
    data["source"] = {"directory": FEED + "/companies/all.json", "snapshot": base + "/companies/all.json",
                      "updated": meta["last_updated"], "sha256": digest, "psl": PSL,
                      "psl_version": re.search(rb"// VERSION: (.+)", psl)[1].decode()}
    with TemporaryDirectory(dir=ROOT) as staging:
        stage = Path(staging)
        (stage / "endings.json").write_text(json.dumps(data, indent=2) + "\n")
        subprocess.run(["node", str(ROOT / "scripts/sf/render.cjs"), staging], check=True)
        outputs = (("endings.json", "data/sf"), ("index.html", "sf"), ("share.png", "sf"))
        for file, directory in outputs:
            (stage / file).replace(ROOT / directory / file)


if __name__ == "__main__":
    main()
