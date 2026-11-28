"""Measure today's matching .com registrations and HTTP redirects for the SF cohort."""
import argparse
import concurrent.futures
import datetime
import ipaddress
import json
import re
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[2]
AGENT = "Domain Hound research privacy@domainhound.dev"
START_LOCK = threading.Lock()
last_request = 0.0


def request(url, flags):
    global last_request
    with START_LOCK:
        time.sleep(max(0, last_request + 0.23 - time.monotonic()))
        process = subprocess.Popen(
            ["curl", "-q", "-sS", "--noproxy", "*", "--proto", "=http,https",
             "--max-time", "9", "--connect-timeout", "4", "-A", AGENT, *flags, url],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        last_request = time.monotonic()
    raw, _ = process.communicate()
    return process.returncode, raw.decode("utf-8", "replace")


def registration(domain):
    url = "https://rdap.verisign.com/com/v1/domain/" + domain
    for attempt in range(3):
        code, raw = request(url, ["-w", "\\n%{http_code}"])
        body, _, status = raw.rpartition("\n")
        # Verisign also returns an empty body with its authoritative 404.
        if not code and status == "404" and not body.strip():
            return "unregistered"
        try:
            doc = json.loads(body)
            if not isinstance(doc, dict):
                raise ValueError("Expected an RDAP object")
            if not code and status == "200" and doc.get("ldhName", "").lower() == domain:
                return "registered"
            if not code and status == "404" and doc.get("errorCode") == 404:
                return "unregistered"
        except ValueError:
            pass
        time.sleep(2 ** attempt)
    return "unknown"


def redirect(domain, targets, scheme, use_get=False):
    url = scheme + "://" + domain + "/"
    seen = set()
    for _ in range(10):
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            if parsed.scheme not in ("http", "https") or not host or parsed.username:
                return "unknown", None
            if host.removeprefix("www.") in targets and seen:
                return "redirect", host.removeprefix("www.")
            if url in seen:
                return "unknown", None
            seen.add(url)
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            if port not in (80, 443):
                return "unknown", None
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            ip = next((a[-1][0] for a in addresses if ipaddress.ip_address(a[-1][0]).is_global), None)
            if not ip:
                return "unknown", None
            addr = "[" + ip + "]" if ":" in ip else ip
            flags = ["--resolve", f"{host}:{port}:{addr}", "-o", "/dev/null",
                     "-w", "%{http_code}\n%{redirect_url}"]
            bounded_get = ["--range", "0-0", "--max-filesize", "65536"]
            code, raw = request(url, [*(bounded_get if use_get else ["--head"]), *flags])
            status, _, dest = raw.partition("\n")
            if not use_get and status in ("403", "405", "501"):
                code, raw = request(url, [*bounded_get, *flags])
                status, _, dest = raw.partition("\n")
            if code and not (code == 63 and status.startswith("2")):
                return "unknown", None
            if status in ("301", "302", "303", "307", "308") and dest:
                url = urljoin(url, dest)
            elif status.startswith("2") or status in ("404", "410"):
                return "no_redirect", None
            else:
                return "unknown", None
        except socket.gaierror as error:
            if error.errno in (socket.EAI_NONAME, getattr(socket, "EAI_NODATA", None)):
                return "no_address", None
            return "unknown", None
        except (OSError, ValueError):
            return "unknown", None
    return "unknown", None


def check(item):
    domain, rows, previous = item
    targets = {r["domain"].removeprefix("www.") for r in rows}
    def stamp():
        return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    if previous:
        for probe in previous["probes"]:
            if probe["result"] == "unknown":
                result, host = redirect(domain, targets, probe["scheme"], use_get=True)
                probe.update(result=result, target=host, rechecked_utc=stamp())
        return previous

    state = registration(domain)
    observations = []
    if state != "unregistered":
        for scheme in ("https", "http"):
            result, host = redirect(domain, targets, scheme)
            observations.append({"scheme": scheme, "result": result, "target": host})
            if result == "redirect" and len(targets) == 1:
                break
    return {"com": domain, "registration": state, "checked_utc": stamp(), "probes": observations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="New dated run or resumable JSONL file")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "data/sf")
    parser.add_argument("--retry-redirects", action="store_true", help="Retry inconclusive HTTP probes using GET")
    args = parser.parse_args()
    companies = json.loads((args.input_dir / "companies.json").read_text())["companies"]
    groups = {}
    for row in companies:
        if row["ending"] != ".com":
            domain = re.sub(r"[^a-z0-9]", "", row["company"].lower()) + ".com"
            groups.setdefault(domain, []).append(row)
    done = {}
    if args.cache.exists():
        for line in args.cache.read_text().splitlines():
            row = json.loads(line)
            done[row["com"]] = row
    pending = []
    for domain, rows in groups.items():
        previous = done.get(domain)
        if not previous or previous["registration"] == "unknown":
            pending.append((domain, rows, None))
        elif args.retry_redirects and any(p["result"] == "unknown" for p in previous["probes"]):
            pending.append((domain, rows, previous))
    with args.cache.open("a") as cache, concurrent.futures.ThreadPoolExecutor(20) as pool:
        for future in concurrent.futures.as_completed([pool.submit(check, item) for item in pending]):
            row = future.result()
            done[row["com"]] = row
            print(json.dumps(row), file=cache, flush=True)
    output = []
    for domain, rows in groups.items():
        for startup in rows:
            record = done[domain]
            probes = record["probes"]
            if not probes:
                result = "unregistered"
            elif any(p["target"] == startup["domain"].removeprefix("www.") for p in probes):
                result = "redirect"
            elif any(p["result"] == "unknown" for p in probes):
                result = "unknown"
            else:
                result = "no_redirect"
            output.append({"id": startup["id"], "listed_domain": startup["domain"], **record,
                           "redirect_to_startup": result})
    path = args.input_dir / "com-taken.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(sorted(output, key=lambda r: r["id"]), indent=2) + "\n")
    temporary.replace(path)


if __name__ == "__main__":
    main()
