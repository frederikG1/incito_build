import { describe, expect, it } from 'vitest';
import {
  Brand, CatalogDocument, Offer, PageTemplate, type CatalogWeek,
} from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { readFindings, staleDates } from '../findings.js';

const WEEK: CatalogWeek = { year: 2026, week: 39 };

const template = PageTemplate.parse({
  id: 't2',
  name: 'to op',
  areas: ['a b'],
  slots: [{ id: 'a', role: 'hero' }, { id: 'b', role: 'standard' }],
});

// A real chain with one made-up layout, rather than a hand-built brand:
// the identity fields are not what is under test and a literal would
// have to be corrected every time the schema grows one.
const brand = Brand.parse({ ...getBrand('superbrugsen').brand, templates: [template] });

const offer = (over: Partial<Offer> & { id: string }): Offer => Offer.parse({
  name: `vare ${over.id}`,
  price: 19.95,
  quantity: { size: 1, unit: 'kg' },
  // A kilo of something prints its kilo price — see the price-marking check.
  comparison: { value: 19.95, unit: 'kg' },
  // Inside week 39 of 2026 (21.–27. september) unless a test says otherwise.
  validFrom: '2026-09-21',
  validTo: '2026-09-27',
  imageUrl: 'https://example.test/a.png',
  ...over,
});

/** One page, two cells, filled with whatever the test hands over. */
const doc = (offers: Offer[], filled = offers.map((o) => o.id)): CatalogDocument =>
  CatalogDocument.parse({
    id: 'c1',
    schemaVersion: 2,
    name: 'SuperBrugsen · uge 39',
    brandId: 'superbrugsen',
    week: WEEK,
    offers,
    pages: [{
      id: 'page-1',
      templateId: 't2',
      title: 'Fisk og brød',
      placements: filled.map((offerId, index) => ({
        slotId: ['a', 'b'][index] ?? 'a',
        offerId,
        overrides: {},
      })),
    }],
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  });

describe('readFindings', () => {
  it('says nothing about a page that is whole', () => {
    expect(readFindings(doc([offer({ id: '1' }), offer({ id: '2' })]), brand, WEEK))
      .toEqual([]);
  });

  it('names the product with no photograph, and where it is', () => {
    const found = readFindings(
      doc([offer({ id: '1', name: 'Änglamark', imageUrl: null }), offer({ id: '2' })]),
      brand,
      WEEK,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.said).toBe('Side 1: Änglamark har intet billede');
    expect(found[0]!.offerId).toBe('1');
    expect(found[0]!.pageId).toBe('page-1');
    expect(found[0]!.weight).toBe('stop');
  });

  it('counts the cells nobody filled', () => {
    const found = readFindings(doc([offer({ id: '1' })], ['1']), brand, WEEK);
    expect(found.map((finding) => finding.said)).toContain('Side 1: én plads er tom');
  });

  it('counts the products that never got a cell, as one line', () => {
    const document = doc([offer({ id: '1' }), offer({ id: '2' })], ['1']);
    const found = readFindings(document, brand, WEEK);
    const bench = found.find((finding) => finding.id === 'avis:reserve');
    expect(bench?.said).toBe('1 vare mangler en plads');
    expect(bench?.pageId).toBeNull();
  });

  it('does not bench a product that is inside a placed group', () => {
    const member = offer({ id: 'm1' });
    const group = offer({ id: 'g1', name: 'Frit valg', members: ['m1'] });
    const found = readFindings(doc([group, member], ['g1']), brand, WEEK);
    expect(found.some((finding) => finding.id === 'avis:reserve')).toBe(false);
  });

  it('asks a cluster about every member', () => {
    const one = offer({ id: 'm1' });
    const two = offer({ id: 'm2', imageUrl: null });
    const group = offer({ id: 'g1', name: 'Oste', members: ['m1', 'm2'] });
    const found = readFindings(doc([group, one, two], ['g1']), brand, WEEK);
    expect(found.map((f) => f.said)).toContain(
      'Side 1: vare m1 m.fl. mangler 1 af 2 billeder',
    );
  });

  it('says nothing about the week when nobody has chosen one', () => {
    const stale = offer({ id: '1', validFrom: '2026-09-07', validTo: '2026-09-13' });
    const found = readFindings(doc([stale, offer({ id: '2' })]), brand, null);
    expect(found.filter((f) => f.kind === 'uge')).toEqual([]);
  });

  it('reports a layout the chain does not have', () => {
    const document = doc([offer({ id: '1' }), offer({ id: '2' })]);
    const broken = { ...document, pages: [{ ...document.pages[0]!, templateId: 'væk' }] };
    const found = readFindings(broken, brand, WEEK);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('skabelon');
  });

  it('puts what stops a print above what is worth a look', () => {
    const document = doc(
      [offer({ id: '1', imageUrl: null }), offer({ id: '2' }), offer({ id: '3' })],
      ['1', '2'],
    );
    const found = readFindings({ ...document, pages: [{ ...document.pages[0]!, title: '' }] },
      brand, WEEK);
    expect(found[0]!.weight).toBe('stop');
    expect(found.at(-1)!.weight).toBe('se');
  });

  it('is empty without a document', () => {
    expect(readFindings(null, brand, WEEK)).toEqual([]);
  });
});

describe('price-marking rules', () => {
  it('stops a product sold by weight with no unit price', () => {
    const found = readFindings(doc([offer({ id: '1', comparison: null }), offer({ id: '2' })]), brand, WEEK);
    expect(found.map((f) => f.id)).toEqual(['page-1:1:enhedspris']);
  });

  it('asks about pant on a soft drink that does not mention it', () => {
    const cola = offer({ id: '1', name: 'Coca-Cola', description: '150 cl. Literpris 10,00.' });
    const found = readFindings(doc([cola, offer({ id: '2' })]), brand, WEEK);
    expect(found.map((f) => [f.id, f.weight])).toEqual([['page-1:1:pant', 'se']]);
    const paid = { ...cola, description: '150 cl. Literpris 10,00 + pant.' };
    expect(readFindings(doc([paid, offer({ id: '2' })]), brand, WEEK)).toEqual([]);
  });
});

describe('staleDates', () => {
  const week40 = { year: 2026, week: 40 }; // 28. september – 4. oktober

  it('flags a band carried over from an earlier week', () => {
    expect(staleDates('Gælder fra fredag d. 18. september til og med torsdag d. 24. september', week40))
      .toBe('18. september–24. september');
  });

  it('accepts a span that overlaps the week, and a lone date near it', () => {
    expect(staleDates('Gælder fra tirsdag d. 1. september til og med onsdag d. 30. september', week40)).toBeNull();
    expect(staleDates('Kun fredag d. 2. oktober', week40)).toBeNull();
    expect(staleDates('Kun i weekenden', week40)).toBeNull();
    expect(staleDates('Gælder t.o.m. 3/10', week40)).toBeNull();
    expect(staleDates('Gælder t.o.m. 20/9', week40)).toBe('20. september');
  });
});
