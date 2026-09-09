"""
Adapt the tile-quality CNN to generated pages.

The model was trained on tiles cropped from published catalogs: dense,
photographic, edge to edge. Generated tiles are sparser and sit on more
white, so the model has never seen the distribution it is being asked to
judge — and it flags roughly 7% of clean generated tiles as `merged`.

This fine-tunes on a mix of both domains at a low learning rate, and
reports each domain separately before and after. Both numbers matter: an
adaptation that fixes generated pages by forgetting published ones has
traded one blind spot for another.

  ml/.venv/bin/python ml/finetune_generated.py
"""
from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

import numpy as np

import keras

from corruptions import CLASSES, CLASS_WEIGHT
from train_tile_quality_keras import TileSequence

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = ROOT / ".data" / "raw" / "tiles"
GENERATED = ROOT / ".data" / "generated-tiles"
MODEL = ROOT / ".data" / "models" / "tile_quality_keras.keras"
OUT = ROOT / ".data" / "models" / "tile_quality_finetuned.keras"
SIZE = 128


def published_paths() -> list[Path]:
    index = json.loads((PUBLISHED / "index.json").read_text())
    return [PUBLISHED / r["path"] for r in index if (PUBLISHED / r["path"]).exists()]


def generated_split(holdout: float, seed: int) -> tuple[list[Path], list[Path]]:
    """Split generated tiles by PAGE, not by tile.

    Tiles from one generated page share the template, the palette and often
    the product photography, so a per-tile split would let them leak across
    and overstate the gain.
    """
    by_page: dict[str, list[Path]] = defaultdict(list)
    for manifest_path in GENERATED.glob("*/manifest.json"):
        for entry in json.loads(manifest_path.read_text()):
            path = Path(entry["path"])
            if path.exists():
                by_page[f"{manifest_path.parent.name}/{entry['pageId']}"].append(path)

    pages = sorted(by_page)
    rng = random.Random(seed)
    rng.shuffle(pages)
    cut = max(1, int(len(pages) * holdout))
    evaluation = [p for page in pages[:cut] for p in by_page[page]]
    training = [p for page in pages[cut:] for p in by_page[page]]
    return training, evaluation


def confusion_for(model, paths: list[Path], batch: int, seed: int) -> np.ndarray:
    sequence = TileSequence(paths, SIZE, batch, train=False, seed=seed)
    matrix = np.zeros((len(CLASSES), len(CLASSES)), dtype=int)
    for i in range(len(sequence)):
        images, labels = sequence[i]
        predictions = model.predict(images, verbose=0).argmax(1)
        for actual, predicted in zip(labels.argmax(1), predictions):
            matrix[actual, predicted] += 1
    return matrix


def report(name: str, matrix: np.ndarray) -> tuple[float, float]:
    clean_recall = matrix[0, 0] / max(1, matrix[0].sum())
    defect_recall = matrix[1:, 1:].sum() / max(1, matrix[1:].sum())
    overall = matrix.trace() / max(1, matrix.sum())
    print(f"  {name:22} clean {clean_recall:.3f}   defects {defect_recall:.3f}   overall {overall:.3f}")
    return float(clean_recall), float(defect_recall)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--holdout", type=float, default=0.25)
    parser.add_argument("--generated-share", type=float, default=0.35,
                        help="target share of training batches drawn from generated tiles")
    args = parser.parse_args()

    if not MODEL.exists():
        raise SystemExit(f"no base model at {MODEL} — train it first")

    gen_train, gen_eval = generated_split(args.holdout, seed=5)
    if not gen_train:
        raise SystemExit("no generated tiles — run: npm run score -- --capture <name>")

    pub_all = published_paths()
    rng = random.Random(5)
    rng.shuffle(pub_all)
    pub_cut = int(len(pub_all) * args.holdout)
    pub_eval, pub_train = pub_all[:pub_cut], pub_all[pub_cut:]

    print(f"published  train {len(pub_train)}  eval {len(pub_eval)}")
    print(f"generated  train {len(gen_train)}  eval {len(gen_eval)}")

    model = keras.models.load_model(MODEL)

    print("\nbefore fine-tuning")
    before_pub = report("published (held out)", confusion_for(model, pub_eval[:1200], args.batch, 1))
    before_gen = report("generated (held out)", confusion_for(model, gen_eval, args.batch, 2))

    # Oversample the generated tiles so they occupy the target share of
    # training batches. Each repeat gets a different corruption applied on
    # the fly, so this is variation rather than duplication.
    share = min(0.8, max(0.05, args.generated_share))
    wanted = int(len(pub_train) * share / (1 - share))
    repeats = max(1, round(wanted / len(gen_train)))
    mixed = pub_train + gen_train * repeats
    rng.shuffle(mixed)
    print(f"\nmixing     {len(pub_train)} published + {len(gen_train)}x{repeats} generated "
          f"= {len(mixed)} samples/epoch")

    # A low learning rate: this is adaptation, not retraining. A high rate
    # would overwrite what the model knows about published pages.
    model.compile(
        optimizer=keras.optimizers.Adam(1e-4),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        TileSequence(mixed, SIZE, args.batch, train=True, workers=4, max_queue_size=12),
        validation_data=TileSequence(gen_eval, SIZE, args.batch, train=False, seed=2, workers=2),
        epochs=args.epochs,
        class_weight={i: CLASS_WEIGHT[c] for i, c in enumerate(CLASSES)},
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_loss", patience=3,
                                                 restore_best_weights=True)],
        verbose=2,
    )

    print("\nafter fine-tuning")
    after_pub = report("published (held out)", confusion_for(model, pub_eval[:1200], args.batch, 1))
    after_gen = report("generated (held out)", confusion_for(model, gen_eval, args.batch, 2))

    print("\nchange in clean recall (the false-positive rate)")
    print(f"  published   {before_pub[0]:.3f} -> {after_pub[0]:.3f}  ({after_pub[0]-before_pub[0]:+.3f})")
    print(f"  generated   {before_gen[0]:.3f} -> {after_gen[0]:.3f}  ({after_gen[0]-before_gen[0]:+.3f})")

    model.save(OUT)
    print(f"\nsaved -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
