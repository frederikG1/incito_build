"""
Mine page templates out of harvested hotspot geometry.

Each hotspot is an offer plus the rectangle it occupied on a real page that
a designer actually made. Quantising those rectangles onto a common grid
and clustering the results yields a library of page layouts that are known
to work, because they shipped.

This is the honest version of "learn from catalogs that already look good":
deterministic extraction and clustering, no training, no invented geometry.
Output conforms to the TemplateLibrary schema in packages/schema.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".data" / "raw"
OUT = ROOT / "data" / "templates" / "mined.json"

COLS = 12
ROWS = 12

# A page whose offers cover almost none of it is a cover or an advert
# spread, not a layout worth learning from.
MIN_SLOTS = 3
MIN_COVERAGE = 0.25
# A layout seen once may be a one-off; seen repeatedly it is a house pattern.
MIN_FREQUENCY = 2


def rect_of(polygon: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def quantise(x0, y0, x1, y1, page_height) -> tuple[int, int, int, int] | None:
    """Snap a normalised rectangle onto the COLS x ROWS grid.

    y arrives in page-height units (0..dimensions.height), so it is divided
    back to 0..1 first; forgetting that squashes every mined template by
    the page's aspect ratio.
    """
    gx0 = round(x0 * COLS)
    gx1 = round(x1 * COLS)
    gy0 = round((y0 / page_height) * ROWS)
    gy1 = round((y1 / page_height) * ROWS)

    gx0 = max(0, min(COLS - 1, gx0))
    gy0 = max(0, min(ROWS - 1, gy0))
    gx1 = max(gx0 + 1, min(COLS, gx1))
    gy1 = max(gy0 + 1, min(ROWS, gy1))

    w, h = gx1 - gx0, gy1 - gy0
    if w < 1 or h < 1:
        return None
    return gx0, gy0, w, h


def overlaps(a, b) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def page_signature(rects: list[tuple[int, int, int, int]]):
    """Drop rectangles that collide after snapping, largest kept first.

    Quantisation can push two tight neighbours into the same cell; keeping
    the larger one loses less of the page than discarding both.
    """
    kept: list[tuple[int, int, int, int]] = []
    for rect in sorted(rects, key=lambda r: -(r[2] * r[3])):
        if not any(overlaps(rect, other) for other in kept):
            kept.append(rect)
    return tuple(sorted(kept))


def role_for(area: float, largest: float) -> str:
    if area >= 0.20 and area >= largest * 0.95:
        return "hero"
    if area < 0.07:
        return "filler"
    return "standard"


def build_template(signature, index: int, frequency: int, aspect: float, catalog_id: str) -> dict:
    areas = [(w * h) / (COLS * ROWS) for _, _, w, h in signature]
    largest = max(areas)

    slots = []
    for slot_index, ((x, y, w, h), area) in enumerate(zip(signature, areas)):
        role = role_for(area, largest)
        slots.append({
            "id": f"s{slot_index}",
            "x": x, "y": y, "w": w, "h": h,
            "role": role,
            # The shape the slot was designed around, in page terms.
            "preferredAspect": round((w * ROWS) / (h * COLS) * aspect, 4),
            # Roughly one character per 1.6pt of width at typical leaflet type.
            "textCapacity": max(16, int(w / COLS * 190)),
            "promotesTo": [],
        })

    # A tile may be enlarged into any strictly bigger slot on the same page.
    # Offering the nearest few keeps the editor's "make bigger" predictable.
    for slot in slots:
        own = slot["w"] * slot["h"]
        bigger = sorted(
            (s for s in slots if s["id"] != slot["id"] and s["w"] * s["h"] > own),
            key=lambda s: s["w"] * s["h"],
        )
        slot["promotesTo"] = [s["id"] for s in bigger[:2]]

    return {
        "id": f"mined/{index:03d}",
        "name": f"{len(slots)} slots · seen {frequency}×",
        "grid": {"cols": COLS, "rows": ROWS, "gutter": 0.05},
        "slots": slots,
        "provenance": {"source": "mined", "catalogId": catalog_id, "pageNumber": 0},
    }


def slugify(name: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in name]
    return "".join(keep).strip("-").replace("--", "-")


def house_all(args, catalogs, hotspot_dir) -> None:
    """Mine one template library per retailer.

    A pooled library averages fifty-four chains together, which is right
    for a retailer with no back catalogue and wrong for one with a house
    style — SuperBrugsen does not want Netto's layouts. Retailers below
    the page threshold keep falling back to the pooled set.
    """
    pages_per_dealer: Counter = Counter()
    for path in hotspot_dir.glob("*.json"):
        catalog = catalogs.get(path.stem)
        if not catalog:
            continue
        seen = set()
        for hotspot in json.loads(path.read_text()):
            for page in (hotspot.get("locations") or {}):
                seen.add(int(page))
        pages_per_dealer[catalog["dealer"]["name"]] += len(seen)

    eligible = [n for n, count in pages_per_dealer.items() if count >= args.min_pages]
    out_dir = OUT.parent / "house"
    out_dir.mkdir(parents=True, exist_ok=True)
    index = {}

    print(f"{len(eligible)} retailers have >= {args.min_pages} pages\n")
    for name in sorted(eligible):
        templates = mine(catalogs, hotspot_dir, dealer=name,
                         min_frequency=1, max_templates=args.max_templates)
        if len(templates) < 4:
            print(f"  {name[:28]:30} skipped — only {len(templates)} usable layouts")
            continue
        slug = slugify(name)
        (out_dir / f"{slug}.json").write_text(json.dumps(
            {"version": f"0.1.0-house-{slug}", "templates": templates}, indent=2))
        index[name] = f"house/{slug}.json"
        counts = sorted({len(t["slots"]) for t in templates})
        print(f"  {name[:28]:30} {len(templates):3} templates  slots {counts[0]}-{counts[-1]}")

    (OUT.parent / "house-index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    print(f"\nwrote {len(index)} house libraries -> {out_dir.relative_to(ROOT)}")
    print(f"index -> {(OUT.parent / 'house-index.json').relative_to(ROOT)}")


def mine(catalogs, hotspot_dir, dealer: str, min_frequency: int, max_templates: int) -> list:
    """Core mining pass, shared by the single-library and per-house modes."""
    signatures: Counter = Counter()
    origin: dict = {}
    aspects: dict = defaultdict(list)

    for path in sorted(hotspot_dir.glob("*.json")):
        catalog = catalogs.get(path.stem)
        if not catalog:
            continue
        if dealer and catalog["dealer"]["name"].lower() != dealer.lower():
            continue
        dimensions = catalog.get("dimensions") or {}
        page_height = dimensions.get("height") or 1.0
        aspect = (dimensions.get("width") or 1.0) / page_height

        by_page: dict = defaultdict(list)
        for hotspot in json.loads(path.read_text()):
            for page, polygon in (hotspot.get("locations") or {}).items():
                by_page[page].append(polygon)

        for page, polygons in by_page.items():
            rects = [q for q in (quantise(*rect_of(p), page_height) for p in polygons) if q]
            signature = page_signature(rects)
            if len(signature) < MIN_SLOTS:
                continue
            if sum(w * h for _, _, w, h in signature) / (COLS * ROWS) < MIN_COVERAGE:
                continue
            signatures[signature] += 1
            aspects[signature].append(aspect)
            origin.setdefault(signature, f"{path.stem}#{page}")

    ranked = [s for s in signatures.most_common() if s[1] >= min_frequency][:max_templates]
    return [
        build_template(sig, i, freq, sum(aspects[sig]) / len(aspects[sig]), origin[sig])
        for i, (sig, freq) in enumerate(ranked)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-frequency", type=int, default=MIN_FREQUENCY)
    parser.add_argument("--max-templates", type=int, default=60)
    parser.add_argument("--dealer", type=str, default="",
                        help="mine only this dealer, for a house-style library")
    parser.add_argument("--out", type=str, default="",
                        help="output filename under data/templates/")
    parser.add_argument("--house-all", action="store_true",
                        help="mine one library per retailer with enough pages")
    parser.add_argument("--min-pages", type=int, default=40,
                        help="pages a retailer needs before it gets its own library")
    args = parser.parse_args()

    catalogs = {c["id"]: c for c in json.loads((RAW / "catalogs.json").read_text())}
    hotspot_dir = RAW / "hotspots"

    if args.house_all:
        house_all(args, catalogs, hotspot_dir)
        return

    signatures: Counter = Counter()
    origin: dict = {}
    aspects: dict = defaultdict(list)
    stats = Counter()

    for path in sorted(hotspot_dir.glob("*.json")):
        catalog = catalogs.get(path.stem)
        if not catalog:
            continue
        # A house-style library is mined from one retailer's own pages, so
        # generated layouts carry that retailer's habits rather than the
        # average of fifty-four chains.
        if args.dealer and catalog["dealer"]["name"].lower() != args.dealer.lower():
            continue
        dimensions = catalog.get("dimensions") or {}
        page_height = dimensions.get("height") or 1.0
        aspect = (dimensions.get("width") or 1.0) / page_height

        by_page: dict[str, list] = defaultdict(list)
        for hotspot in json.loads(path.read_text()):
            for page, polygon in (hotspot.get("locations") or {}).items():
                by_page[page].append(polygon)

        for page, polygons in by_page.items():
            stats["pages_seen"] += 1
            rects = []
            for polygon in polygons:
                snapped = quantise(*rect_of(polygon), page_height)
                if snapped:
                    rects.append(snapped)

            signature = page_signature(rects)
            if len(signature) < MIN_SLOTS:
                stats["rejected_too_few"] += 1
                continue
            coverage = sum(w * h for _, _, w, h in signature) / (COLS * ROWS)
            if coverage < MIN_COVERAGE:
                stats["rejected_sparse"] += 1
                continue

            stats["pages_used"] += 1
            signatures[signature] += 1
            aspects[signature].append(aspect)
            origin.setdefault(signature, f"{path.stem}#{page}")

    ranked = [s for s in signatures.most_common() if s[1] >= args.min_frequency]
    ranked = ranked[: args.max_templates]

    templates = [
        build_template(sig, i, freq, sum(aspects[sig]) / len(aspects[sig]), origin[sig])
        for i, (sig, freq) in enumerate(ranked)
    ]

    out_path = OUT if not args.out else OUT.parent / args.out
    version = f"0.1.0-mined-{args.dealer.lower()}" if args.dealer else "0.1.0-mined"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"version": version, "templates": templates}, indent=2))

    print(f"pages seen           {stats['pages_seen']}")
    print(f"  rejected (<{MIN_SLOTS} slots) {stats['rejected_too_few']}")
    print(f"  rejected (sparse)     {stats['rejected_sparse']}")
    print(f"  used                  {stats['pages_used']}")
    print(f"distinct layouts     {len(signatures)}")
    print(f"seen >= {args.min_frequency}x          {len([s for s in signatures.values() if s >= args.min_frequency])}")
    print(f"templates written    {len(templates)} -> {out_path.relative_to(ROOT)}")
    if templates:
        counts = Counter(len(t["slots"]) for t in templates)
        print(f"slot counts          {dict(sorted(counts.items()))}")
        roles = Counter(s["role"] for t in templates for s in t["slots"])
        print(f"roles                {dict(roles)}")


if __name__ == "__main__":
    main()
