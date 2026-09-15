import { describe, expect, it } from 'vitest';
import { ingestJson } from '@incitio/ingest';
import {
  tjekCategory, tjekFinePrint, tjekLabels, tjekOffers, tjekPack, tjekQuantity,
} from '../tjek.js';

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

describe('tjekLabels — certification marks', () => {
  /*
   * The bug this table was written for. Every "økologisk" in the
   * shipped feeds is in the HEADING — "Änglamark økologisk ingefær",
   * "San Pellegrino eller Änglamark økologisk sodavand" — and the rule
   * only ever read the description, so the Ø-mark never once appeared
   * on a page built from a Tjek feed.
   */
  it('reads a certification out of the product name', () => {
    const labels = tjekLabels('200 g. Kg-pris 70,00. 1 stk.', 'Änglamark økologisk ingefær');
    expect(labels.map((l) => l.text)).toContain('Økologisk');
  });

  it('reads the inflected forms Danish actually writes', () => {
    for (const product of ['Coop økologisk mælk', 'Änglamark økologiske grøntsager']) {
      expect(tjekLabels('', product).map((l) => l.text)).toContain('Økologisk');
    }
  });

  it('reads one out of the description too', () => {
    expect(tjekLabels('Økologisk. 1 liter.', 'Sødmælk').map((l) => l.text))
      .toContain('Økologisk');
  });

  /*
   * `text` is a dictionary key, not a display string, and the shipped
   * patterns are fully anchored — `(^økologi$)|(^økologisk$)`. A rule
   * that emitted "Øko" or "Økologi." would match nothing and the mark
   * would silently become a word. See `data/labels/tjek-labels.json`.
   */
  it('emits the exact string the label dictionary is keyed on', () => {
    for (const [product, key] of [
      ['Änglamark øko gulerødder', 'Økologisk'],
      ['Rugbrød med nøglehul', 'Nøglehul'],
      ['MSC torskefilet', 'MSC'],
      ['Svanemærket opvaskemiddel', 'Svanemærket'],
    ] as const) {
      expect(tjekLabels('', product).map((l) => l.text)).toContain(key);
    }
  });

  /*
   * A mark printed on a product that does not carry it is worse than a
   * missing one. "Dansk hvidkål" is a product name, not a declaration
   * that the Danish flag mark applies — and the flag is the commonest
   * mark in the chain's own `Logos` field, where it is STATED. Guessing
   * it from a name would put it on the wrong products and hide that it
   * was ever a guess.
   */
  it('does not infer the flag from a Danish-sounding name', () => {
    expect(tjekLabels('Danmark, kl. I. Stk.-pris 15,00.', 'Dansk hvidkål')
      .map((l) => l.text)).not.toContain('Flag');
  });

  it('does not tag a word that merely contains one', () => {
    // "økologi" inside "arkæologi", "øko" inside "økonomi".
    expect(tjekLabels('', 'Bog om arkæologi og økonomi').map((l) => l.text))
      .not.toContain('Økologisk');
  });

  it('puts the mark before the mechanic', () => {
    // The tile gives the row above the name to whatever comes first,
    // and a certification outranks "Frit valg" there.
    const labels = tjekLabels('Frit valg. 1 stk.', 'Änglamark økologisk mælk');
    expect(labels[0]?.text).toBe('Økologisk');
  });

  it('leaves a plain product alone', () => {
    expect(tjekLabels('500 g. Kg-pris 30,00.', 'Coop hakket oksekød')).toEqual([]);
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


describe('tjekPack', () => {
  /*
   * The line a leaflet prints directly above the price, because it is
   * what the number buys. The chain writes it as the last sentence of
   * the description.
   */
  it('reads the unit the price applies to', () => {
    for (const [description, pack] of [
      ['Danmark, kl. I. 1 kg. Kg-pris 12,00. 1 pose', '1 pose'],
      ['Polen, kl. I. 250 g. Kg-pris 88,00. 1 bakke', '1 bakke'],
      ['Udenlandske, kl. I. Bdt-pris 14,00. 1 bundt', '1 bundt'],
      ['70 cl. Literpris 141,43. Frit valg. 1 flaske', '1 flaske'],
      ['Udenlandsk, kl. I. Stk-pris 10,00. 1 stk.', '1 stk.'],
    ] as const) {
      expect(tjekPack(description)).toBe(pack);
    }
  });

  /*
   * A weight is not a unit. "1 kg" reads as the same shape of phrase and
   * means something else entirely — it belongs in the fine print, and
   * putting it over the price would answer "twelve kroner for what?"
   * with the wrong noun.
   */
  it('never mistakes a weight for a pack', () => {
    expect(tjekPack('Danmark, kl. I. 1 kg. Kg-pris 12,00.')).toBe('');
    expect(tjekPack('1 liter. Literpris 15,00.')).toBe('');
  });

  it('is empty when the chain does not say', () => {
    expect(tjekPack('90-175 g. Kg-pris maks. 133,33.')).toBe('');
    expect(tjekPack('')).toBe('');
  });
});
