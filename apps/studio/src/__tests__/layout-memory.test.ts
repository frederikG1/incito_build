import { describe, expect, it } from 'vitest';
import { Brand, CatalogDocument, Offer } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { standardLayouts } from '../layouts.js';
import { layoutKey, pageInLayout } from '../state.js';

const [even, top, left] = standardLayouts(4);
const brand = Brand.parse({ ...getBrand('superbrugsen').brand, templates: [even, top, left] });

const offer = (id: string): Offer => Offer.parse({
  id, name: `vare ${id}`, price: 10, quantity: { size: 1, unit: 'pcs' }, validFrom: '2026-09-21', validTo: '2026-09-27',
  imageUrl: 'https://example.test/a.png',
});

const document = CatalogDocument.parse({
  id: 'c1', schemaVersion: 2, name: 'uge 39', brandId: 'superbrugsen',
  week: { year: 2026, week: 39 },
  offers: ['1', '2', '3', '4', '5'].map(offer),
  pages: [{
    id: 'p1', templateId: even!.id, title: 'Side',
    placements: ['a', 'b', 'c', 'd'].map((slotId, index) => ({
      slotId, offerId: String(index + 1),
      overrides: index === 0 ? { parts: { price: { offsetX: 6, offsetY: -4 } } } : {},
    })),
  }],
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
});

const page = (doc: CatalogDocument) => doc.pages[0]!;

describe('pageInLayout', () => {
  it('works the page out without touching the document', () => {
    const before = JSON.stringify(document);
    expect(pageInLayout(document, brand, 'p1', top!)).not.toBeNull();
    expect(JSON.stringify(document)).toBe(before);
  });

  it('gives back the page exactly as it was left, after other layouts were tried', () => {
    let doc = pageInLayout(document, brand, 'p1', top!)!;
    expect(layoutKey(page(doc))).toBe(top!.id);
    doc = pageInLayout(doc, brand, 'p1', left!)!;
    doc = pageInLayout(doc, brand, 'p1', standardLayouts(5)[0]!)!;
    expect(page(doc).placements).toHaveLength(5);
    doc = pageInLayout(doc, brand, 'p1', even!)!;
    expect(page(doc).templateId).toBe(even!.id);
    expect(page(doc).placements).toEqual(page(document).placements);
  });

  it('works a layout out afresh when a product it held has gone to another page', () => {
    let doc = pageInLayout(document, brand, 'p1', top!)!;
    // Offer 4 moves to a page of its own.
    doc = {
      ...doc,
      pages: [
        { ...page(doc), placements: page(doc).placements.filter((p) => p.offerId !== '4') },
        { ...page(doc), id: 'p2', layouts: {}, placements: [{ offerId: '4', slotId: 'a', overrides: page(doc).placements[0]!.overrides }] },
      ],
    };
    const back = pageInLayout(doc, brand, 'p1', even!)!;
    expect(page(back).placements.map((p) => p.offerId)).not.toContain('4');
  });
});
