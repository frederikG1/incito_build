"""
Mine tile interiors from print PDFs.

`mine_templates.py` learns the page grid from hotspot rectangles — where
each offer sits. This learns what happens INSIDE one of those rectangles,
which hotspots cannot describe at all: where the price sits relative to
the product, how much bigger the price is than the name, how much of the
tile the artwork occupies, and whether the two are allowed to overlap.

The two sources are combined rather than used separately: a hotspot gives
the outer box, the PDF gives the contents of that box. Neither alone is
enough.

Outputs
  data/templates/tile-composition.json   aggregate + per-tile records
  .data/raw/products/<catalog>/*.jpg     extracted product photography
"""
from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".data" / "raw"
OUT = ROOT / "data" / "templates" / "tile-composition.json"

# A tile smaller than this is a logo or a footnote, not an offer.
MIN_TILE_FRACTION = 0.01
# Text under this size is legal small print, never a price or a name.
MIN_TEXT_PT = 5.0


def rect_of(polygon):
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def overlap_area(a, b) -> float:
    """Intersection area of two (x0, y0, x1, y1) boxes."""
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0)


def words_by_size(crop):
    """Group a tile's words into font-size bands, largest first.

    Font size is the only reliable role signal in a print PDF — nothing
    in the file says "this is the price". Retail typography makes that
    workable: the price is set enormously larger than everything else,
    which is exactly the hierarchy the flat-type failure mode destroys.
    """
    bands = defaultdict(list)
    for word in crop.extract_words(extra_attrs=["size"]):
        size = round(float(word.get("size", 0)), 1)
        if size < MIN_TEXT_PT:
            continue
        bands[size].append(word)
    return sorted(bands.items(), key=lambda kv: -kv[0])


def is_numeric_band(words) -> bool:
    """True when a font-size band is price-like rather than name-like.

    The second-largest band in a leaflet tile is almost never the product
    name — it is the ore part of the same price, set smaller than the
    kroner. Comparing those two produces a price/name ratio near 1.4 that
    describes nothing. Splitting bands into numeric and textual first is
    what makes the ratio mean what it claims to.
    """
    text = "".join(w["text"] for w in words)
    if not text:
        return False
    digits = sum(1 for c in text if c.isdigit())
    symbols = sum(1 for c in text if c in ",.-–—/ kr")
    return (digits + symbols) / len(text) >= 0.75 and digits > 0


def band_box(words):
    return (
        min(w["x0"] for w in words),
        min(w["top"] for w in words),
        max(w["x1"] for w in words),
        max(w["bottom"] for w in words),
    )


def analyse_tile(page, box, extract_dir=None, counter=None):
    """Measure one offer's interior. Returns None if the tile is unusable."""
    x0, top, x1, bottom = box
    width = x1 - x0
    height = bottom - top
    if width <= 2 or height <= 2:
        return None

    crop = page.crop((max(0, x0), max(0, top), min(page.width, x1), min(page.height, bottom)))

    bands = words_by_size(crop)
    if not bands:
        return None

    def norm(b):
        return {
            "x": round((b[0] - x0) / width, 4),
            "y": round((b[1] - top) / height, 4),
            "w": round((b[2] - b[0]) / width, 4),
            "h": round((b[3] - b[1]) / height, 4),
        }

    numeric = [(size, words) for size, words in bands if is_numeric_band(words)]
    textual = [(size, words) for size, words in bands if not is_numeric_band(words)]
    if not numeric:
        return None

    price_size, price_words = numeric[0]
    price_box = band_box(price_words)
    record = {
        "tileAspect": round(width / height, 4),
        "priceSizePt": price_size,
        # Price size as a fraction of tile width: the scale-invariant way
        # to compare a hero on A4 with a filler on a tabloid page.
        "priceSizeRatio": round(price_size / width, 5),
        "priceBox": norm(price_box),
        "priceText": " ".join(w["text"] for w in price_words)[:40],
        "bandCount": len(bands),
    }

    if textual:
        name_size, name_words = textual[0]
        record["nameSizePt"] = name_size
        # The number the flat-type failure mode collapses to 1.0.
        record["priceToNameRatio"] = round(price_size / name_size, 3)
        record["nameBox"] = norm(band_box(name_words))
        record["nameText"] = " ".join(w["text"] for w in name_words)[:60]

    tile_area = width * height
    all_images = [
        im for im in crop.images
        if (im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) > 0.01 * tile_area
    ]
    # An image covering most of the tile is a background, not merchandise.
    # Counting it as product artwork makes every tile look like it prints
    # its price on top of the product, which is the opposite of the truth.
    images = [
        im for im in all_images
        if (im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) < 0.70 * tile_area
    ]
    record["backgroundImages"] = len(all_images) - len(images)
    record["imageCount"] = len(images)
    if images:
        art_area = sum((im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) for im in images)
        record["imageAreaFraction"] = round(min(1.0, art_area / (width * height)), 4)
        record["imageBoxes"] = [
            norm((im["x0"], im["top"], im["x1"], im["bottom"])) for im in images[:6]
        ]

        # Does the price sit on top of the artwork? This is the failure
        # mode rated a dealbreaker, measured against real published pages.
        price_area = (price_box[2] - price_box[0]) * (price_box[3] - price_box[1])
        covered = sum(
            overlap_area(price_box, (im["x0"], im["top"], im["x1"], im["bottom"]))
            for im in images
        )
        record["priceOverImageFraction"] = round(covered / price_area, 4) if price_area else 0.0

        if extract_dir is not None:
            record["extracted"] = extract_images(images, extract_dir, counter)
    else:
        record["imageAreaFraction"] = 0.0
        record["priceOverImageFraction"] = 0.0

    return record


