import { describe, expect, it } from 'vitest';
import { scanInk } from '../ink.js';

/** A picture of `width`×`height`, painted by a function of x and y. */
function picture(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return data;
}

const INK: [number, number, number, number] = [20, 90, 160, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];

describe('finding the product in a cutout', () => {
  it('finds a block of ink in a transparent field', () => {
    // Ink from x 25–74 of 100, y 10–89 of 100.
    const box = scanInk(picture(100, 100, (x, y) => (
      x >= 25 && x <= 74 && y >= 10 && y <= 89 ? INK : CLEAR
    )), 100, 100);
    expect(box).toEqual({ left: 0.25, top: 0.1, width: 0.5, height: 0.8 });
  });

  it('treats a white field as margin too', () => {
    // The other kind of packshot: no alpha, white to the edges.
    const box = scanInk(picture(100, 100, (x) => (x >= 20 && x < 80 ? INK : WHITE)), 100, 100);
    expect(box!.left).toBeCloseTo(0.2);
    expect(box!.width).toBeCloseTo(0.6);
  });

  it('keeps white that is part of the product', () => {
    // A white label inside a dark pack: the pack's own edges decide,
    // and the label must not punch a hole in the middle of them.
    const box = scanInk(picture(100, 100, (x, y) => {
      if (x < 20 || x >= 80) return CLEAR;
      return x > 40 && x < 60 && y > 40 && y < 60 ? WHITE : INK;
    }), 100, 100);
    expect(box!.width).toBeCloseTo(0.6);
  });

  it('says nothing about a picture that is all background', () => {
    expect(scanInk(picture(10, 10, () => CLEAR), 10, 10)).toBeNull();
    expect(scanInk(picture(10, 10, () => WHITE), 10, 10)).toBeNull();
  });
});
