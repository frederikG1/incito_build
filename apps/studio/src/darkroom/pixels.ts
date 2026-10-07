import { gridFor } from './selection.js';

export interface Pixels {
  /** The photograph at analysis size — see `GRID`. */
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  naturalW: number;
  naturalH: number;
}

export type Loaded = { ok: true; pixels: Pixels } | { ok: false; naturalW: number; naturalH: number; reason: string };

const seen = new Map<string, Promise<Loaded>>();

function load(url: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.onload = () => done(image);
    image.onerror = () => fail(new Error('load'));
    // Through `image-route`, which sends the chain's photographs via our own cache — same origin, so readable.
    image.src = url;
  });
}

/**
 * The photograph's pixels at analysis size.
 *
 * A picture from another site that does not allow reading is still shown
 * and still developed — the browser draws the filter — but it has no
 * histogram and no magic wand, and the result says why.
 */
export function loadPixels(url: string): Promise<Loaded> {
  const known = seen.get(url);
  if (known) return known;
  const job = (async (): Promise<Loaded> => {
    const sameOrigin = url.startsWith('/') || url.startsWith(location.origin) || /^https:\/\/imageservice\d*\.republica\.dk\//.test(url);
    let image: HTMLImageElement;
    try {
      image = await load(url, !sameOrigin);
    } catch {
      try { image = await load(url, false); } catch { return { ok: false, naturalW: 1, naturalH: 1, reason: 'Billedet kunne ikke hentes.' }; }
    }
    const { w, h } = gridFor(image.naturalWidth, image.naturalHeight);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, w, h);
      const { data } = context.getImageData(0, 0, w, h);
      return { ok: true, pixels: { rgba: data, w, h, naturalW: image.naturalWidth, naturalH: image.naturalHeight } };
    } catch {
      return { ok: false, naturalW: image.naturalWidth, naturalH: image.naturalHeight, reason: 'Billedet ligger på et andet site, der ikke lader os læse pixels — histogram og tryllestav er slået fra.' };
    }
  })();
  seen.set(url, job);
  return job;
}

/** A smaller copy for the histogram, which only needs counts. */
export function thumbnail(p: Pixels, longest = 200): { rgba: Uint8ClampedArray; w: number; h: number } {
  const k = Math.min(1, longest / Math.max(p.w, p.h));
  if (k === 1) return p;
  const w = Math.max(1, Math.round(p.w * k));
  const h = Math.max(1, Math.round(p.h * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(p.h - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(p.w - 1, Math.floor(x / k));
      out.set(p.rgba.subarray((sy * p.w + sx) * 4, (sy * p.w + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { rgba: out, w, h };
}
