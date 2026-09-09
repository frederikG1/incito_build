import { describe, expect, it } from 'vitest';
import { normalizeRows, type FieldMapping } from '../mapping.js';

const MAPPING: FieldMapping = {
  retailerId: 'test',
  fields: {
    id: 'id',
    name: 'navn',
    price: 'pris',
    prePrice: 'foerpris',
    quantity: 'maengde',
    validFrom: 'fra',
    validTo: 'til',
  },
};

const base = { id: '1', navn: 'Mælk', pris: '9,95', fra: '14-09-2026', til: '20-09-2026' };

describe('normalizeRows', () => {
  it('keeps good rows and reports bad ones instead of throwing', () => {
    const { feed, issues } = normalizeRows(
      [base, { ...base, id: '2', pris: 'ugyldig' }, { ...base, id: '3' }],
      MAPPING,
    );
    expect(feed.offers.map((o) => o.id)).toEqual(['1', '3']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ offerId: '2', reason: 'unparseable price' });
  });

  it('skips duplicate ids', () => {
    const { feed, issues } = normalizeRows([base, base], MAPPING);
    expect(feed.offers).toHaveLength(1);
    expect(issues[0]?.reason).toContain('duplicate');
  });

  it('derives savings from a pre-price when the feed omits them', () => {
    const { feed } = normalizeRows([{ ...base, foerpris: '12,95' }], MAPPING);
    expect(feed.offers[0]?.savings).toBe(3);
  });

  it('does not invent savings when the pre-price is not higher', () => {
    const { feed } = normalizeRows([{ ...base, foerpris: '8,00' }], MAPPING);
    expect(feed.offers[0]?.savings).toBeNull();
  });

  // Unit price is a legal requirement in most retail markets, so getting
  // the scale conversions right is not a nicety.
  it('computes the unit price in kilos for a gram quantity', () => {
    const { feed } = normalizeRows([{ ...base, pris: '18,00', maengde: '500 g' }], MAPPING);
    expect(feed.offers[0]?.comparison).toEqual({ value: 36, unit: 'kg' });
  });

  it('accounts for the piece count in a multipack unit price', () => {
    const { feed } = normalizeRows([{ ...base, pris: '49,00', maengde: '6 x 33 cl' }], MAPPING);
    // 6 x 330 ml = 1.98 l, so 49 / 1.98 = 24.75 per litre.
    expect(feed.offers[0]?.comparison).toEqual({ value: 24.75, unit: 'l' });
  });

  it('leaves the unit price null when quantity is per-piece', () => {
    const { feed } = normalizeRows([{ ...base, maengde: '1 stk.' }], MAPPING);
    expect(feed.offers[0]?.comparison).toBeNull();
  });

  it('reports rows missing an id without dropping the rest', () => {
    const { feed, issues } = normalizeRows([{ ...base, id: '' }, { ...base, id: '9' }], MAPPING);
    expect(feed.offers).toHaveLength(1);
    expect(issues[0]?.reason).toBe('missing id');
  });
});
