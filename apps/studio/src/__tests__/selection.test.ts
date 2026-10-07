import { describe, expect, it } from 'vitest';
import { combine, ellipseBitmap, magicWand, outlines, rectBitmap, selectedCount, selectionPath } from '../darkroom/selection.js';

/** A w×h picture, one colour per pixel from `paint`. */
function picture(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out.set([...paint(x, y), 255], (y * w + x) * 4);
  }
  return out;
}

describe('magic wand', () => {
  // White ground, a red square 4..11, and a red dot off on its own at 14,14.
  const red = (x: number, y: number) => (x >= 4 && x < 12 && y >= 4 && y < 12) || (x === 14 && y === 14);
  const px = picture(16, 16, (x, y) => (red(x, y) ? [220, 20, 20] : [250, 250, 250]));

  it('fills only what is joined to the click', () => {
    const sel = magicWand(px, 16, 16, 6, 6, 10, true);
    expect(selectedCount(sel)).toBe(64);
  });
  it('takes every match when not contiguous', () => {
    expect(selectedCount(magicWand(px, 16, 16, 6, 6, 10, false))).toBe(65);
  });
  it('grows with the tolerance', () => {
    const shaded = picture(10, 1, (x) => [x * 10, x * 10, x * 10]);
    expect(selectedCount(magicWand(shaded, 10, 1, 0, 0, 0))).toBe(1);
    expect(selectedCount(magicWand(shaded, 10, 1, 0, 0, 25))).toBe(3);
  });
});

describe('outline', () => {
  it('traces a square as four corners', () => {
    const loops = outlines(rectBitmap(10, 10, { x: 2, y: 3, w: 4, h: 5 }), 10, 10);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(selectionPath(rectBitmap(10, 10, { x: 2, y: 3, w: 4, h: 5 }), 10, 10)).toBe('M2 3L6 3L6 8L2 8Z');
  });
  it('keeps a hole as its own loop', () => {
    const ring = combine(rectBitmap(10, 10, { x: 1, y: 1, w: 8, h: 8 }), rectBitmap(10, 10, { x: 3, y: 3, w: 4, h: 4 }), 'subtract');
    expect(selectedCount(ring)).toBe(64 - 16);
    expect(outlines(ring, 10, 10)).toHaveLength(2);
  });
  it('keeps two pixels that touch at a corner apart', () => {
    const sel = new Uint8Array(9);
    sel[0] = 1; sel[4] = 1;
    expect(outlines(sel, 3, 3)).toHaveLength(2);
  });
  it('simplifies a circle to far fewer points than its stairs', () => {
    const sel = ellipseBitmap(200, 200, { x: 10, y: 10, w: 180, h: 180 });
    const d = selectionPath(sel, 200, 200)!;
    const stairs = outlines(sel, 200, 200)[0]!.length;
    expect(d.split('L').length).toBeLessThan(stairs / 2.5);
    expect(selectedCount(sel)).toBeGreaterThan(Math.PI * 89 * 89);
  });
  it('says nothing for an empty selection', () => {
    expect(selectionPath(new Uint8Array(16), 4, 4)).toBeNull();
  });
});
