import type { CSSProperties, ReactElement } from 'react';
import { tidyAdjust, type CurvePoint, type ImageAdjust, type ImageCrop, type ImageMask } from '@incitio/schema';

/*
 * A photograph developed by numbers — see `ImageAdjust`.
 *
 * Everything tonal folds into ONE lookup table per channel, drawn as an
 * SVG `feComponentTransfer type="table"` with 256 entries: Chromium
 * interpolates between neighbouring entries, and with exactly 256 of them
 * every 8-bit input lands on its own entry, so the table IS the mapping.
 * Colour is one `feColorMatrix`; sharpen and edges are `feConvolveMatrix`.
 * The same arithmetic runs in JavaScript (`develop`) for the studio's
 * histogram and for the test that holds the two to each other.
 *
 * Nothing is rasterised here and no pixel leaves the browser: the print
 * PDF is Chromium drawing the same filter from the same numbers.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * A monotone cubic through the points (Fritsch–Carlson), so a curve
 * never overshoots between two points the way a plain spline does —
 * the overshoot is what makes a hand-drawn curve posterise.
 */
export function curveFunction(points: readonly CurvePoint[]): (x: number) => number {
  const sorted = [...points].sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || p[0] > all[i - 1]![0]);
  const n = sorted.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => sorted[0]![1];
  const xs = sorted.map((p) => p[0]);
  const ys = sorted.map((p) => p[1]);
  const d = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!));
  const m = xs.map((_, i) => (i === 0 ? d[0]! : i === n - 1 ? d[n - 2]! : d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]!
      + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

export type Channel = 'r' | 'g' | 'b';

/**
 * Exposure, brightness, contrast, levels and curves for one channel, as
 * 256 outputs 0–1 — the order a darkroom works in: light first, then
 * the spread, then the hand-set black and white points, then the curve.
 */
export function toneTable(adjust: ImageAdjust, channel: Channel): number[] {
  const { exposure = 0, brightness = 0, contrast = 0, levels, curves } = adjust;
  const rgb = curves?.rgb ? curveFunction(curves.rgb) : null;
  const own = curves?.[channel] ? curveFunction(curves[channel]!) : null;
  const gamma = 2 ** (-brightness * 1.3);
  // Below zero a straight squeeze to grey; above, steeper towards a hard S.
  const k = contrast >= 0 ? 1 / (1 - contrast * 0.95) : 1 + contrast;
  return Array.from({ length: 256 }, (_, i) => {
    let v = i / 255;
    if (exposure) v = toSrgb(Math.min(1, toLinear(v) * 2 ** exposure));
    if (brightness) v = v ** gamma;
    if (contrast) v = clamp01(0.5 + (v - 0.5) * k);
    if (levels) {
      const span = Math.max(1e-3, levels.white - levels.black);
      v = clamp01((v - levels.black) / span) ** (1 / levels.gamma);
      v = levels.outBlack + v * (levels.outWhite - levels.outBlack);
    }
    if (rgb) v = clamp01(rgb(v));
    if (own) v = clamp01(own(v));
    return v;
  });
}

/** The 4×5 colour matrix for hue and saturation, as `feColorMatrix` reads it. */
export function colourMatrix(adjust: ImageAdjust): number[] | null {
  const hue = adjust.hue ?? 0;
  const s = 1 + (adjust.saturation ?? 0);
  if (!hue && s === 1) return null;
  // The two matrices of the Filter Effects spec, `saturate` then `hueRotate`, multiplied out.
  const sat = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const a = (hue * Math.PI) / 180;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const rot = [
    0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
    0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283,
    0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072,
  ];
  const m = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    return rot[row * 3]! * sat[col]! + rot[row * 3 + 1]! * sat[3 + col]! + rot[row * 3 + 2]! * sat[6 + col]!;
  });
  return [m[0]!, m[1]!, m[2]!, 0, 0, m[3]!, m[4]!, m[5]!, 0, 0, m[6]!, m[7]!, m[8]!, 0, 0, 0, 0, 0, 1, 0];
}

