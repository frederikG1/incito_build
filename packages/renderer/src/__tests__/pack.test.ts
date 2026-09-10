import { describe, expect, it } from 'vitest';
import { packStyle } from '../OfferTile.js';

describe('packStyle', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `offer-${i}`);

  it('is stable for one offer', () => {
    expect(packStyle('abc', 3, 'standard')).toBe(packStyle('abc', 3, 'standard'));
  });

  /*
   * The point of the whole mechanism: two "frit valg" tiles on one page
   * must not be arranged identically, or the page reads as generated.
   */
  it('varies across offers', () => {
    const seen = new Set(ids.map((id) => packStyle(id, 3, 'standard')));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never fans a compact tile', () => {
    // A rotated item needs room its corners do not have at that size.
    for (const id of ids) expect(packStyle(id, 2, 'compact')).not.toBe('fan');
  });

  it('never rows four or more', () => {
    // Four items in one line leaves each too small to recognise.
    for (const id of ids) {
      expect(['grid', 'stagger']).toContain(packStyle(id, 4, 'standard'));
      expect(packStyle(id, 6, 'hero')).toBe('stagger');
    }
  });

  it('uses a two-row block only at exactly four', () => {
    for (const id of ids) {
      expect(packStyle(id, 3, 'hero')).not.toBe('grid');
      expect(packStyle(id, 5, 'hero')).not.toBe('grid');
    }
  });
});
