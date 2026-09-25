import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer, PageTemplate } from '@incitio/schema';
import { carryForward } from '@incitio/compose';
import { incitoCells, incitoHtml } from '@incitio/renderer';

// A published page with one offer: its name, its price and its packshot.
const template = PageTemplate.parse({ id: 't1', name: 'en', areas: ['a'], slots: [{ id: 'a', role: 'hero' }] });
const offer = (id: string, name: string, price: number, image: string) => Offer.parse({
  id, name, price, imageUrl: image, category: 'Kolonial',
  quantity: { size: null, unit: 'pcs' }, validFrom: '2026-09-18', validTo: '2026-09-24',
});
const printed = offer('1093377', 'Libero Touch bleer', 109.95, 'https://img/libero.png');
const previous = CatalogDocument.parse({
  id: 'uge38', schemaVersion: 2, name: 'uge 38', brandId: 'superbrugsen',
  pages: [{
    id: 'p1', templateId: 't1', exact: true,
    placements: [{ offerId: printed.id, slotId: 'a', overrides: {} }],
    incito: {
      width: 600, height: 1000, slots: { a: '1093377' },
      view: {
        view_name: 'View', layout_width: 600, layout_height: 1000,
        child_views: [{
          view_name: 'View', role: 'offer', id: '1093377', accessibility_label: 'Libero Touch bleer\n, DKK 109.95',
          layout_width: 600, layout_height: 400,
          child_views: [
            { view_name: 'TextView', text: 'Libero Touch bleer' },
            { view_name: 'View', layout_width: 300, layout_height: 300, background_image: 'https://img/libero.png' },
            { view_name: 'TextView', text: '10995', spans: [{ start: 3, end: 5, name: 'superscript' }] },
          ],
        }],
      },
    },
  }],
  offers: [printed],
  templates: [template],
  createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z',
});

describe('a published page carried into a new week', () => {
  it('prints the new product in the old one\'s place — photo, name and price', () => {
    const fresh = offer('new-1', 'Pampers Baby-Dry', 89, 'https://img/pampers.png');
    const { document } = carryForward(previous, [fresh], {
      templateFor: (id) => (id === 't1' ? template : undefined),
      week: { year: 2026, week: 39 }, brandName: 'SuperBrugsen', id: 'uge39',
    });
    // Last week's product is gone from the avis — the page still knows what it printed.
    expect(document.offers.map((entry) => entry.id)).toEqual(['new-1']);
    const page = document.pages[0]!;
    const cells = incitoCells(page as never, new Map(document.offers.map((entry) => [entry.id, entry])))!;
    const html = incitoHtml(page.incito!, cells.now, {}, cells.printed);
    expect(html).toContain('https://img/pampers.png');
    expect(html).not.toContain('https://img/libero.png');
    expect(html).toContain('>Pampers Baby-Dry<');
    expect(html).toContain('>89,-<');
  });
});
