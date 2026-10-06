import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { applyQuickFix, feedPictureOf, quickFixOf } from '../quickfix.js';
import type { Finding } from '../findings.js';

const offer = (id: string, extra: Partial<Offer> = {}) => Offer.parse({
  id, name: `vare ${id}`, price: 10, validFrom: '2026-09-28', validTo: '2026-10-04', quantity: { size: 1, unit: 'pcs' }, ...extra,
});

const doc = CatalogDocument.parse({
  id: 'c1', schemaVersion: 2, name: 'uge 40', brandId: 'superbrugsen', week: { year: 2026, week: 40 },
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
  offers: [offer('x'), offer('y', { imageUrl: 'https://img/y.png' })],
  pages: [{
    id: 'p1', templateId: 't', title: 'Gælder fra fredag d. 18. september', placements: [{ slotId: 'a', offerId: 'x' }],
    notes: [{ id: 'n1', text: 'til torsdag d. 24. september', x: 0, y: 0, w: 1, h: 1 }],
  }],
});

const finding = (extra: Partial<Finding>): Finding => ({
  id: 'f', kind: 'uge', said: '', pageId: 'p1', pageNumber: 1, offerId: null, weight: 'stop', ...extra,
});

describe('quick fixes', () => {
  it('moves every stale line on the page, and says to what', () => {
    const fix = quickFixOf(doc, finding({}), [], () => 0)!;
    expect(fix.label).toBe('Ret til 25. sep.');
    const fixed = applyQuickFix(doc, fix);
    expect(fixed.pages[0]!.title).toBe('Gælder fra fredag d. 25. september');
    expect(fixed.pages[0]!.notes[0]!.text).toBe('til torsdag d. 1. oktober');
  });

  it('takes the picture from the feed row with the same name', () => {
    const feed = [offer('other', { name: 'vare x', imageUrl: 'https://img/x.png' })];
    expect(feedPictureOf(doc.offers[0]!, feed)).toBe('https://img/x.png');
    const fix = quickFixOf(doc, finding({ kind: 'billede', offerId: 'x' }), feed, () => 0)!;
    expect(applyQuickFix(doc, fix).offers[0]!.imageUrl).toBe('https://img/x.png');
  });

  it('offers nothing it cannot do', () => {
    expect(quickFixOf(doc, finding({ kind: 'billede', offerId: 'x' }), [], () => 0)).toBeNull();
    expect(quickFixOf(doc, finding({ kind: 'plads', id: 'p1:tomme-pladser' }), [], () => 0)).toBeNull();
    expect(quickFixOf(doc, finding({ kind: 'plads', id: 'p1:tomme-pladser' }), [], () => 2)!.kind).toBe('plads');
  });
});
