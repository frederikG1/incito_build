import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { printedOffers, sameShown, withoutTwins } from '../state/twins.js';

const offer = (id: string, name: string, price: number, brand = '') => Offer.parse({
  id, name, brand, price, validFrom: '2026-10-02', validTo: '2026-10-08', quantity: { size: null, unit: 'pcs' },
});

// Page 15 of week 41: the publication's copy, without a brand, and the feed's.
const fromPage = offer('Cpa5e-JwBMFz7EWOdefgw', 'Mammen laktosefri hytteost', 10);
const fromFeed = offer('1073807', 'Mammen laktosefri  hytteost', 10, 'Mammen');

describe('the same product under two ids', () => {
  it('is one product when the words and the price agree and a brand is missing or the same', () => {
    expect(sameShown(fromPage, fromFeed)).toBe(true);
    expect(sameShown(fromFeed, offer('x', 'Mammen laktosefri hytteost', 10, 'Arla'))).toBe(false);
    expect(sameShown(fromFeed, offer('y', 'Mammen laktosefri hytteost', 12, 'Mammen'))).toBe(false);
  });

  it('is not dealt from the reserve onto a page that prints it, nor twice in one fill', () => {
    const doc = CatalogDocument.parse({
      id: 'u41', schemaVersion: 2, name: 'Uge 41', brandId: 'superbrugsen', createdAt: '2026-10-01', updatedAt: '2026-10-01',
      offers: [fromPage],
      pages: [{ id: 'p15', templateId: 't', placements: [{ slotId: 'a', offerId: fromPage.id }] }],
    });
    const klovborg = offer('1073966', 'Klovborg skæreost', 79);
    expect(withoutTwins([fromFeed, klovborg], printedOffers(doc)).map((o) => o.id)).toEqual(['1073966']);
    expect(withoutTwins([fromPage, fromFeed], []).map((o) => o.id)).toEqual([fromPage.id]);
  });
});
