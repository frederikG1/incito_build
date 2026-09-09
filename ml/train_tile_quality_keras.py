"""
Tile-quality CNN — Keras / TensorFlow, architecture written out in full.

A convolutional network trained from scratch on real published catalog
tiles. Four convolutional blocks, each two Conv2D layers with batch
normalisation and a max-pool, then global average pooling into a dense
classifier. Forward pass, categorical cross-entropy, backpropagation via
Adam — no pretrained weights anywhere.

Trained to classify a tile as clean or as exhibiting one of the defects
rated in the calibration sheet, so the layout engine can score its own
output the way a person would.

Splits are by CATALOG. Tiles from one page share photography, palette and
typography; a per-tile split lets those leak into the eval set and reports
an accuracy the model does not have.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image

import keras
from keras import layers

from corruptions import CLASSES, CLASS_WEIGHT, apply as apply_corruption, split_by_catalog

ROOT = Path(__file__).resolve().parent.parent
TILES = ROOT / ".data" / "raw" / "tiles"
OUT = ROOT / ".data" / "models"


def build_model(size: int, classes: int) -> keras.Model:
    """Four conv blocks, doubling width, halving resolution each time.

    Two 3x3 convolutions per block before pooling: stacking small kernels
    gives the same receptive field as one large one with fewer parameters
    and an extra non-linearity. Batch norm after each convolution keeps
    activations well-scaled, which is what makes a from-scratch network of
    this depth trainable on a few thousand images.

    Global average pooling instead of Flatten: it collapses each feature
    map to one number, so the classifier depends on WHETHER a feature is
    present rather than where in the tile it sits. A price splat can land
    anywhere, so position-invariance is exactly what this task needs, and
    it removes the dense layer that would otherwise hold most of the
    parameters and most of the overfitting.
    """
    inputs = keras.Input(shape=(size, size, 3), name="tile")

    # Scale to 0..1 inside the graph, so inference needs no separate step.
    x = layers.Rescaling(1.0 / 255)(inputs)

    for filters in (32, 64, 128, 256):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False)(x)
        x = layers.BatchNormalization()(x)
        x = layers.Activation("relu")(x)

        x = layers.Conv2D(filters, 3, padding="same", use_bias=False)(x)
        x = layers.BatchNormalization()(x)
        x = layers.Activation("relu")(x)

        x = layers.MaxPooling2D(2)(x)

    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.35)(x)
    x = layers.Dense(128, activation="relu")(x)
    x = layers.Dropout(0.25)(x)
    outputs = layers.Dense(classes, activation="softmax", name="defect")(x)

    return keras.Model(inputs, outputs, name="tile_quality_cnn")


class TileSequence(keras.utils.PyDataset):
    """Feeds batches of tiles, corrupting them on the fly.

    Generating damage per epoch rather than once means the network sees a
    fresh price splat in a fresh place every time, which is what stops it
    memorising particular images.
    """

    def __init__(self, paths: list[Path], size: int, batch: int, train: bool, seed: int = 0, **kw):
        super().__init__(**kw)
        self.paths = paths
        self.size = size
        self.batch = batch
        self.train = train
        self.seed = seed

    def __len__(self) -> int:
        return max(1, len(self.paths) // self.batch)

    def _load(self, path: Path) -> Image.Image:
        return Image.open(path).convert("RGB").resize((self.size, self.size), Image.BILINEAR)

    def __getitem__(self, index: int):
        images = np.zeros((self.batch, self.size, self.size, 3), dtype=np.float32)
        labels = np.zeros((self.batch, len(CLASSES)), dtype=np.float32)

        for i in range(self.batch):
            # Eval batches are deterministic so the score is comparable
            # between runs; training batches vary every epoch.
            rng = random.Random(None if self.train else self.seed + index * 1009 + i)
            path = self.paths[(index * self.batch + i) % len(self.paths)]
            image = self._load(path)
            label = rng.randrange(len(CLASSES))
            image = apply_corruption(
                label, image, rng,
                pool=lambda: self._load(self.paths[rng.randrange(len(self.paths))]),
            )
            if self.train and rng.random() < 0.5:
                image = image.transpose(Image.FLIP_LEFT_RIGHT)
            images[i] = np.asarray(image, dtype=np.float32)
            labels[i, label] = 1.0
        return images, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=14)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--size", type=int, default=128)
    parser.add_argument("--holdout", type=float, default=0.2)
    args = parser.parse_args()

    index = json.loads((TILES / "index.json").read_text())
    train_catalogs, eval_catalogs = split_by_catalog(index, args.holdout, seed=11)

    def paths_for(catalogs):
        return [TILES / r["path"] for r in index
                if r["path"].split("/")[0] in catalogs and (TILES / r["path"]).exists()]

    train_paths, eval_paths = paths_for(train_catalogs), paths_for(eval_catalogs)
    print(f"catalogs  train {len(train_catalogs)}  eval {len(eval_catalogs)}")
    print(f"tiles     train {len(train_paths)}  eval {len(eval_paths)}")
    if not train_paths or not eval_paths:
        raise SystemExit("not enough tiles — run crop_tiles.py first")

    model = build_model(args.size, len(CLASSES))
    model.summary()

    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )

    train_seq = TileSequence(train_paths, args.size, args.batch, train=True,
                             workers=4, use_multiprocessing=False, max_queue_size=12)
    eval_seq = TileSequence(eval_paths, args.size, args.batch, train=False,
                            workers=2, use_multiprocessing=False, max_queue_size=8)

    model.fit(
        train_seq,
        validation_data=eval_seq,
        epochs=args.epochs,
        class_weight={i: CLASS_WEIGHT[c] for i, c in enumerate(CLASSES)},
        callbacks=[
            keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.4, patience=2, min_lr=1e-5),
            keras.callbacks.EarlyStopping(monitor="val_loss", patience=4, restore_best_weights=True),
        ],
        verbose=2,
    )

    # Per-class recall on held-out catalogs — the number that matters, and
    # the one overall accuracy hides.
    confusion = np.zeros((len(CLASSES), len(CLASSES)), dtype=int)
    for i in range(len(eval_seq)):
        images, labels = eval_seq[i]
        predictions = model.predict(images, verbose=0).argmax(1)
        for actual, predicted in zip(labels.argmax(1), predictions):
            confusion[actual, predicted] += 1

    print("\nheld-out catalogs — per-class recall")
    for i, name in enumerate(CLASSES):
        n = int(confusion[i].sum())
        print(f"  {name:11} n={n:5}  recall {confusion[i, i] / n if n else 0:.3f}")
    print(f"  {'overall':11}          acc    {confusion.trace() / confusion.sum():.3f}")
    print(f"\n  clean kept clean   {confusion[0, 0] / max(1, confusion[0].sum()):.3f}")
    print(f"  defect detected    {confusion[1:, 1:].sum() / max(1, confusion[1:].sum()):.3f}")

    OUT.mkdir(parents=True, exist_ok=True)
    model.save(OUT / "tile_quality_keras.keras")
    print(f"\nsaved -> {(OUT / 'tile_quality_keras.keras').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
