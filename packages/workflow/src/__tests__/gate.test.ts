import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { changesSince, checkWrite, keepWorkflow, seenOf } from '../index.js';

const offer = (id: string, price: number, extra: Partial<Offer> = {}) => Offer.parse({
  id, name: `vare ${id}`, price, validFrom: '2026-09-21', validTo: '2026-09-27', quantity: { size: 1, unit: 'pcs' }, ...extra,
});

const doc = (extra: Partial<CatalogDocument> = {}) => CatalogDocument.parse({
  id: 'c1', schemaVersion: 2, name: 'uge 39', brandId: 'superbrugsen',
  offers: [offer('x', 20, { prePrice: 25, savings: 5 }), offer('y', 10)],
  pages: [{ id: 'p1', templateId: 't', placements: [{ slotId: 'a', offerId: 'x' }, { slotId: 'b', offerId: 'y' }] }],
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
  ...extra,
});

const edition = (ops: unknown[]) => ({ id: 'hb', name: 'Holbæk', stores: [], ops, offers: [] });

describe('what a signature sees', () => {
  it('a store swapping one edit for another is a change, though the count stays', () => {
    const before = doc({ variants: [edition([{ op: 'remove', offerId: 'x' }])] } as Partial<CatalogDocument>);
    const after = doc({ variants: [edition([{ op: 'remove', offerId: 'y' }])] } as Partial<CatalogDocument>);
    expect(changesSince(seenOf(before), after).map((c) => c.id)).toEqual(['udgave:hb']);
  });

  it('a changed "spar" is a price change', () => {
    const before = doc();
    const after = { ...before, offers: before.offers.map((o) => (o.id === 'x' ? { ...o, savings: 6 } : o)) };
    expect(changesSince(seenOf(before), after).map((c) => c.id)).toEqual(['spar:x']);
  });

  it('a signature from before these were kept reports nothing it cannot know', () => {
    const d = doc({ variants: [edition([{ op: 'remove', offerId: 'x' }])] } as Partial<CatalogDocument>);
    const seen = seenOf(d);
    const old = {
      ...seen,
      offers: Object.fromEntries(Object.entries(seen.offers).map(([id, t]) => [id, t.slice(0, 4)])),
      editions: Object.fromEntries(Object.entries(seen.editions).map(([id, t]) => [id, t.slice(0, 2)])),
    } as typeof seen;
    expect(changesSince(old, d)).toEqual([]);
  });
});

describe('a plain write', () => {
  it('keeps the workflow as stored', () => {
    const stored = doc({ status: 'udgivet', live: [] });
    const { document, kept } = keepWorkflow(stored, { ...stored, status: 'kladde', bookings: [{ id: 'b', pageId: 'p1', slotId: 'a', supplier: 'X', offerId: null, price: 1, note: '', at: '' }] });
    expect(kept).toEqual(['bookings', 'status']);
    expect(document.status).toBe('udgivet');
    expect(document.bookings).toBeUndefined();
  });

  it('on a published avis, logs prices and refuses one the rules stop', () => {
    const before = doc({ status: 'udgivet' });
    const legal = { ...before, offers: before.offers.map((o) => (o.id === 'y' ? { ...o, price: 9 } : o)) };
    expect(checkWrite(before, legal)).toEqual({ refused: [], logged: [{ kind: 'pris', offerId: 'y', substituteId: null, before: 10, after: 9, who: '' }] });
    // 26 under "før 25": a saving that is not one.
    const illegal = { ...before, offers: before.offers.map((o) => (o.id === 'x' ? { ...o, price: 26 } : o)) };
    expect(checkWrite(before, illegal).refused.map((s) => s.id)).toContain('førlav:x');
  });

  it('a draft may hold a wrong price — publishing is where it stops', () => {
    const before = doc();
    const illegal = { ...before, offers: before.offers.map((o) => (o.id === 'x' ? { ...o, price: 26 } : o)) };
    expect(checkWrite(before, illegal)).toEqual({ refused: [], logged: [] });
  });
});