def extract_images(images, out_dir: Path, counter: Counter) -> int:
    """Write embedded JPEGs out as files.

    Only DCTDecode streams are written: those are already JPEG bytes and
    need no decoding. Other filters would need a full image pipeline, and
    the JPEGs are where the product photography lives anyway.
    """
    written = 0
    out_dir.mkdir(parents=True, exist_ok=True)
    for image in images:
        stream = image.get("stream")
        if stream is None:
            continue
        filters = stream.get_filters() if hasattr(stream, "get_filters") else []
        names = [str(f[0]) for f in filters] if filters else []
        if not any("DCT" in n for n in names):
            counter["skipped_non_jpeg"] += 1
            continue
        try:
            data = stream.rawdata
        except Exception:
            counter["skipped_unreadable"] += 1
            continue
        if not data:
            continue
        counter["written"] += 1
        (out_dir / f"{counter['written']:05d}.jpg").write_bytes(data)
        written += 1
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract-images", action="store_true",
                        help="also write embedded product JPEGs to .data/raw/products/")
    parser.add_argument("--max-pdfs", type=int, default=0, help="0 = all downloaded")
    args = parser.parse_args()

    catalogs = {c["id"]: c for c in json.loads((RAW / "catalogs.json").read_text())}
    pdfs = sorted((RAW / "pdfs").glob("*.pdf"))
    if args.max_pdfs:
        pdfs = pdfs[: args.max_pdfs]
    if not pdfs:
        raise SystemExit("no PDFs in .data/raw/pdfs — run harvest.py --pdfs N first")

    records = []
    stats = Counter()
    image_counter = Counter()

    for path in pdfs:
        catalog = catalogs.get(path.stem)
        hotspot_path = RAW / "hotspots" / f"{path.stem}.json"
        if not catalog or not hotspot_path.exists():
            stats["skipped_no_hotspots"] += 1
            continue

        page_height_units = (catalog.get("dimensions") or {}).get("height") or 1.0
        by_page = defaultdict(list)
        for hotspot in json.loads(hotspot_path.read_text()):
            for page_no, polygon in (hotspot.get("locations") or {}).items():
                by_page[int(page_no)].append((hotspot.get("heading", ""), rect_of(polygon)))

        extract_dir = RAW / "products" / path.stem if args.extract_images else None
        name = catalog["dealer"]["name"]

        with pdfplumber.open(path) as pdf:
            for page_no, spots in sorted(by_page.items()):
                if page_no < 1 or page_no > len(pdf.pages):
                    stats["page_out_of_range"] += 1
                    continue
                page = pdf.pages[page_no - 1]

                for heading, (hx0, hy0, hx1, hy1) in spots:
                    # Hotspot x is 0..1 of page width; y is 0..pageHeight
                    # in the catalog's own units, so it is rescaled here.
                    box = (
                        hx0 * page.width,
                        (hy0 / page_height_units) * page.height,
                        hx1 * page.width,
                        (hy1 / page_height_units) * page.height,
                    )
                    area = ((box[2] - box[0]) * (box[3] - box[1])) / (page.width * page.height)
                    if area < MIN_TILE_FRACTION:
                        stats["tile_too_small"] += 1
                        continue

                    record = analyse_tile(page, box, extract_dir, image_counter)
                    if record is None:
                        stats["tile_no_text"] += 1
                        continue
                    record["catalogId"] = path.stem
                    record["dealer"] = name
                    record["page"] = page_no
                    record["heading"] = heading[:40]
                    record["tileAreaFraction"] = round(area, 4)
                    records.append(record)
                    stats["tiles_analysed"] += 1

        print(f"  {name[:24]:26} {stats['tiles_analysed']:5} tiles so far")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": "0.1.0", "aggregate": summarise(records),
                               "tiles": records}, indent=2, ensure_ascii=False))

    print("\n--- extraction ---")
    for key, value in stats.most_common():
        print(f"  {key:24} {value}")
    if args.extract_images:
        print(f"  product jpegs written    {image_counter['written']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({len(records)} tiles)")
    report(summarise(records))


def summarise(records) -> dict:
    def med(key):
        values = [r[key] for r in records if isinstance(r.get(key), (int, float))]
        return round(statistics.median(values), 4) if values else None

    def pct(key, threshold):
        values = [r[key] for r in records if isinstance(r.get(key), (int, float))]
        if not values:
            return None
        return round(sum(1 for v in values if v > threshold) / len(values), 4)

    ratios = [r["priceToNameRatio"] for r in records if "priceToNameRatio" in r]
    return {
        "tiles": len(records),
        "medianPriceToNameRatio": round(statistics.median(ratios), 3) if ratios else None,
        "priceToNameQuartiles": (
            [round(q, 2) for q in statistics.quantiles(ratios, n=4)] if len(ratios) > 3 else None
        ),
        "medianImageAreaFraction": med("imageAreaFraction"),
        "medianPriceSizeRatio": med("priceSizeRatio"),
        "shareWithPriceOverImage": pct("priceOverImageFraction", 0.10),
        "medianImagesPerTile": med("imageCount"),
    }


def report(agg: dict) -> None:
    print("\n--- what real pages do ---")
    print(f"  price / name size ratio (median)  {agg['medianPriceToNameRatio']}")
    if agg["priceToNameQuartiles"]:
        print(f"    quartiles                       {agg['priceToNameQuartiles']}")
    print(f"  artwork share of tile (median)    {agg['medianImageAreaFraction']}")
    print(f"  price size / tile width (median)  {agg['medianPriceSizeRatio']}")
    print(f"  images per tile (median)          {agg['medianImagesPerTile']}")
    print(f"  tiles with price over artwork     {agg['shareWithPriceOverImage']}")


if __name__ == "__main__":
    main()
