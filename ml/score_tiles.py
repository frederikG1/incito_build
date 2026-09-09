"""
Score rendered tiles with the trained quality CNN.

Reads a manifest of tile crops, runs the model, and writes a verdict per
tile plus a per-page roll-up. This is the half of the loop that lets the
generator be judged by what the model learned from 17,588 real published
tiles, rather than by its own scoring weights.

  ml/.venv/bin/python ml/score_tiles.py <manifest.json> <out.json>

The manifest is written by scripts/score-catalog.ts and looks like:
  [{ "path": "...jpg", "pageId": "page-3", "slotId": "hero", "offerId": "..." }]
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

import keras

from corruptions import CLASSES

ROOT = Path(__file__).resolve().parent.parent
BASE_MODEL = ROOT / ".data" / "models" / "tile_quality_keras.keras"
FINETUNED = ROOT / ".data" / "models" / "tile_quality_finetuned.keras"
# Prefer the domain-adapted model: it has seen generated pages, which is
# what this script is pointed at.
MODEL = FINETUNED if FINETUNED.exists() else BASE_MODEL
SIZE = 128


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    manifest_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    if not MODEL.exists():
        raise SystemExit(f"no trained model at {MODEL} — run ml/train_tile_quality_keras.py")
    print(f"model: {MODEL.name}")

    entries = json.loads(manifest_path.read_text())
    if not entries:
        out_path.write_text(json.dumps({"tiles": [], "pages": []}))
        return

    model = keras.models.load_model(MODEL)

    batch = np.zeros((len(entries), SIZE, SIZE, 3), dtype=np.float32)
    for i, entry in enumerate(entries):
        image = Image.open(entry["path"]).convert("RGB")
        # Letterbox on white, exactly as crop_tiles.py does for training.
        # Scoring a stretched tile against a model trained on letterboxed
        # ones would flag distortion that the layout does not contain.
        canvas = Image.new("RGB", (max(image.size),) * 2, (255, 255, 255))
        canvas.paste(image, ((max(image.size) - image.width) // 2,
                             (max(image.size) - image.height) // 2))
        batch[i] = np.asarray(canvas.resize((SIZE, SIZE), Image.BILINEAR), dtype=np.float32)

    probabilities = model.predict(batch, verbose=0)

    tiles = []
    by_page: dict[str, list] = defaultdict(list)
    for entry, row in zip(entries, probabilities):
        index = int(row.argmax())
        verdict = {
            "pageId": entry["pageId"],
            "slotId": entry["slotId"],
            "offerId": entry.get("offerId", ""),
            "label": CLASSES[index],
            "confidence": round(float(row[index]), 4),
            # The number the layout engine wants: how clean is this tile.
            "cleanScore": round(float(row[CLASSES.index("clean")]), 4),
        }
        tiles.append(verdict)
        by_page[entry["pageId"]].append(verdict)

    pages = []
    for page_id, page_tiles in by_page.items():
        scores = [t["cleanScore"] for t in page_tiles]
        flagged = [t for t in page_tiles if t["label"] != "clean"]
        pages.append({
            "pageId": page_id,
            "tiles": len(page_tiles),
            # Mean, not min: one weak tile should lower a page, not condemn it.
            "meanCleanScore": round(sum(scores) / len(scores), 4),
            "worstCleanScore": round(min(scores), 4),
            "flagged": [{"slotId": t["slotId"], "label": t["label"]} for t in flagged],
        })
    pages.sort(key=lambda p: p["meanCleanScore"])

    out_path.write_text(json.dumps({"tiles": tiles, "pages": pages}, indent=2))

    clean = sum(1 for t in tiles if t["label"] == "clean")
    print(f"scored {len(tiles)} tiles across {len(pages)} pages")
    print(f"  clean            {clean}/{len(tiles)} ({clean/len(tiles):.0%})")
    counts: dict[str, int] = defaultdict(int)
    for t in tiles:
        if t["label"] != "clean":
            counts[t["label"]] += 1
    for label, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {label:16} {n}")
    print("\nweakest pages")
    for page in pages[:5]:
        flags = ", ".join(f"{f['slotId']}:{f['label']}" for f in page["flagged"]) or "—"
        print(f"  {page['pageId']:10} mean {page['meanCleanScore']:.3f}  {flags}")
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