/** Lightness as `feFuncX type="linear"`: towards white or black, after the colour. */
function lightnessLine(l: number): { slope: number; intercept: number } {
  return l >= 0 ? { slope: 1 - l, intercept: l } : { slope: 1 + l, intercept: 0 };
}

/** 3×3 unsharp kernel: the pixel pushed away from its four neighbours. */
export function sharpenKernel(amount: number): number[] {
  return [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];
}
/** Laplacian — zero on flat ground, bright on an edge. Inverted afterwards to read as ink. */
export const EDGE_KERNEL = [-1, -1, -1, -1, 8, -1, -1, -1, -1];

const tonal = (a: ImageAdjust) => Boolean(a.exposure || a.brightness || a.contrast || a.levels || a.curves);

/** A short stable name for a set of numbers — equal adjustments share one filter. */
function hashOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

/** The SVG filter for everything per-pixel, or `null` when there is nothing to do. */
function pixelFilter(adjust: ImageAdjust, id: string): ReactElement | null {
  const matrix = colourMatrix(adjust);
  const steps: ReactElement[] = [];
  if (tonal(adjust)) {
    const r = toneTable(adjust, 'r');
    const g = adjust.curves?.g || adjust.curves?.r || adjust.curves?.b ? toneTable(adjust, 'g') : r;
    const b = adjust.curves?.b || adjust.curves?.r || adjust.curves?.g ? toneTable(adjust, 'b') : r;
    steps.push(
      <feComponentTransfer key="tone">
        <feFuncR type="table" tableValues={r.map(fmt).join(' ')} />
        <feFuncG type="table" tableValues={g.map(fmt).join(' ')} />
        <feFuncB type="table" tableValues={b.map(fmt).join(' ')} />
      </feComponentTransfer>,
    );
  }
  if (matrix) steps.push(<feColorMatrix key="colour" type="matrix" values={matrix.map(fmt).join(' ')} />);
  if (adjust.lightness) {
    const { slope, intercept } = lightnessLine(adjust.lightness);
    steps.push(
      <feComponentTransfer key="light">
        <feFuncR type="linear" slope={fmt(slope)} intercept={fmt(intercept)} />
        <feFuncG type="linear" slope={fmt(slope)} intercept={fmt(intercept)} />
        <feFuncB type="linear" slope={fmt(slope)} intercept={fmt(intercept)} />
      </feComponentTransfer>,
    );
  }
  if (adjust.sharpen) {
    steps.push(<feConvolveMatrix key="sharp" order="3" kernelMatrix={sharpenKernel(adjust.sharpen).map(fmt).join(' ')} divisor="1" preserveAlpha="true" edgeMode="duplicate" />);
  }
  if (adjust.edges) {
    steps.push(
      <feConvolveMatrix key="edges" order="3" kernelMatrix={EDGE_KERNEL.join(' ')} divisor="1" preserveAlpha="true" edgeMode="duplicate" />,
      <feComponentTransfer key="ink">
        <feFuncR type="table" tableValues="1 0" />
        <feFuncG type="table" tableValues="1 0" />
        <feFuncB type="table" tableValues="1 0" />
      </feComponentTransfer>,
    );
  }
  if (!steps.length) return null;
  // sRGB, not the spec's default linearRGB: the tables are written for the numbers in the file.
  return <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">{steps}</filter>;
}

/**
 * The photograph's outline as a mask picture, in its own proportions.
 *
 * The SVG is sized `w`×`h` (or the crop of it), so `mask-size: contain`
 * puts it exactly where `object-fit: contain` puts the photograph. An
 * inverted mask is the same outline inside a bigger rectangle, filled
 * even-odd — the alpha stays the mask, which is what a CSS mask reads.
 */
