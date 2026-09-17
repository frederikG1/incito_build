import { describe, expect, it } from 'vitest';
import { groupOffers, Offer, OfferLabel } from '../offer.js';

/**
 * Several offers printed as one "frit valg" tile.
 *
 * Every assertion here is about the same thing: what a grouped tile is
 * allowed to claim. A single figure over goods that are not all that
 * price, an Ø-mark over a cheese that is not organic, or a weight that
 * describes one of six products are all things a shopper discovers
 * after they have bought, and none of them is a rounding error.
 */
/** A mark, with the artwork fields the dictionary normally fills in. */
const mark = (kind: OfferLabel['kind'], text: string): OfferLabel =>
  OfferLabel.parse({ kind, text });

const offer = (fields: Partial<Offer> & { id: string; name: string }): Offer => Offer.parse({
  price: 10,
  quantity: { size: null, unit: 'pcs', pieceCount: 1 },
  validFrom: '2026-09-14',
  validTo: '2026-09-20',
  ...fields,
});

const CHEESES = [
  offer({
    id: 'a',
    name: 'Klovborg skæreost',
    price: 79,
    category: 'Brød og mejeri',
    imageUrl: 'https://img.example/klovborg.jpg',
    comparison: { value: 79, unit: 'kg' },
    quantity: { size: 500, unit: 'g', pieceCount: 1 },
    labels: [mark('organic', 'Økologi')],
    validFrom: '2026-09-14',
    validTo: '2026-09-20',
  }),
  offer({
    id: 'b',
    name: 'Riberhus skiveost',
    price: 30,
    category: 'Brød og mejeri',
    imageUrl: 'https://img.example/riberhus.jpg',
    comparison: { value: 120, unit: 'kg' },
    quantity: { size: 250, unit: 'g', pieceCount: 1 },
    validFrom: '2026-09-15',
    validTo: '2026-09-19',
  }),
];

describe('several offers as one tile', () => {
  const group = groupOffers(CHEESES, 'group/p1/b');

  it('hands one offer straight back rather than dressing it up', () => {
    expect(groupOffers([CHEESES[0]!], 'group/p1/b')).toBe(CHEESES[0]);
  });

  /*
   * The lowest, and said out loud. "10,-" over a shelf where one of the
   * six is 79 is the kind of thing a shopper finds out at the till.
   */
  it('prints the lowest price and marks it as a from-price', () => {
    expect(group.price).toBe(30);
    expect(group.priceFrom).toBe(true);
  });

  it('does not mark a from-price when they genuinely all cost the same', () => {
    const same = groupOffers(
      [offer({ id: 'x', name: 'A', price: 10 }), offer({ id: 'y', name: 'B', price: 10 })],
      'g',
    );
    expect(same.priceFrom).toBe(false);
  });

  /*
   * The HIGHEST unit price, which is exactly what the chains' own
   * "Kg-pris maks. 120,00" means — and nothing at all when the members
   * are not quoted in the same unit.
   */
  it('quotes the worst unit price, which is what "maks." means', () => {
    expect(group.comparison).toEqual({ value: 120, unit: 'kg' });
  });

  it('drops the unit price when the members are not comparable', () => {
    const mixed = groupOffers([
      offer({ id: 'x', name: 'A', comparison: { value: 10, unit: 'kg' } }),
      offer({ id: 'y', name: 'B', comparison: { value: 10, unit: 'l' } }),
    ], 'g');
    expect(mixed.comparison).toBeNull();
  });

  it('keeps only the marks every member carries', () => {
    // One of the two is organic; the tile may not say the offer is.
    expect(group.labels).toEqual([]);
  });

  it('keeps a mark they all carry', () => {
    const organic = groupOffers([
      offer({ id: 'x', name: 'A', labels: [mark('organic', 'Økologi')] }),
      offer({ id: 'y', name: 'B', labels: [mark('organic', 'Økologi')] }),
    ], 'g');
    expect(organic.labels).toHaveLength(1);
  });

  it('states no weight when the members do not share one', () => {
    expect(group.quantity).toEqual({ size: null, unit: 'pcs', pieceCount: 1 });
  });

  /* The window in which they are ALL on offer, not the union of them. */
  it('runs only while every member is on offer', () => {
    expect(group.validFrom).toBe('2026-09-15');
    expect(group.validTo).toBe('2026-09-19');
  });

  it('photographs all of them, in order, without repeats', () => {
    expect(group.imagePack).toEqual([
      'https://img.example/klovborg.jpg',
      'https://img.example/riberhus.jpg',
    ]);
    expect(group.imageUrl).toBe('https://img.example/klovborg.jpg');
  });

  it('records what the price covers', () => {
    expect(group.members).toEqual(['a', 'b']);
  });

  it('keeps the category when they share one', () => {
    expect(group.category).toBe('Brød og mejeri');
  });

  describe('the headline it drafts', () => {
    it('joins two members with "eller", the way a leaflet sets them', () => {
      expect(group.name).toBe('Klovborg skæreost eller Riberhus skiveost');
    });

    it('uses the words they all begin with when there are more', () => {
      const thise = groupOffers([
        offer({ id: 'x', name: 'Thise økologisk skæreost' }),
        offer({ id: 'y', name: 'Thise økologisk burrata' }),
        offer({ id: 'z', name: 'Thise økologisk hytteost' }),
      ], 'g');
      expect(thise.name).toBe('Thise økologisk — flere varianter');
    });

    it('falls back to the first name when they share nothing', () => {
      const mixed = groupOffers([
        offer({ id: 'x', name: 'Klovborg skæreost' }),
        offer({ id: 'y', name: 'Riberhus skiveost' }),
        offer({ id: 'z', name: 'Puck' }),
      ], 'g');
      expect(mixed.name).toBe('Klovborg skæreost m.fl.');
    });
  });

  it('is an offer the schema accepts', () => {
    expect(() => Offer.parse(group)).not.toThrow();
  });
});
