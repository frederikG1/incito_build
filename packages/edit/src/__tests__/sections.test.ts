import { describe, expect, it } from 'vitest';
import { CatalogDocument, CatalogPage, Offer } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { applySection, sectionsBehind, type SectionDesign } from '../core.js';

const { brand } = getBrand('superbrugsen');
const offer = (id: string) => Offer.parse({ id, name: id, price: 10, validFrom: '2026-09-01', validTo: '2026-09-07', quantity: { size: null, unit: 'pcs' } });

const frost = (version: number, templateId: string, title: string): SectionDesign => ({
  id: 'sec-frost', name: 'Frost med balloner', version, template: null,
  page: CatalogPage.parse({ id: 'x', templateId, title, ground: '#d8e8e7', placements: [] }),
});

const doc = CatalogDocument.parse({
  id: 'u39', schemaVersion: 2, name: 'Uge 39', brandId: 'superbrugsen', createdAt: '', updatedAt: '',
  offers: ['is', 'pizza', 'ærter'].map(offer),
  pages: [
    { id: 'p1', templateId: 'sb/hero-3', title: 'Frost', section: { id: 'sec-frost', version: 1 },
      placements: [{ slotId: 'hero', offerId: 'is' }, { slotId: 'a', offerId: 'pizza' }, { slotId: 'b', offerId: 'ærter' }] },
    { id: 'p2', templateId: 'sb/grid-4', title: 'Andet', placements: [] },
  ],
});

describe('shared section designs', () => {
  it('finds the pages behind their section, and only those', () => {
    expect(sectionsBehind(doc, [frost(1, 'sb/hero-3', 'Frost')])).toEqual([]);
    expect(sectionsBehind(doc, [frost(3, 'sb/duo-2', 'Frostfest')]).map((b) => [b.pageId, b.from])).toEqual([['p1', 1]]);
  });

  it('takes the new design and keeps the page\'s own products, strongest first', () => {
    const { document, dropped } = applySection(doc, brand, 'p1', frost(3, 'sb/duo-2', 'Frostfest'));
    const page = document.pages[0]!;
    expect(page).toMatchObject({ templateId: 'sb/duo-2', title: 'Frostfest', ground: '#d8e8e7', section: { id: 'sec-frost', version: 3 } });
    expect(page.placements.map((p) => [p.slotId, p.offerId])).toEqual([['a', 'is'], ['b', 'pizza']]);
    expect(dropped).toBe(1);
    expect(sectionsBehind(document, [frost(3, 'sb/duo-2', 'Frostfest')])).toEqual([]);
  });
});
