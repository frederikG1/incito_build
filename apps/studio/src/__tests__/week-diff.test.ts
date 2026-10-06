import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { deltaSaid, weekDiff } from '../week-diff.js';

const offer = (id: string, name: string, price: number) => Offer.parse({
  id, name, price, validFrom: '2026-09-28', validTo: '2026-10-04', quantity: { size: 1, unit: 'pcs' },
});

const doc = (week: number, offers: Offer[]) => CatalogDocument.parse({
  id: `u${week}`, schemaVersion: 2, name: `uge ${week}`, brandId: 'sb', week: { year: 2026, week },
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
  offers,
  pages: [{ id: 'p1', templateId: 't', placements: offers.map((o, n) => ({ slotId: `s${n}`, offerId: o.id })) }],
});

describe('weekDiff', () => {
  it('counts new, re-priced and gone products — by id, else by name', () => {
    const before = doc(39, [offer('a', 'Mælk', 10), offer('b', 'Smør', 20), offer('c', 'Ost', 30)]);
    const after = doc(40, [offer('a', 'Mælk', 10), offer('b2', 'smør ', 18), offer('d', 'Æg', 25)]);
    const diff = weekDiff(before, after);
    expect(diff.since).toBe(39);
    expect(diff.pages.get('p1')).toEqual({ fresh: 1, repriced: 1 });
    expect(diff.gone).toBe(1);
    expect(deltaSaid(diff.pages.get('p1'))).toBe('1 ny · 1 ny pris');
  });
});
