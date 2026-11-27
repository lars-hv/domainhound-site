"""Refresh the Bay Area YC website aggregates. See README for inputs and usage."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import urlopen

import tldextract

ROOT = Path(__file__).resolve().parents[2]
FEED = "https://yc-oss.github.io/api"
PSL = "https://publicsuffix.org/list/public_suffix_list.dat"
WORDNET = ("https://raw.githubusercontent.com/nltk/nltk_data/"
           "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/packages/corpora/wordnet.zip")
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


def word_list(archive):
    words = set()
    with zipfile.ZipFile(io.BytesIO(archive)) as files:
        for part in ("noun", "verb", "adj", "adv"):
            for line in files.read("wordnet/index." + part).splitlines():
                if line.startswith(b" "):
                    continue
                word = line.split()[0]
                if word.isalpha():
                    words.add(word.decode("ascii"))
    return words


def name_shape(name, words):
    name = name.strip()
    if not re.fullmatch(r"[A-Za-z]+(?:[ -][A-Za-z]+)*", name):
        return "Other"
    parts = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).lower().replace("-", " ").split()
    if len(parts) > 1:
        return "Compound" if all(part in words for part in parts) else "Other"
    word = parts[0]
    if word in words:
        return "One dictionary word"
    if any(word[:i] in words and word[i:] in words for i in range(3, len(word) - 2)):
        return "Compound"
    return "Possibly made-up"


def shares(counts):
    total = sum(counts.values())
    return {ending: {"count": count, "pct": round(100 * count / total, 2)}
            for ending, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))}


def aggregate(rows, as_of, extractor, words):
    batches = defaultdict(Counter)
    shapes, prefixes = Counter(), Counter()
    lengths, matched_com, mismatched_com, hyphens, digits = [], 0, 0, 0, 0
    missing, seen = 0, set()
    for row in rows:
        match = re.fullmatch(r"(Winter|Spring|Summer|Fall) (\d{4})", row["batch"])
        if not match or not in_bay_area(row["all_locations"]):
            continue
        season, year = SEASONS.index(match[1]), int(match[2])
        if year < 2023 or (year, season) > (as_of.year, (as_of.month - 1) // 3):
            continue
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        counts = batches[(year, season)]
        website = domain_parts(row["website"], extractor)
        if website is None:
            missing += 1
            continue
        label, ending = website
        counts[ending] += 1
        shapes[name_shape(row["name"], words)] += 1
        brand = re.sub(r"[^a-z0-9]", "", row["name"].lower())
        stem = label.replace("-", "")
        if ending == ".com":
            if brand == stem:
                matched_com += 1
            else:
                mismatched_com += 1
        for prefix in ("get", "try", "hq"):
            if brand and stem == prefix + brand:
                prefixes[prefix] += 1
        lengths.append(len(label))
        hyphens += "-" in label
        digits += bool(re.search(r"\d", label))
    total = sum(batches.values(), Counter())
    if not lengths or len(seen) != len(lengths) + missing:
        raise ValueError("Unexpected cohort coverage")
    return {
        "eligible_companies": len(seen), "excluded_websites": missing, "websites": len(lengths),
        "endings": shares(total),
        "batches": [{"batch": f"{SEASONS[s]} {y}", "websites": sum(c.values()), "endings": shares(c)}
                    for (y, s), c in sorted(batches.items())],
        "brand_shapes": shares(shapes),
        "facts": {"shortest_label": min(lengths), "longest_label": max(lengths),
                  "median_label": median(lengths), "hyphenated": hyphens, "digits": digits,
                  "distinct_endings": len(total), "singleton_endings": sum(v == 1 for v in total.values()),
                  "matching_com": matched_com, "different_com": mismatched_com,
                  "exact_prefixes": {p: prefixes[p] for p in ("get", "try", "hq")}},
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
    with TemporaryDirectory() as temp:
        path = Path(temp, "psl.dat")
        path.write_bytes(psl)
        extractor = tldextract.TLDExtract(suffix_list_urls=(path.as_uri(),), cache_dir=None,
                                            fallback_to_snapshot=False, include_psl_private_domains=False)
        data = aggregate(rows, as_of, extractor, word_list(fetch(WORDNET)))
    data["source"] = {"directory": FEED + "/companies/all.json", "snapshot": base + "/companies/all.json",
                      "updated": meta["last_updated"], "sha256": hashlib.sha256(raw).hexdigest(),
                      "psl": PSL, "psl_version": re.search(rb"// VERSION: (.+)", psl)[1].decode(),
                      "wordnet": WORDNET}
    # The renderer and share card both read this file. Raw company rows never reach the site.
    with TemporaryDirectory(dir=ROOT) as staging:
        stage = Path(staging)
        (stage / "endings.json").write_text(json.dumps(data, indent=2) + "\n")
        subprocess.run(["node", str(ROOT / "scripts/sf/render.cjs"), staging], check=True)
        for file, directory in (("endings.json", "data/sf"), ("index.html", "sf"), ("share.png", "sf")):
            (stage / file).replace(ROOT / directory / file)


if __name__ == "__main__":
    main()
