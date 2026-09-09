"""
Train a tile-quality CNN on real published tiles.

The positives are real: tens of thousands of offer tiles cropped out of
published pages. The negatives are those same tiles corrupted along the
failure modes rated in the calibration sheet, so the model learns to spot
the specific defects that were judged to matter rather than a vague notion
of ugliness.

What this model is: a detector for concrete tile defects, trained on
controlled corruptions where the ONLY difference is the defect.
What it is not: a model of human taste. Corruption-detection is a proxy.
The complementary head — real published page vs generated page — is what
addresses taste, and it needs the renderer's output at scale.

Splits are by CATALOG, never by tile: two tiles from one page share
photography, palette and typography, so a random split leaks and reports
an accuracy the model does not have.
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageEnhance
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parent.parent
TILES = ROOT / ".data" / "raw" / "tiles"
OUT = ROOT / ".data" / "models"

# Severity from the calibration sheet: dealbreakers cost more to miss.
# clean is the reference class and carries weight 1.
CLASSES = ["clean", "occluded", "merged", "flat", "distorted"]
CLASS_WEIGHT = {
    "clean": 1.0,
    "occluded": 3.0,   # T1 + T5, both rated dealbreaker
    "merged": 3.0,     # T2, dealbreaker
    "flat": 2.0,       # T3, bad
    "distorted": 2.0,  # P5, bad
}

NORMALISE = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])


# ----------------------------------------------------------- corruptions

def corrupt_occluded(image: Image.Image, rng: random.Random) -> Image.Image:
    """A price splat dropped on top of the product, as in the Coop tile."""
    out = image.copy()
    draw = ImageDraw.Draw(out, "RGBA")
    w, h = out.size
    bw = rng.uniform(0.42, 0.68) * w
    bh = rng.uniform(0.22, 0.36) * h
    x = rng.uniform(0.12, 0.88) * w - bw / 2
    y = rng.uniform(0.25, 0.75) * h - bh / 2
    colour = rng.choice([(200, 16, 46), (255, 210, 0), (20, 20, 20)])
    draw.rectangle([x, y, x + bw, y + bh], fill=(*colour, 255))
    # A price is text on the splat; without it the model can learn to spot
    # "a plain rectangle" instead of "a price covering something".
    for i in range(rng.randint(2, 4)):
        tx = x + bw * 0.12
        ty = y + bh * (0.2 + i * 0.22)
        draw.rectangle([tx, ty, tx + bw * rng.uniform(0.4, 0.75), ty + bh * 0.14],
                       fill=(255, 255, 255, 235))
    return out


def corrupt_merged(image: Image.Image, other: Image.Image, rng: random.Random) -> Image.Image:
    """A second product pasted over the first with no separation."""
    out = image.copy()
    w, h = out.size
    scale = rng.uniform(0.6, 0.9)
    patch = other.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # Deliberately overlapping the centre, where the subject lives.
    x = int(rng.uniform(0.18, 0.5) * w)
    y = int(rng.uniform(0.12, 0.4) * h)
    out.paste(patch, (x, y))
    return out


def corrupt_flat(image: Image.Image, rng: random.Random) -> Image.Image:
    """Depth cues removed: shading and local contrast crushed."""
    out = ImageEnhance.Contrast(image).enhance(rng.uniform(0.30, 0.55))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(1.08, 1.22))
    return ImageEnhance.Color(out).enhance(rng.uniform(0.5, 0.8))


def corrupt_distorted(image: Image.Image, rng: random.Random) -> Image.Image:
    """Product stretched to fill a slot it does not fit."""
    w, h = image.size
    if rng.random() < 0.5:
        squashed = image.resize((int(w * rng.uniform(0.45, 0.65)), h), Image.LANCZOS)
    else:
        squashed = image.resize((w, int(h * rng.uniform(0.45, 0.65))), Image.LANCZOS)
    return squashed.resize((w, h), Image.LANCZOS)


# --------------------------------------------------------------- dataset

class TileDataset(Dataset):
    """Corrupts on the fly, so every epoch sees fresh damage."""

    def __init__(self, paths: list[Path], train: bool, seed: int = 0):
        self.paths = paths
        self.train = train
        self.seed = seed
        self.to_tensor = transforms.Compose([transforms.ToTensor(), NORMALISE])

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, index: int):
        # Deterministic for the eval split, varied for training.
        rng = random.Random(self.seed + index * 7919 if not self.train else None)
        image = Image.open(self.paths[index]).convert("RGB")
        label = rng.randrange(len(CLASSES))
        name = CLASSES[label]

        if name == "occluded":
            image = corrupt_occluded(image, rng)
        elif name == "merged":
            other = Image.open(self.paths[rng.randrange(len(self.paths))]).convert("RGB")
            image = corrupt_merged(image, other, rng)
        elif name == "flat":
            image = corrupt_flat(image, rng)
        elif name == "distorted":
            image = corrupt_distorted(image, rng)

        if self.train and rng.random() < 0.5:
            image = image.transpose(Image.FLIP_LEFT_RIGHT)
        return self.to_tensor(image), label


def split_by_catalog(index: list[dict], holdout: float, seed: int):
    """Hold out whole catalogs. A per-tile split leaks: neighbouring tiles
    share photography, palette and type, so the model recognises the
    catalog rather than the defect."""
    catalogs = sorted({record["path"].split("/")[0] for record in index})
    rng = random.Random(seed)
    rng.shuffle(catalogs)
    cut = max(1, int(len(catalogs) * holdout))
    return set(catalogs[cut:]), set(catalogs[:cut])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch", type=int, default=48)
    parser.add_argument("--max-tiles", type=int, default=0, help="0 = all")
    parser.add_argument("--holdout", type=float, default=0.2)
    args = parser.parse_args()

    index = json.loads((TILES / "index.json").read_text())
    train_catalogs, eval_catalogs = split_by_catalog(index, args.holdout, seed=11)

    def paths_for(catalogs):
        out = [TILES / r["path"] for r in index if r["path"].split("/")[0] in catalogs]
        return [p for p in out if p.exists()]

    train_paths = paths_for(train_catalogs)
    eval_paths = paths_for(eval_catalogs)
    if args.max_tiles:
        train_paths = train_paths[: args.max_tiles]
        eval_paths = eval_paths[: args.max_tiles // 4]

    print(f"catalogs  train {len(train_catalogs)}  eval {len(eval_catalogs)}")
    print(f"tiles     train {len(train_paths)}  eval {len(eval_paths)}")
    if not train_paths or not eval_paths:
        raise SystemExit("not enough tiles — run crop_tiles.py first")

    device = ("mps" if torch.backends.mps.is_available()
              else "cuda" if torch.cuda.is_available() else "cpu")
    print(f"device    {device}")

    model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
    model.fc = nn.Linear(model.fc.in_features, len(CLASSES))
    model = model.to(device)

    weights = torch.tensor([CLASS_WEIGHT[c] for c in CLASSES], device=device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)

    train_loader = DataLoader(TileDataset(train_paths, train=True), batch_size=args.batch,
                              shuffle=True, num_workers=4, persistent_workers=True)
    eval_loader = DataLoader(TileDataset(eval_paths, train=False), batch_size=args.batch,
                             shuffle=False, num_workers=4, persistent_workers=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total = correct = 0
        running = 0.0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimiser.zero_grad()
            logits = model(images)
            loss = criterion(logits, labels)
            loss.backward()
            optimiser.step()
            running += loss.item() * labels.size(0)
            correct += (logits.argmax(1) == labels).sum().item()
            total += labels.size(0)
        print(f"epoch {epoch}  loss {running/total:.4f}  train acc {correct/total:.3f}")

    model.eval()
    confusion = torch.zeros(len(CLASSES), len(CLASSES), dtype=torch.int32)
    with torch.no_grad():
        for images, labels in eval_loader:
            predictions = model(images.to(device)).argmax(1).cpu()
            for actual, predicted in zip(labels, predictions):
                confusion[actual, predicted] += 1

    print("\nheld-out catalogs — per-class recall")
    for i, name in enumerate(CLASSES):
        n = int(confusion[i].sum())
        recall = float(confusion[i, i]) / n if n else 0.0
        print(f"  {name:11} n={n:5}  recall {recall:.3f}")
    overall = float(confusion.diag().sum()) / float(confusion.sum())
    print(f"  {'overall':11}          acc    {overall:.3f}")

    # "Is this tile damaged at all" — the number the layout scorer needs.
    clean_correct = int(confusion[0, 0])
    clean_total = int(confusion[0].sum())
    bad_caught = int(confusion[1:, 1:].sum())
    bad_total = int(confusion[1:].sum())
    print(f"\n  clean kept clean   {clean_correct/max(1,clean_total):.3f}")
    print(f"  defect detected    {bad_caught/max(1,bad_total):.3f}")

    OUT.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "classes": CLASSES}, OUT / "tile_quality.pt")
    print(f"\nsaved -> {(OUT / 'tile_quality.pt').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