export function maskImage(mask: ImageMask, crop?: ImageCrop): string {
  const vb = crop
    ? [crop.x * mask.w, crop.y * mask.h, crop.w * mask.w, crop.h * mask.h]
    : [0, 0, mask.w, mask.h];
  const blur = mask.feather * Math.max(mask.w, mask.h);
  const pad = blur * 3 + 2;
  const outer = `M${-pad} ${-pad}H${mask.w + pad}V${mask.h + pad}H${-pad}Z`;
  const d = mask.invert ? `${outer}${mask.path}` : mask.path;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(vb[2]!)}" height="${fmt(vb[3]!)}" viewBox="${vb.map(fmt).join(' ')}" preserveAspectRatio="none">${
    blur > 0
      ? `<filter id="f" filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${mask.w + 2 * pad}" height="${mask.h + 2 * pad}"><feGaussianBlur stdDeviation="${fmt(blur)}"/></filter>`
      : ''
  }<path d="${d}" fill="#fff" fill-rule="evenodd"${blur > 0 ? ' filter="url(#f)"' : ''}/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** `object-view-box` for a crop: what is left is laid out as if it were the whole photograph. */
export function cropBox(crop: ImageCrop): string {
  const pct = (v: number) => `${fmt(v * 100)}%`;
  return `inset(${pct(crop.y)} ${pct(1 - crop.x - crop.w)} ${pct(1 - crop.y - crop.h)} ${pct(crop.x)})`;
}

export interface Adjustment {
  /** Spread onto the element. */
  style: CSSProperties;
  /** Attributes the stylesheet reads — `data-adjust-mask` sizes the mask like the photograph. */
  attrs: Record<string, string>;
  /** The shear, for the caller to add to the transform it already writes. */
  skew: string;
  /** The filters, to render once next to the element. */
  defs: ReactElement | null;
}

const NONE: Adjustment = { style: {}, attrs: {}, skew: '', defs: null };

/**
 * Everything the renderer needs to draw one developed photograph.
 *
 * Pure in its input — equal adjustments give equal ids — so a page
 * renders the same on screen, in a screenshot and in the PDF.
 */
export function adjustment(raw: ImageAdjust | undefined): Adjustment {
  const adjust = tidyAdjust(raw);
  if (!adjust) return NONE;
  const id = `adj-${hashOf(adjust)}`;
  const pixels = pixelFilter(adjust, id);
  const blur = adjust.blur
    ? (
      <filter id={`${id}-blur`} primitiveUnits="objectBoundingBox" x="-0.2" y="-0.2" width="1.4" height="1.4">
        <feGaussianBlur stdDeviation={fmt(adjust.blur)} />
      </filter>
    )
    : null;
  const filters = [pixels && `url(#${id})`, blur && `url(#${id}-blur)`].filter(Boolean).join(' ');
  const style: Record<string, string> = {};
  if (filters) style.filter = filters;
  if (adjust.blend) style.mixBlendMode = adjust.blend;
  if (adjust.crop) style.objectViewBox = cropBox(adjust.crop);
  if (adjust.mask) {
    const image = maskImage(adjust.mask, adjust.crop);
    style.maskImage = image;
    style.WebkitMaskImage = image;
  }
  const skew = adjust.skewX || adjust.skewY ? `skew(${adjust.skewX ?? 0}deg, ${adjust.skewY ?? 0}deg)` : '';
  return {
    style: style as CSSProperties,
    attrs: adjust.mask ? { 'data-adjust-mask': '' } : {},
    skew,
    defs: pixels || blur
      ? (
        <svg className="adjust-defs" aria-hidden="true" focusable="false" width="0" height="0">
          {pixels}{blur}
        </svg>
      )
      : null,
  };
}

/*
 * The same development in JavaScript — the histogram's "after", and the
 * reference the browser's filter is tested against. Blur, crop, mask and
 * blend are layout, not pixel arithmetic, and are left to the browser.
 */

