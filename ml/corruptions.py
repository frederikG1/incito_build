"""
The defects the quality model learns to detect.

Each corruption reproduces one failure mode from the calibration sheet, in
image space, on a real published tile. Keeping them in one module means
every trainer sees identical data, so model comparisons are fair.

Weights come from the severity ratings: a dealbreaker costs more to miss
than a nuisance.
"""
from __future__ import annotations

import random

from PIL import Image, ImageDraw, ImageEnhance

CLASSES = ["clean", "occluded", "merged", "flat", "distorted"]

# clean is the reference class at 1.0.
CLASS_WEIGHT = {
    "clean": 1.0,
    "occluded": 3.0,   # T1 + T5 — price over product / over the name
    "merged": 3.0,     # T2 — products merging into one shape
    "flat": 2.0,       # T3 — no depth separation
    "distorted": 2.0,  # P5 — product stretched to fit its slot
}


def occluded(image: Image.Image, rng: random.Random) -> Image.Image:
    """A price splat dropped on top of the product."""
    out = image.copy()
    draw = ImageDraw.Draw(out, "RGBA")
    w, h = out.size
    bw = rng.uniform(0.42, 0.68) * w
    bh = rng.uniform(0.22, 0.36) * h
    x = rng.uniform(0.12, 0.88) * w - bw / 2
    y = rng.uniform(0.25, 0.75) * h - bh / 2
    colour = rng.choice([(200, 16, 46), (255, 210, 0), (20, 20, 20)])
    draw.rectangle([x, y, x + bw, y + bh], fill=(*colour, 255))
    # Digits on the splat. Without them the model can learn to spot "a
    # plain rectangle" rather than "a price covering something".
    for i in range(rng.randint(2, 4)):
        tx = x + bw * 0.12
        ty = y + bh * (0.2 + i * 0.22)
        draw.rectangle([tx, ty, tx + bw * rng.uniform(0.4, 0.75), ty + bh * 0.14],
                       fill=(255, 255, 255, 235))
    return out


def merged(image: Image.Image, other: Image.Image, rng: random.Random) -> Image.Image:
    """A second product pasted over the first with no separation."""
    out = image.copy()
    w, h = out.size
    scale = rng.uniform(0.6, 0.9)
    patch = other.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    out.paste(patch, (int(rng.uniform(0.18, 0.5) * w), int(rng.uniform(0.12, 0.4) * h)))
    return out


def flat(image: Image.Image, rng: random.Random) -> Image.Image:
    """Depth cues removed: shading and local contrast crushed."""
    out = ImageEnhance.Contrast(image).enhance(rng.uniform(0.30, 0.55))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(1.08, 1.22))
    return ImageEnhance.Color(out).enhance(rng.uniform(0.5, 0.8))


def distorted(image: Image.Image, rng: random.Random) -> Image.Image:
    """Product stretched to fill a slot it does not fit.

    Done as a single resample from a narrower (or shorter) source box, NOT
    as downscale-then-upscale. The obvious two-step version adds
    resampling blur, and the model then learns "blurry means distorted" —
    which flags every genuinely good small tile, because those are already
    soft from being upscaled out of a 700px page image. The held-out split
    caught this; training accuracy hid it completely.
    """
    w, h = image.size
    factor = rng.uniform(0.45, 0.68)
    if rng.random() < 0.5:
        span = w * factor
        box = ((w - span) / 2, 0, (w + span) / 2, h)
    else:
        span = h * factor
        box = (0, (h - span) / 2, w, (h + span) / 2)
    return image.resize((w, h), Image.LANCZOS, box=box)


def apply(label: int, image: Image.Image, rng: random.Random, pool) -> Image.Image:
    """Apply the corruption for `label`. `pool` supplies a second tile for
    the merge case."""
    name = CLASSES[label]
    if name == "occluded":
        return occluded(image, rng)
    if name == "merged":
        return merged(image, pool(), rng)
    if name == "flat":
        return flat(image, rng)
    if name == "distorted":
        return distorted(image, rng)
    return image


def split_by_catalog(index: list[dict], holdout: float, seed: int):
    """Hold out whole catalogs.

    A per-tile split leaks badly: neighbouring tiles on one page share
    photography, palette and typography, so the model learns to recognise
    the catalog rather than the defect and the reported accuracy is
    fiction.
    """
    catalogs = sorted({record["path"].split("/")[0] for record in index})
    rng = random.Random(seed)
    rng.shuffle(catalogs)
    cut = max(1, int(len(catalogs) * holdout))
    return set(catalogs[cut:]), set(catalogs[:cut])
