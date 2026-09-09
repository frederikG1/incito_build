"""
Download published page images — the positives for the quality model.

Every one of these is a page a designer made and a retailer shipped, so
they are the ground truth for "good". Paired with the hotspot rectangles
already on disk, they also yield real tile crops (see crop_tiles.py).

Read-only, rate-limited, resumable: existing files are skipped.
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
OUT = RAW / "pages"

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "incitio-harvest/0.1"
PAUSE = 0.08


def page_urls(catalog_id: str) -> list[dict]:
    response = SESSION.get(f"{BASE}/catalogs/{catalog_id}/pages", timeout=30)
    response.raise_for_status()
    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", choices=["thumb", "view", "zoom"], default="view",
                        help="view=700px is enough for a CNN and a tenth the bytes of zoom")
    parser.add_argument("--max-catalogs", type=int, default=0, help="0 = all")
    args = parser.parse_args()

    catalogs = json.loads((RAW / "catalogs.json").read_text())
    if args.max_catalogs:
        catalogs = catalogs[: args.max_catalogs]

    OUT.mkdir(parents=True, exist_ok=True)
    downloaded = skipped = failed = 0
    total_bytes = 0

    for index, catalog in enumerate(catalogs, 1):
        catalog_dir = OUT / catalog["id"]
        try:
            pages = page_urls(catalog["id"])
        except requests.RequestException as error:
            print(f"  {catalog['id']}: {error}", file=sys.stderr)
            failed += 1
            continue

        catalog_dir.mkdir(exist_ok=True)
        # Page geometry lives alongside the images so the cropper never has
        # to re-query the API to know a page's aspect ratio.
        (catalog_dir / "_meta.json").write_text(json.dumps({
            "catalogId": catalog["id"],
            "dealer": catalog["dealer"]["name"],
            "pageCount": catalog.get("page_count"),
            "dimensions": catalog.get("dimensions"),
        }))

        for number, page in enumerate(pages, 1):
            url = page.get(args.size)
            if not url:
                continue
            target = catalog_dir / f"p{number:03d}.jpg"
            if target.exists():
                skipped += 1
                continue
            try:
                response = SESSION.get(url, timeout=60)
                response.raise_for_status()
            except requests.RequestException:
                failed += 1
                continue
            target.write_bytes(response.content)
            total_bytes += len(response.content)
            downloaded += 1
            time.sleep(PAUSE)

        if index % 10 == 0:
            print(f"  {index}/{len(catalogs)} catalogs · "
                  f"{downloaded} new · {skipped} cached · {total_bytes/1e6:.0f}MB")

    print(f"\ndownloaded {downloaded}, cached {skipped}, failed {failed}, "
          f"{total_bytes/1e6:.0f}MB -> {OUT}")


if __name__ == "__main__":
    main()
