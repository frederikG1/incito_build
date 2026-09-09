"""
Crop real offer tiles out of published page images.

A hotspot gives one offer's rectangle on a page; the page image gives the
pixels. Together they yield tens of thousands of tiles that real designers
laid out and real retailers shipped — the positive class for a tile-level
quality model, and the only source of "this is what a good tile looks
like" that is not my own renderer marking its own homework.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".data" / "raw"
PAGES = RAW / "pages"
OUT = RAW / "tiles"

# Below this share of the page a hotspot is a logo or a footnote.
MIN_AREA = 0.012
# Tiles thinner than this are banners, not offers.
MIN_PIXELS = 90


def rect_of(polygon):
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def square_resize(crop: Image.Image, size: int) -> Image.Image:
    """Letterbox on white rather than stretch. Leaflet tiles sit on paper,
    and stretching would teach the model that distorted aspect ratios are
    normal — which is one of the defects it has to detect."""
    canvas = Image.new("RGB", (max(crop.size),) * 2, (255, 255, 255))
    canvas.paste(crop, ((max(crop.size) - crop.width) // 2,
                        (max(crop.size) - crop.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def crop_coco(coco_dir: Path, size: int, index: list, stats: Counter) -> None:
    """Ingest a COCO-annotated page set.

    Boxes are normalised the same way hotspots are — x in 0..1, y in
    0..pageHeight — so they land in the same corpus. Worth having because
    these cover retailers and expired catalogs the live API no longer
    serves.
    """
    data = json.loads((coco_dir / "annotations_coco.json").read_text())
    images = {img["id"]: img for img in data["images"]}
    by_image: dict[int, list] = {}
    for annotation in data["annotations"]:
        by_image.setdefault(annotation["image_id"], []).append(annotation)

    for image_id, annotations in by_image.items():
        meta = images.get(image_id)
        if not meta:
            continue
        path = coco_dir / "images" / meta["file_name"]
        if not path.exists():
            stats["coco_missing_image"] += 1
            continue
        try:
            page = Image.open(path).convert("RGB")
        except Exception:
            stats["coco_unreadable"] += 1
            continue

        page_height_units = meta.get("height") or 1.0
        retailer = meta.get("retailer", "unknown")
        target_dir = OUT / f"coco-{Path(meta['file_name']).stem}"

        for n, annotation in enumerate(annotations):
            x, y, w, h = annotation["bbox"]
            left, right = x * page.width, (x + w) * page.width
            top = (y / page_height_units) * page.height
            bottom = ((y + h) / page_height_units) * page.height

            area = ((right - left) * (bottom - top)) / (page.width * page.height)
            if area < MIN_AREA:
                stats["too_small_area"] += 1
                continue
            if (right - left) < MIN_PIXELS or (bottom - top) < MIN_PIXELS:
                stats["too_few_pixels"] += 1
                continue

            crop = page.crop((int(left), int(top), int(right), int(bottom)))
            target_dir.mkdir(parents=True, exist_ok=True)
            name = f"{n:02d}.jpg"
            square_resize(crop, size).save(target_dir / name, quality=90)
            index.append({
                "path": f"{target_dir.name}/{name}",
                "dealer": retailer,
                "page": 0,
                "heading": str(annotation.get("product_name", ""))[:60],
                "areaFraction": round(area, 4),
                "aspect": round((right - left) / max(1, (bottom - top)), 3),
                "source": "coco",
            })
            stats["tiles"] += 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=224,
                        help="output edge in px; 224 matches standard pretrained backbones")
    parser.add_argument("--limit", type=int, default=0, help="0 = every catalog")
    parser.add_argument("--coco", type=str, default="danish_catalogs_dataset",
                        help="COCO-annotated page set to fold in; '' to skip")
    args = parser.parse_args()

    catalogs = {c["id"]: c for c in json.loads((RAW / "catalogs.json").read_text())}
    dirs = sorted(d for d in PAGES.iterdir() if d.is_dir())
    if args.limit:
        dirs = dirs[: args.limit]

    OUT.mkdir(parents=True, exist_ok=True)
    stats = Counter()
    index = []

    for catalog_dir in dirs:
        catalog = catalogs.get(catalog_dir.name)
        hotspot_path = RAW / "hotspots" / f"{catalog_dir.name}.json"
        if not catalog or not hotspot_path.exists():
            stats["skipped_no_hotspots"] += 1
            continue

        page_height_units = (catalog.get("dimensions") or {}).get("height") or 1.0
        by_page = {}
        for hotspot in json.loads(hotspot_path.read_text()):
            for page_no, polygon in (hotspot.get("locations") or {}).items():
                by_page.setdefault(int(page_no), []).append(
                    (hotspot.get("heading", ""), rect_of(polygon))
                )

        target_dir = OUT / catalog_dir.name
        for page_no, spots in sorted(by_page.items()):
            image_path = catalog_dir / f"p{page_no:03d}.jpg"
            if not image_path.exists():
                stats["missing_page_image"] += 1
                continue
            try:
                page = Image.open(image_path).convert("RGB")
            except Exception:
                stats["unreadable_page"] += 1
                continue

            for n, (heading, (x0, y0, x1, y1)) in enumerate(spots):
                # Hotspot x is 0..1 of width; y is 0..dimensions.height, so
                # it is rescaled before touching pixels.
                left = x0 * page.width
                right = x1 * page.width
                top = (y0 / page_height_units) * page.height
                bottom = (y1 / page_height_units) * page.height

                area = ((right - left) * (bottom - top)) / (page.width * page.height)
                if area < MIN_AREA:
                    stats["too_small_area"] += 1
                    continue
                if (right - left) < MIN_PIXELS or (bottom - top) < MIN_PIXELS:
                    stats["too_few_pixels"] += 1
                    continue

                crop = page.crop((int(left), int(top), int(right), int(bottom)))
                target_dir.mkdir(parents=True, exist_ok=True)
                name = f"p{page_no:03d}_{n:02d}.jpg"
                square_resize(crop, args.size).save(target_dir / name, quality=90)
                index.append({
                    "path": f"{catalog_dir.name}/{name}",
                    "dealer": catalog["dealer"]["name"],
                    "page": page_no,
                    "heading": heading[:60],
                    "areaFraction": round(area, 4),
                    "aspect": round((right - left) / (bottom - top), 3),
                })
                stats["tiles"] += 1

    if args.coco:
        coco_dir = ROOT / args.coco
        if (coco_dir / "annotations_coco.json").exists():
            before = stats["tiles"]
            crop_coco(coco_dir, args.size, index, stats)
            print(f"folded in {stats['tiles'] - before} tiles from {args.coco}")

    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False))
    print(f"tiles written: {stats['tiles']}")
    for key, value in stats.most_common():
        if key != "tiles":
            print(f"  {key:22} {value}")
    dealers = Counter(r["dealer"] for r in index)
    print(f"dealers: {len(dealers)}  top: {dealers.most_common(5)}")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
