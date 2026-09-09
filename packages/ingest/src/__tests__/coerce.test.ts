import { describe, expect, it } from 'vitest';
import { parseDate, parsePrice, parseQuantity } from '../coerce.js';

describe('parsePrice', () => {
  it('reads Danish decimal commas', () => {
    expect(parsePrice('12,95')).toBe(12.95);
  });

  it('reads plain decimal points', () => {
    expect(parsePrice('12.95')).toBe(12.95);
  });

  // The regression that motivates the whole separator dance: naive parsing
  // turns "1.299,00" into 1.299 and undercharges by three orders of magnitude.
  it('treats dots as thousands separators when a comma follows', () => {
    expect(parsePrice('1.299,00')).toBe(1299);
  });

  it('treats commas as thousands separators when a dot follows', () => {
    expect(parsePrice('1,299.00')).toBe(1299);
  });

  it('strips currency decoration', () => {
    expect(parsePrice('kr. 49,00')).toBe(49);
  });

  it('passes numbers through', () => {
    expect(parsePrice(24.5)).toBe(24.5);
  });

  it('returns null for junk rather than NaN', () => {
    expect(parsePrice('ikke-et-tal')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('reads size and unit', () => {
    expect(parseQuantity('0,5 l')).toEqual({ size: 0.5, unit: 'l', pieceCount: 1 });
  });

  it('reads a unit with no space', () => {
    expect(parseQuantity('500g')).toEqual({ size: 500, unit: 'g', pieceCount: 1 });
  });

  it('expands multipack notation into a piece count', () => {
    expect(parseQuantity('6 x 33 cl')).toEqual({ size: 330, unit: 'ml', pieceCount: 6 });
  });

  it('normalises centilitres to millilitres so comparisons share a scale', () => {
    expect(parseQuantity('75 cl')).toEqual({ size: 750, unit: 'ml', pieceCount: 1 });
  });

  it('reads a bare piece count', () => {
    expect(parseQuantity('3 stk.')).toEqual({ size: null, unit: 'pcs', pieceCount: 3 });
  });

  it('falls back to a single piece for unreadable input', () => {
    expect(parseQuantity('efter vægt')).toEqual({ size: null, unit: 'pcs', pieceCount: 1 });
  });
});

describe('parseDate', () => {
  it('reads ISO dates', () => {
    expect(parseDate('2026-09-14')).toBe('2026-09-14');
  });

  it('reads Danish dd-mm-yyyy', () => {
    expect(parseDate('14-09-2026')).toBe('2026-09-14');
  });

  it('reads dotted Danish dates and pads single digits', () => {
    expect(parseDate('1.9.2026')).toBe('2026-09-01');
  });

  it('reads compact ISO basic format', () => {
    expect(parseDate('20260907')).toBe('2026-09-07');
  });

  // An 8-digit SKU must not be mistaken for a date.
  it('rejects an 8-digit value that is not a plausible date', () => {
    expect(parseDate('20261345')).toBeNull();
    expect(parseDate('50688791')).toBeNull();
  });

  it('returns null rather than guessing at ambiguous input', () => {
    expect(parseDate('09/14/26')).toBeNull();
  });
});