/** RGBA in, RGBA out (a new array), as `pixelFilter` draws it. */
export function develop(rgba: Uint8ClampedArray, width: number, height: number, raw: ImageAdjust | undefined): Uint8ClampedArray {
  const adjust = tidyAdjust(raw) ?? {};
  const out = new Uint8ClampedArray(rgba);
  if (tonal(adjust)) {
    const tables = (['r', 'g', 'b'] as const).map((c) => toneTable(adjust, c).map((v) => v * 255));
    for (let i = 0; i < out.length; i += 4) {
      out[i] = tables[0]![out[i]!]!;
      out[i + 1] = tables[1]![out[i + 1]!]!;
      out[i + 2] = tables[2]![out[i + 2]!]!;
    }
  }
  const m = colourMatrix(adjust);
  const light = adjust.lightness ? lightnessLine(adjust.lightness) : null;
  if (m || light) {
    for (let i = 0; i < out.length; i += 4) {
      let r = out[i]! / 255;
      let g = out[i + 1]! / 255;
      let b = out[i + 2]! / 255;
      if (m) {
        [r, g, b] = [m[0]! * r + m[1]! * g + m[2]! * b, m[5]! * r + m[6]! * g + m[7]! * b, m[10]! * r + m[11]! * g + m[12]! * b];
        r = clamp01(r); g = clamp01(g); b = clamp01(b);
      }
      if (light) {
        r = r * light.slope + light.intercept;
        g = g * light.slope + light.intercept;
        b = b * light.slope + light.intercept;
      }
      out[i] = Math.round(r * 255);
      out[i + 1] = Math.round(g * 255);
      out[i + 2] = Math.round(b * 255);
    }
  }
  let pixels: Uint8ClampedArray = out;
  if (adjust.sharpen) pixels = convolve(pixels, width, height, sharpenKernel(adjust.sharpen));
  if (adjust.edges) {
    pixels = convolve(pixels, width, height, EDGE_KERNEL);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 255 - pixels[i]!;
      pixels[i + 1] = 255 - pixels[i + 1]!;
      pixels[i + 2] = 255 - pixels[i + 2]!;
    }
  }
  return pixels;
}

/** A 3×3 convolution on colour, alpha kept, edges duplicated — `feConvolveMatrix preserveAlpha`. */
export function convolve(rgba: Uint8ClampedArray, width: number, height: number, kernel: readonly number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const yy = Math.min(height - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const xx = Math.min(width - 1, Math.max(0, x + kx));
            sum += kernel[(ky + 1) * 3 + (kx + 1)]! * rgba[(yy * width + xx) * 4 + c]!;
          }
        }
        out[o + c] = sum;
      }
      out[o + 3] = rgba[o + 3]!;
    }
  }
  return out;
}

export interface Histogram { r: number[]; g: number[]; b: number[]; l: number[]; total: number }

/** Counts per level, ignoring pixels that are mostly transparent — a cut-out's empty ground is not part of the photograph. */
export function histogram(rgba: Uint8ClampedArray): Histogram {
  const r = new Array<number>(256).fill(0);
  const g = new Array<number>(256).fill(0);
  const b = new Array<number>(256).fill(0);
  const l = new Array<number>(256).fill(0);
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    r[rgba[i]!]!++;
    g[rgba[i + 1]!]!++;
    b[rgba[i + 2]!]!++;
    l[Math.round(0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!)]!++;
    total++;
  }
  return { r, g, b, l, total };
}

/**
 * Levels that stretch the photograph to full range, clipping a sliver at
 * each end — Photoshop's Auto, which is the button a busy week needs.
 */
export function autoLevels(hist: Histogram, clip = 0.005): { black: number; white: number } {
  if (!hist.total) return { black: 0, white: 1 };
  const limit = hist.total * clip;
  let black = 0;
  for (let seen = 0; black < 255 && seen + hist.l[black]! <= limit; black++) seen += hist.l[black]!;
  let white = 255;
  for (let seen = 0; white > 0 && seen + hist.l[white]! <= limit; white--) seen += hist.l[white]!;
  if (white - black < 16) return { black: 0, white: 1 };
  return { black: Math.round((black / 255) * 1000) / 1000, white: Math.round((white / 255) * 1000) / 1000 };
}
