"""Join public YC companies to reviewed Form D issuers and sum distinct offerings."""
import csv
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

INDEX = "https://www.sec.gov/Archives/edgar/cik-lookup-data.txt"
SUBMISSIONS = "https://data.sec.gov/submissions/"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data/"
USER_AGENT = "Domain Hound research privacy@domainhound.dev"


def sec(url):
    for attempt in range(3):
        time.sleep(0.25)  # Sequential requests, at most four starts per second.
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=90) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
            retry_after = error.headers.get("Retry-After", "")
            time.sleep(max(10 * (attempt + 1), int(retry_after) if retry_after.isdigit() else 60))
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def legal_key(name):
    # Ignore case, commas, periods and repeated whitespace. Keep every word and suffix.
    return " ".join(name.casefold().replace(",", " ").replace(".", "").split())


def name_index(raw, wanted):
    result = defaultdict(set)
    for line in raw.decode("latin-1").splitlines():
        parts = line.rsplit(":", 2)
        if len(parts) == 3 and parts[1].isdigit():
            name = legal_key(parts[0])
            if name in wanted:
                result[name].add(parts[1].zfill(10))
    return result


def filings(cik, company, as_of):
    company = company["filings"]
    pages = [company["recent"]]
    for older in company["files"]:
        if older["filingFrom"] <= as_of:
            pages.append(json.loads(sec(SUBMISSIONS + older["name"])))
    result = {}
    fields = ("accessionNumber", "filingDate", "form", "primaryDocument", "fileNumber")
    for page in pages:
        for accession, date, form, document, number in zip(*(page[k] for k in fields), strict=True):
            if form not in {"D", "D/A"} or date > as_of or accession in result:
                continue
            url = f"{ARCHIVES}{int(cik)}/{accession.replace('-', '')}/{document.split('/')[-1]}"
            xml = ElementTree.fromstring(sec(url))
            if xml.findtext("testOrLive") != "LIVE" or xml.findtext("primaryIssuer/cik") != cik:
                continue
            sold = xml.findtext("offeringData/offeringSalesAmounts/totalAmountSold", "").strip()
            result[accession] = {
                "accession": accession, "date": date, "form": form, "file_number": number,
                "issuer": xml.findtext("primaryIssuer/entityName"), "url": url,
                "previous": xml.findtext(".//previousAccessionNumber"),
                "sold": int(sold) if sold.isdigit() else None,
            }
    return list(result.values())


def offering_total(forms):
    """Keep the latest cumulative amount in each SEC offering file."""
    by_number = defaultdict(list)
    by_accession = {f["accession"]: f for f in forms}
    for f in forms:
        if not f["file_number"]:
            return None
        by_number[f["file_number"]].append(f)
        if f["previous"]:
            previous = by_accession.get(f["previous"])
            if not previous or previous["file_number"] != f["file_number"]:
                return None
    latest = []
    for group in by_number.values():
        originals = [f for f in group if f["form"] == "D"]
        if len(originals) != 1:
            return None
        # A linked amendment supersedes its predecessor, including on the same day.
        superseded = {f["previous"] for f in group}
        tips = [f for f in group if f["accession"] not in superseded]
        if not tips:
            return None
        day = max(f["date"] for f in tips)
        final = [f for f in tips if f["date"] == day]
        if len(final) != 1 or final[0]["sold"] is None:
            return None
        latest.append(final[0])
    return sum(f["sold"] for f in latest) if latest else None


def funding(companies, directory, as_of):
    with Path(__file__).with_name("issuers.csv").open() as source:
        reviewed = {int(item["yc_id"]): item for item in csv.DictReader(source)}
    names = {}
    for company in companies:
        company_id = company["id"]
        row = directory[company_id]
        aliases = [row["name"], *row["former_names"]]
        if company_id in reviewed:
            aliases.append(reviewed[company_id]["legal_name"])
        names[company_id] = {legal_key(n) for n in aliases if n.strip()}
    index = name_index(sec(INDEX), set().union(*names.values()))
    claims = defaultdict(set)
    for company_id, aliases in names.items():
        for alias in aliases:
            for cik in index.get(alias, ()):
                claims[cik].add(company_id)

    for row in companies:
        review = reviewed.get(row["id"])
        row["funding"] = None
        aliases = names[row["id"]]
        if review:
            legal = legal_key(review["legal_name"])
            candidates = index[legal]
            if candidates != {review["cik"]}:
                continue
        else:
            candidates = set().union(*(index.get(alias, set()) for alias in aliases))
            if len(candidates) != 1:
                continue
        cik = next(iter(candidates))
        if claims[cik] != {row["id"]}:
            continue
        submission_url = f"{SUBMISSIONS}CIK{cik}.json"
        company = json.loads(sec(submission_url))
        if review:
            accepted_names = {legal}
            source = review["source"]
        else:
            # An SEC-listed corporate website can corroborate a new exact-name match.
            website = company.get("website") or ""
            host = urlsplit(website if "://" in website else "//" + website).hostname
            if not host or host.lower().removeprefix("www.") != row["domain"]:
                continue
            accepted_names = aliases
            source = submission_url
        forms = filings(cik, company, as_of)
        if not forms or any(legal_key(f["issuer"]) not in accepted_names for f in forms):
            continue
        sold = offering_total(forms)
        if sold is None:
            continue
        row["funding"] = {
            "legal_name": forms[0]["issuer"], "cik": cik, "name_source": source,
            "sold": sold, "latest_filing": max(f["date"] for f in forms),
            "filings": sorted(forms, key=lambda f: (f["date"], f["accession"])),
        }
    return {"as_of": as_of, "companies": companies}
