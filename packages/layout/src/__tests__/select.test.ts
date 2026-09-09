import { describe, expect, it } from 'vitest';
import type { Offer } from '@incitio/schema';
import { selectOffers, targetForPages } from '../select.js';

function offer(id: string, category: string, price: number, prePrice: number | null, image = true): Offer {
  return {
    id, name: `Vare ${id}`, description: '', brand: '', category,
    price, prePrice, savings: null, currency: 'DKK', comparison: null,
    quantity: { size: null, unit: 'pcs', pieceCount: 1 },
    validFrom: '2026-09-14', validTo: '2026-09-20',
    imageUrl: image ? `/images/${id}.png` : null,
    labels: [], priority: null,
  };
}

const many = (n: number, category: string, strong = false) =>
  Array.from({ length: n }, (_, i) =>
    offer(`${category}-${i}`, category, strong ? 5 : 18, 20));

describe('selectOffers', () => {
  it('cuts a large range down to the target', () => {
    const result = selectOffers(many(200, 'drikke'), { targetCount: 40 });
    expect(result.selected).toHaveLength(40);
    expect(result.rejected).toHaveLength(160);
  });

  it('never returns more than the target', () => {
    const result = selectOffers(many(10, 'a'), { targetCount: 40 });
    expect(result.selected.length).toBeLessThanOrEqual(40);
  });

  it('returns nothing for a zero target, and says why', () => {
    const result = selectOffers(many(5, 'a'), { targetCount: 0 });
    expect(result.selected).toEqual([]);
    expect(result.rejected).toHaveLength(5);
  });

  /*
   * The failure this exists to prevent: nemlig lists 213 drinks against 67
   * chilled goods, so a purely strength-ranked cut publishes a drinks
   * catalogue and calls it a supermarket.
   */
  it('stops one category dominating the catalog', () => {
    const offers = [
      ...many(200, 'drikke', true),
      ...many(40, 'mejeri'), ...many(40, 'frost'),
      ...many(40, 'kolonial'), ...many(40, 'pleje'),
    ];
    const result = selectOffers(offers, { targetCount: 40, maxCategoryShare: 0.25 });
    expect(result.byCategory['drikke']).toBeLessThanOrEqual(10);
    expect(Object.keys(result.byCategory)).toHaveLength(5);
    expect(result.selected).toHaveLength(40);
  });

  // When the cap makes the target unreachable it is raised for everyone,
  // not abandoned for the strongest category.
  it('raises the ceiling evenly when the cap is infeasible', () => {
    const offers = [...many(200, 'drikke', true), ...many(40, 'mejeri'), ...many(40, 'frost')];
    const result = selectOffers(offers, { targetCount: 40, maxCategoryShare: 0.25 });
    expect(result.selected).toHaveLength(40);
    // A fair share of 40 across three categories is ~14, not 20+.
    expect(result.byCategory['drikke']).toBeLessThanOrEqual(15);
    expect(result.byCategory['mejeri']).toBeGreaterThanOrEqual(12);
  });

  it('gives every present category a floor', () => {
    const offers = [...many(100, 'drikke', true), ...many(3, 'blomster')];
    const result = selectOffers(offers, { targetCount: 30, minPerCategory: 2 });
    expect(result.byCategory['blomster']).toBeGreaterThanOrEqual(2);
  });

  it('prefers stronger offers within a category', () => {
    const offers = [offer('weak', 'a', 19, 20), offer('strong', 'a', 5, 20)];
    const result = selectOffers(offers, { targetCount: 1, minPerCategory: 0 });
    expect(result.selected[0]?.id).toBe('strong');
  });

  it('drops offers with no artwork and records the reason', () => {
    const offers = [offer('a', 'x', 10, 20), offer('b', 'x', 5, 20, false)];
    const result = selectOffers(offers, { targetCount: 5 });
    expect(result.selected.map((o) => o.id)).toEqual(['a']);
    expect(result.rejected).toContainEqual({ offerId: 'b', category: 'x', reason: 'no image' });
  });

  it('keeps imageless offers when artwork is not required', () => {
    const offers = [offer('a', 'x', 10, 20), offer('b', 'x', 5, 20, false)];
    const result = selectOffers(offers, { targetCount: 5, requireImage: false });
    expect(result.selected).toHaveLength(2);
  });

  // A contractual placement is not the engine's decision to overrule.
  it('always includes pinned offers, artwork or not', () => {
    const offers = [...many(100, 'a', true), offer('deal', 'b', 19, 20, false)];
    const result = selectOffers(offers, { targetCount: 10, pinned: ['deal'] });
    expect(result.selected.map((o) => o.id)).toContain('deal');
  });

  it('accounts for every offer exactly once', () => {
    const offers = [...many(50, 'a'), ...many(50, 'b'), ...many(20, 'c')];
    const result = selectOffers(offers, { targetCount: 30 });
    expect(result.selected.length + result.rejected.length).toBe(120);
  });

  it('is deterministic', () => {
    const offers = [...many(60, 'a'), ...many(60, 'b')];
    const a = selectOffers(offers, { targetCount: 25 });
    const b = selectOffers(offers, { targetCount: 25 });
    expect(a.selected.map((o) => o.id)).toEqual(b.selected.map((o) => o.id));
  });

  it('does not depend on feed row order', () => {
    const offers = [...many(60, 'a'), ...many(60, 'b')];
    const a = selectOffers(offers, { targetCount: 25 });
    const b = selectOffers([...offers].reverse(), { targetCount: 25 });
    expect(new Set(b.selected.map((o) => o.id))).toEqual(new Set(a.selected.map((o) => o.id)));
  });

  it('relaxes the cap rather than publishing a short catalog', () => {
    const offers = many(100, 'only-one-category');
    const result = selectOffers(offers, { targetCount: 40, maxCategoryShare: 0.1 });
    expect(result.selected).toHaveLength(40);
  });
});

describe('targetForPages', () => {
  it('converts a page count and density into an offer target', () => {
    expect(targetForPages(40, 4)).toBe(160);
  });
});
