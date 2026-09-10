import { describe, expect, it } from 'vitest';
import { ingestJson } from '@incitio/ingest';
import { tjekCategory, tjekFinePrint, tjekLabels, tjekOffers, tjekQuantity } from '../tjek.js';

describe('tjekQuantity', () => {
  /*
   * The load-bearing case. A range offer is quoted with a MAXIMUM unit
   * price, and a maximum is price over the SMALLEST pack: Taffel at
   * 12 kr over 90-175 g is printed as 133,33/kg, which is 12/0.090.
   * Taking the upper bound derives 68,57 — a figure the chain does not
   * stand behind.
   */
  it('takes the lower bound of a size range', () => {
    expect(tjekQuantity({
      unit: { symbol: 'g' }, size: { from: 90, to: 175 }, pieces: { from: 1, to: 1 },
    })).toEqual({ size: 90, unit: 'g', pieceCount: 1 });
  });

  it('takes the lower bound of a piece range', () => {
    // "15-18 x 33 cl" at 99 kr is printed as literpris maks. 20,00,
    // which is 99 / (15 × 0.33).
    expect(tjekQuantity({
      unit: { symbol: 'cl' }, size: { from: 33, to: 33 }, pieces: { from: 15, to: 18 },
    })).toEqual({ size: 330, unit: 'ml', pieceCount: 15 });
  });

  it('normalises centilitres and decilitres to millilitres', () => {
    expect(tjekQuantity({ unit: { symbol: 'cl' }, size: { from: 25, to: 25 } }).size).toBe(250);
    expect(tjekQuantity({ unit: { symbol: 'dl' }, size: { from: 5, to: 5 } }).size).toBe(500);
  });

  it('treats a piece unit as a count, not a size', () => {
    expect(tjekQuantity({
      unit: { symbol: 'pcs' }, size: { from: 1, to: 1 }, pieces: { from: 1, to: 1 },
    })).toEqual({ size: null, unit: 'pcs', pieceCount: 1 });
  });

  it('falls back rather than throwing on a shape it does not know', () => {
    expect(tjekQuantity(undefined)).toEqual({ size: null, unit: 'pcs', pieceCount: 1 });
    expect(tjekQuantity({ unit: { symbol: 'furlong' } }).unit).toBe('pcs');
  });
});

describe('tjekLabels', () => {
  it('lifts the chain\'s own phrases out of the description', () => {
    const labels = tjekLabels('Dybfrost. 465 ml. Literpris 96,77. Frit valg. 1 stk.');
    expect(labels.map((l) => l.text)).toEqual(['Frit valg', 'Dybfrost']);
  });

  it('prints one of "Frit valg" and "Flere varianter", not both', () => {
    // They say the same thing to a shopper, and a tile has room for one.
    const labels = tjekLabels('Flere varianter. 90-175 g. Frit valg. 1 pose.');
    expect(labels.map((l) => l.text)).toEqual(['Frit valg']);
  });

  it('keeps "Flere varianter" when it stands alone', () => {
    expect(tjekLabels('Flere varianter. 125 g.').map((l) => l.text)).toEqual(['Flere varianter']);
  });

  it('finds none in a plain description', () => {
    expect(tjekLabels('Danmark, kl. I. 500 g.')).toEqual([]);
  });
});

describe('tjekFinePrint', () => {
  /*
   * A tile that already shows "Frit valg." as a chip and "133,33 / kg"
   * as a comparison must not repeat both in its fine print.
   */
  it('drops what the tile already shows elsewhere', () => {
    expect(tjekFinePrint('Flere varianter. 90-175 g. Kg-pris maks. 133,33. Frit valg. 1 pose.'))
      .toBe('');
  });

  it('keeps the part a leaflet actually sets as fine print', () => {
    expect(tjekFinePrint('Danmark, kl. I. 500 g. Kg-pris 44,00. 1 bakke.'))
      .toBe('Danmark, kl. I');
  });

  it('keeps a genuine editorial note', () => {
    expect(tjekFinePrint('Sælges i hele forpakninger 15-pak 18-pak Flere varianter. 15-18 x 33 cl. Literpris maks. 20,00 + pant. Frit valg. 1 pakke. Begrænset parti.'))
      .toContain('Sælges i hele forpakninger');
  });
});

describe('tjekCategory', () => {
  /*
   * The payload's own `category_ids` is empty on every offer in both
   * real files, so without this the deterministic planner produces one
   * section called "Uncategorised".
   */
  it('classifies from the heading', () => {
    expect(tjekCategory('Carlsberg eller Tuborg øl', '')).toBe('Øl og vin');
    expect(tjekCategory('Mammen laktosefri hytteost', '')).toBe('Mejeri');
    expect(tjekCategory('Blommer fra Fejø', '')).toBe('Frugt og grønt');
  });

  it('has a bucket for what it cannot place', () => {
    expect(tjekCategory('Vælg mellem flere forskellige varianter', '')).toBe('Øvrige tilbud');
  });
});

describe('the Tjek reader end to end', () => {
  const feed = JSON.stringify([{
    id: 'o4Tt',
    heading: 'Taffel chips eller nødder',
    description: 'Flere varianter. 90-175 g. Kg-pris maks. 133,33. Frit valg. 1 pose',
    catalog_page: 4,
    pricing: { price: 12, pre_price: null, currency: 'DKK' },
    quantity: {
      unit: { symbol: 'g', si: { symbol: 'kg', factor: 0.001 } },
      size: { from: 90, to: 175 },
      pieces: { from: 1, to: 1 },
    },
    images: { thumb: 'https://x/t.jpg', view: 'https://x/v.jpg', zoom: 'https://x/z.jpg' },
    run_from: '2026-08-31T22:00:00+0000',
    run_till: '2026-09-30T21:59:59+0000',
  }]);

  const { feed: result, issues } = ingestJson(feed, tjekOffers('superbrugsen', 'tilbud.json'));
  const offer = result.offers[0]!;

  it('reads the whole record without losing a row', () => {
    expect(issues).toEqual([]);
    expect(result.offers).toHaveLength(1);
  });

  it('derives the unit price the chain prints', () => {
    // The description says "Kg-pris maks. 133,33"; the derivation has
    // to land on the same number, or the page contradicts the feed.
    expect(offer.comparison).toEqual({ value: 133.33, unit: 'kg' });
  });

  it('takes the largest available render for print', () => {
    expect(offer.imageUrl).toBe('https://x/z.jpg');
  });

  it('reads the offset-form dates', () => {
    expect(offer.validFrom).toBe('2026-08-31');
    expect(offer.validTo).toBe('2026-09-30');
  });

  it('uses the page it ran on as editorial weight', () => {
    // A chain puts its drivers up front, so page 4 outranks page 30.
    expect(offer.priority).toBeGreaterThan(0.8);
  });

  it('does not repeat the chips in the fine print', () => {
    expect(offer.labels.map((l) => l.text)).toEqual(['Frit valg']);
    expect(offer.description).toBe('');
  });
});
