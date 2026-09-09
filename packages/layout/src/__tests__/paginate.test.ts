import { describe, expect, it } from 'vitest';
import type { Offer, TemplateLibrary } from '@incitio/schema';
import { paginateByCategory, partitionCount } from '../paginate.js';
import { AUTHORED_LIBRARY } from '../templates.js';

describe('partitionCount', () => {
  it('returns nothing for an empty page set', () => {
    expect(partitionCount(0, [4, 6, 9])).toEqual([]);
  });

  it('uses a single template when one fits exactly', () => {
    expect(partitionCount(6, [4, 6, 9])).toEqual([6]);
  });

  /*
   * The case that rules out greedy chunking: greedy takes 9 first and
   * strands 2 offers with no two-slot template to put them in. The DP
   * finds an exact partition instead.
   */
  it('finds an exact partition greedy chunking would miss', () => {
    const result = partitionCount(11, [4, 5, 6, 9]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(11);
  });

  it('prefers fewer pages among exact partitions', () => {
    expect(partitionCount(12, [4, 6, 9])).toEqual([6, 6]);
  });

  it('over-provisions rather than dropping offers when no exact fit exists', () => {
    const sizes = [4, 6];
    const result = partitionCount(5, sizes);
    expect(result.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
  });

  it('handles a library with a single template size', () => {
    expect(partitionCount(9, [3])).toEqual([3, 3, 3]);
  });
});

function offer(id: string, category: string, price: number, prePrice: number | null): Offer {
  return {
    id, name: `Vare ${id}`, description: '', brand: '', category,
    price, prePrice, savings: null, currency: 'DKK', comparison: null,
    quantity: { size: null, unit: 'pcs', pieceCount: 1 },
    validFrom: '2026-09-14', validTo: '2026-09-20',
    imageUrl: null, labels: [], priority: null,
  };
}

describe('paginateByCategory', () => {
  const library: TemplateLibrary = AUTHORED_LIBRARY;

  it('never splits a category across another category', () => {
    const offers = [
      ...Array.from({ length: 6 }, (_, i) => offer(`a${i}`, 'mejeri', 10, 20)),
      ...Array.from({ length: 6 }, (_, i) => offer(`b${i}`, 'frugt', 10, 20)),
    ];
    const groups = paginateByCategory(offers, library);
    for (const group of groups) {
      const categories = new Set(group.offers.map((o) => o.category));
      expect(categories.size).toBe(1);
    }
  });

  it('places every offer exactly once', () => {
    const offers = Array.from({ length: 17 }, (_, i) => offer(`x${i}`, 'kolonial', 10, 20));
    const placed = paginateByCategory(offers, library).flatMap((g) => g.offers.map((o) => o.id));
    expect(new Set(placed).size).toBe(17);
    expect(placed).toHaveLength(17);
  });

  // Deep discounts are what a leaflet leads with, so the category holding
  // them has to come first without anyone tagging it by hand.
  it('leads with the category holding the deepest discount', () => {
    const offers = [
      ...Array.from({ length: 4 }, (_, i) => offer(`weak${i}`, 'kolonial', 19, 20)),
      ...Array.from({ length: 4 }, (_, i) => offer(`strong${i}`, 'mejeri', 5, 20)),
    ];
    expect(paginateByCategory(offers, library)[0]?.title).toBe('Mejeri');
  });

  // Overcrowding is a rated dealbreaker, and the mined library goes up to
  // 12 slots, so the cap has to bind rather than merely be preferred.
  it('never exceeds the density cap', () => {
    const offers = Array.from({ length: 60 }, (_, i) => offer(`x${i}`, 'kolonial', 10, 20));
    for (const group of paginateByCategory(offers, library, 8)) {
      expect(group.offers.length).toBeLessThanOrEqual(8);
    }
  });

  it('honours a tighter cap', () => {
    const offers = Array.from({ length: 40 }, (_, i) => offer(`x${i}`, 'kolonial', 10, 20));
    for (const group of paginateByCategory(offers, library, 4)) {
      expect(group.offers.length).toBeLessThanOrEqual(4);
    }
  });

  it('still places every offer once under a cap', () => {
    const offers = Array.from({ length: 37 }, (_, i) => offer(`x${i}`, 'kolonial', 10, 20));
    const placed = paginateByCategory(offers, library, 6).flatMap((g) => g.offers.map((o) => o.id));
    expect(new Set(placed).size).toBe(37);
  });

  it('numbers the parts when a category spans several pages', () => {
    const offers = Array.from({ length: 12 }, (_, i) => offer(`x${i}`, 'mejeri', 10, 20));
    const groups = paginateByCategory(offers, library);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.subtitle).toBe('1 af 2');
  });
});
