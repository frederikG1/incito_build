import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { tidyAdjust } from '@incitio/schema';
import { adjustment, autoLevels, colourMatrix, curveFunction, develop, histogram, maskImage, toneTable } from '../adjust.js';

describe('tone table', () => {
  it('is the identity when nothing is set', () => {
    toneTable({}, 'r').forEach((v, i) => expect(v).toBeCloseTo(i / 255, 6));
  });
  it('keeps black and white where they are under brightness', () => {
    const t = toneTable({ brightness: 0.5 }, 'r');
    expect(t[0]).toBe(0);
    expect(t[255]).toBe(1);
    expect(t[128]!).toBeGreaterThan(128 / 255);
  });
  it('doubles linear light per stop of exposure', () => {
    const t = toneTable({ exposure: 1 }, 'g');
    // sRGB 0.5 is 0.214 linear; doubled, 0.428 linear, which is sRGB ≈ 0.686.
    expect(t[128]!).toBeCloseTo(0.687, 2);
  });
  it('stretches levels and clips beyond them', () => {
    const t = toneTable({ levels: { black: 0.2, white: 0.8, gamma: 1, outBlack: 0, outWhite: 1 } }, 'b');
    expect(t[51]).toBe(0);
    expect(t[204]).toBeCloseTo(1, 2);
    expect(t[128]!).toBeCloseTo(0.5, 1);
  });
  it('applies a channel curve only to that channel', () => {
    const curves = { r: [[0, 0], [0.5, 0.8], [1, 1]] as [number, number][] };
    expect(toneTable({ curves }, 'r')[128]!).toBeGreaterThan(0.75);
    expect(toneTable({ curves }, 'g')[128]!).toBeCloseTo(128 / 255, 6);
  });
});

describe('curve', () => {
  it('never overshoots between points', () => {
    const f = curveFunction([[0, 0], [0.4, 0.9], [0.6, 0.95], [1, 1]]);
    for (let x = 0; x <= 1; x += 0.01) expect(f(x)).toBeLessThanOrEqual(1);
    expect(f(0.4)).toBeCloseTo(0.9, 6);
  });
});

describe('colour', () => {
  it('turns grey at saturation −1', () => {
    const m = colourMatrix({ saturation: -1 })!;
    const px = develop(new Uint8ClampedArray([200, 40, 40, 255]), 1, 1, { saturation: -1 });
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(m).toHaveLength(20);
  });
  it('leaves grey alone under any hue', () => {
    const px = develop(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1, { hue: 90 });
    expect(Math.abs(px[0]! - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[2]! - 128)).toBeLessThanOrEqual(1);
  });
});

describe('develop', () => {
  it('finds edges as ink on white', () => {
    const w = 6;
    const rgba = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) { const x = i % w; rgba.set(x < 3 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4); }
    const out = develop(rgba, w, w, { edges: true });
    expect(out[(2 * w + 0) * 4]).toBe(255); // flat black ground: no edge, so white
    expect(out[(2 * w + 3) * 4]).toBe(0); // the first white column beside the black: ink
  });
});

describe('histogram and auto', () => {
  it('ignores the transparent ground of a cut-out', () => {
    const h = histogram(new Uint8ClampedArray([10, 10, 10, 255, 255, 255, 255, 0]));
    expect(h.total).toBe(1);
  });
  it('stretches a dull picture to full range', () => {
    const rgba = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) { const v = 60 + Math.floor((i / 255) * 120); rgba.set([v, v, v, 255], i * 4); }
    const { black, white } = autoLevels(histogram(rgba));
    expect(black).toBeCloseTo(60 / 255, 1);
    expect(white).toBeCloseTo(180 / 255, 1);
  });
});

describe('adjustment', () => {
  it('draws nothing for nothing', () => {
    expect(adjustment(undefined).defs).toBeNull();
    expect(adjustment({ brightness: 0, blend: 'normal' }).style).toEqual({});
  });
  it('names equal adjustments alike and different ones apart', () => {
    expect(adjustment({ contrast: 0.2 }).style.filter).toBe(adjustment({ contrast: 0.2 }).style.filter);
    expect(adjustment({ contrast: 0.2 }).style.filter).not.toBe(adjustment({ contrast: 0.3 }).style.filter);
  });
  it('writes a 256-entry table so every 8-bit value is exact', () => {
    const html = renderToStaticMarkup(adjustment({ contrast: 0.3 }).defs!);
    const table = /tableValues="([^"]+)"/.exec(html)![1]!.split(' ');
    expect(table).toHaveLength(256);
    expect(html).toContain('color-interpolation-filters="sRGB"');
  });
  it('carries blend, crop, mask and skew', () => {
    const a = adjustment({
      blend: 'multiply', skewX: 10,
      crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
      mask: { w: 100, h: 50, path: 'M0 0H50V50H0Z', feather: 0.02, invert: false },
    });
    expect(a.style.mixBlendMode).toBe('multiply');
    expect((a.style as Record<string, string>).objectViewBox).toBe('inset(0% 10% 0% 10%)');
    expect(a.attrs['data-adjust-mask']).toBe('');
    expect(a.skew).toBe('skew(10deg, 0deg)');
  });
  it('sizes the mask to the crop it is seen through', () => {
    const svg = decodeURIComponent(maskImage({ w: 100, h: 50, path: 'M0 0H50V50H0Z', feather: 0, invert: true }, { x: 0.5, y: 0, w: 0.5, h: 1 }));
    expect(svg).toContain('viewBox="50 0 50 50"');
    expect(svg).toContain('fill-rule="evenodd"');
  });
});

describe('tidy', () => {
  it('drops what does nothing', () => {
    expect(tidyAdjust({ brightness: 0, edges: false, curves: { rgb: [[0, 0], [1, 1]] } })).toBeUndefined();
    expect(tidyAdjust({ brightness: 0.1, hue: 0 })).toEqual({ brightness: 0.1 });
  });
});
