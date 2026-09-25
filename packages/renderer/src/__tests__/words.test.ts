import { describe, expect, it } from 'vitest';
import { wordsBesidePrice } from '../words.js';

// Measured off SuperBrugsen uge 40, side 3: a tall words box, the mark bottom-right.
const WORDS = { x: 0.04, y: 0.044, w: 0.632, h: 0.911 };
const MARK = { x: 0.609, y: 0.634, w: 0.429, h: 0.393 };

describe('wordsBesidePrice', () => {
  it('ends the column where the price mark begins', () => {
    const column = wordsBesidePrice(WORDS, MARK);
    expect(column.x).toBe(WORDS.x);
    expect(column.x + column.w).toBeCloseTo(MARK.x - 0.015, 6);
    expect(column.h).toBe(WORDS.h);
  });

  it('starts the column after a mark on the left', () => {
    const column = wordsBesidePrice({ x: 0.3, y: 0, w: 0.6, h: 1 }, { x: 0.1, y: 0.5, w: 0.3, h: 0.3 });
    expect(column.x).toBeCloseTo(0.415, 6);
    expect(column.x + column.w).toBeCloseTo(0.9, 6);
  });

  it('leaves a column alone that the mark does not touch, or would halve', () => {
    expect(wordsBesidePrice(WORDS, { x: 0.7, y: 0.6, w: 0.25, h: 0.3 })).toBe(WORDS);
    expect(wordsBesidePrice(WORDS, undefined)).toBe(WORDS);
    // A mark over the middle of the column: the words go above it, not beside it.
    expect(wordsBesidePrice(WORDS, { x: 0.25, y: 0.7, w: 0.6, h: 0.2 })).toBe(WORDS);
  });
});
