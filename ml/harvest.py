"""
Harvest layout evidence from the Tjek public API.

Two products come out of this, into .data/raw/ (never data/, which Vite
serves as its static root):

  catalogs.json          every reachable catalog's metadata
  hotspots/<id>.json     offer -> page-rectangle for that catalog
  pdfs/<id>.pdf          a sample of print PDFs

Hotspots are the cheap, complete source: they cover ~96-100% of offers and
need no bulk download. PDFs are the rich source — live vector text with a
font-size hierarchy, and individually placed product images — but they are
large, so only a spread across retailers is fetched by default.

Read-only. Rate-limited deliberately: this runs against production.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

BASE = "https://squid-api.tjek.com/v2"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".data" / "raw"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "incitio-harvest/0.1"

PAUSE = 0.15


def get(path: str, **params):
    response = SESSION.get(f"{BASE}/{path}", params=params or None, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_dealers(limit: int = 1200) -> list[dict]:
    dealers, offset = [], 0
    while offset < limit:
        batch = get("dealers", limit=100, offset=offset)
        if not batch:
            break
        dealers.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break
        time.sleep(PAUSE)
    return dealers


def fetch_catalogs(dealer_ids: list[str]) -> list[dict]:
    catalogs, seen = [], set()
    for i in range(0, len(dealer_ids), 25):
        chunk = dealer_ids[i : i + 25]
        try:
            batch = get("catalogs", dealer_ids=",".join(chunk), limit=100)
        except requests.RequestException as error:
            print(f"  catalogs chunk {i}: {error}", file=sys.stderr)
            continue
        for catalog in batch:
            if catalog["id"] not in seen:
                seen.add(catalog["id"])
                catalogs.append(catalog)
        time.sleep(PAUSE)
    return catalogs


def fetch_hotspots(catalogs: list[dict]) -> int:
    out = RAW / "hotspots"
    out.mkdir(parents=True, exist_ok=True)
    saved = 0
    for index, catalog in enumerate(catalogs, 1):
        target = out / f"{catalog['id']}.json"
        if target.exists():
            saved += 1
            continue
        try:
            hotspots = get(f"catalogs/{catalog['id']}/hotspots")
        except requests.RequestException as error:
            print(f"  hotspots {catalog['id']}: {error}", file=sys.stderr)
            continue
        target.write_text(json.dumps(hotspots))
        saved += 1
        if index % 20 == 0:
            print(f"  hotspots {index}/{len(catalogs)}")
        time.sleep(PAUSE)
    return saved


def pick_pdf_sample(catalogs: list[dict], count: int) -> list[dict]:
    """One catalog per dealer, widest spread first — a template library
    built from six catalogs by the same retailer learns that retailer's
    habits, not what a good page looks like in general."""
    by_dealer: dict[str, dict] = {}
    for catalog in catalogs:
        if not catalog.get("pdf_url"):
            continue
        current = by_dealer.get(catalog["dealer_id"])
        if current is None or (catalog.get("page_count") or 0) > (current.get("page_count") or 0):
            by_dealer[catalog["dealer_id"]] = catalog
    ranked = sorted(by_dealer.values(), key=lambda c: -(c.get("page_count") or 0))
    return ranked[:count]


def fetch_pdfs(catalogs: list[dict]) -> int:
    out = RAW / "pdfs"
    out.mkdir(parents=True, exist_ok=True)
    saved = 0
    for catalog in catalogs:
        target = out / f"{catalog['id']}.pdf"
        if target.exists():
            saved += 1
            continue
        try:
            # The download endpoint hands back a signed S3 URL that expires
            # in 600s, so it has to be resolved immediately before fetching.
            link = get(f"catalogs/{catalog['id']}/download")["pdf_url"]
            response = SESSION.get(link, timeout=180)
            response.raise_for_status()
        except (requests.RequestException, KeyError) as error:
            print(f"  pdf {catalog['id']}: {error}", file=sys.stderr)
            continue
        target.write_bytes(response.content)
        saved += 1
        size_mb = len(response.content) / 1024 / 1024
        print(f"  pdf {catalog['dealer']['name'][:24]:26} "
              f"{catalog['page_count']:3}pp  {size_mb:5.1f}MB")
        time.sleep(PAUSE)
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdfs", type=int, default=10, help="how many PDFs to sample (0 = none)")
    parser.add_argument("--skip-hotspots", action="store_true")
    args = parser.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)

    print("dealers…")
    dealers = fetch_dealers()
    (RAW / "dealers.json").write_text(json.dumps(dealers))
    print(f"  {len(dealers)}")

    print("catalogs…")
    catalogs = fetch_catalogs([d["id"] for d in dealers])
    (RAW / "catalogs.json").write_text(json.dumps(catalogs))
    pdf_capable = [c for c in catalogs if c.get("pdf_url")]
    print(f"  {len(catalogs)} catalogs, {sum(c.get('page_count') or 0 for c in catalogs)} pages, "
          f"{len(pdf_capable)} with a PDF")

    if not args.skip_hotspots:
        print("hotspots…")
        print(f"  saved {fetch_hotspots(catalogs)}")

    if args.pdfs > 0:
        sample = pick_pdf_sample(catalogs, args.pdfs)
        print(f"pdfs… ({len(sample)} catalogs, {len(set(c['dealer_id'] for c in sample))} dealers)")
        print(f"  saved {fetch_pdfs(sample)}")

    print(f"\nwrote {RAW}")


if __name__ == "__main__":
    main()
