import { Brand } from '@incitio/schema';
import { template } from '../grid.js';
import { classifyLabels } from '../labels.js';
import type { BrandDefinition } from '../types.js';

/**
 * Netto's page shapes, drawn from the week-38 catalogue.
 *
 * Netto pages are dense and asymmetric: products sit directly on the
 * yellow field with no card behind them, sizes vary within a page, and
 * a page routinely carries a wide banner claim across the top or foot.
 * The templates below give the composer that vocabulary — a six-column
 * grid, uneven splits, and one banner slot per shape that has one.
 */
const TEMPLATES = [
  template('netto/split-4', 'Fire lige felter', [
    'a a a b b b',
    'a a a b b b',
    'c c c d d d',
    'c c c d d d',
  ], { a: 'hero', b: 'standard', c: 'standard', d: 'standard' }),

  template('netto/hero-5', 'Stort produkt med fire', [
    'hero hero hero hero b b',
    'hero hero hero hero b b',
    'hero hero hero hero c c',
    'd    d    d    e    e e',
  ], { hero: ['hero', 1.14], b: 'standard', c: 'standard', d: 'standard', e: 'standard' }),

  template('netto/grid-6', 'Seks felter', [
    'a a b b c c',
    'a a b b c c',
    'd d e e f f',
    'd d e e f f',
  ], {
    a: 'standard', b: 'standard', c: 'standard',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  template('netto/band-7', 'Bånd øverst og seks under', [
    'feat feat feat feat feat feat',
    'a    a    b    b    c    c',
    'a    a    b    b    c    c',
    'd    d    e    e    f    f',
    'd    d    e    e    f    f',
  ], {
    feat: 'feature',
    a: 'standard', b: 'standard', c: 'standard',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  template('netto/dense-9', 'Ni felter, tæt', [
    'a a b b c c',
    'd d e e f f',
    'g g h h i i',
  ], {
    a: 'compact', b: 'compact', c: 'compact',
    d: 'compact', e: 'compact', f: 'compact',
    g: 'compact', h: 'compact', i: 'compact',
  }),

  template('netto/duo-3', 'To store og et bånd', [
    'a a a b b b',
    'a a a b b b',
    'a a a b b b',
    'c c c c c c',
  ], { a: ['hero', 1.12], b: 'standard', c: 'feature' }),

  template('netto/stack-4', 'Hovedvare til højre', [
    'a a hero hero hero hero',
    'b b hero hero hero hero',
    'c c hero hero hero hero',
  ], { hero: ['hero', 1.16], a: 'standard', b: 'standard', c: 'standard' }),

  template('netto/wide-5', 'Bred øverst, tre under', [
    'top  top  top  top  b b',
    'top  top  top  top  b b',
    'c    c    d    d    e e',
  ], { top: 'hero', b: 'standard', c: 'standard', d: 'standard', e: 'standard' }),

  template('netto/mix-6', 'Blandede størrelser', [
    'hero hero hero b b c',
    'hero hero hero b b c',
    'd    d    e    e f f',
  ], {
    hero: ['hero', 1.14], b: 'standard', c: 'compact',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  template('netto/column-7', 'Søjle til venstre', [
    'lead lead a a b b',
    'lead lead c c d d',
    'e    e    f f g g',
  ], {
    lead: ['hero', 1.14], a: 'compact', b: 'compact', c: 'compact',
    d: 'compact', e: 'standard', f: 'standard', g: 'standard',
  }),

  template('netto/grid-9b', 'Ni felter med bånd', [
    'a a b b c c',
    'd d e e f f',
    'g g g h h h',
  ], {
    a: 'compact', b: 'compact', c: 'compact',
    d: 'compact', e: 'compact', f: 'compact',
    g: 'standard', h: 'standard',
  }),
];

/**
 * Netto.
 *
 * The identity is measured off the printed catalogue, not guessed: one
 * saturated yellow field on every offer page, product photography
 * dropped straight onto it with no frame, and prices set as black
 * rounded tags carrying yellow numerals. Getting the tag wrong is what
 * makes a Netto page read as somebody else's.
 *
 * NOTE ON DATA: Netto has no offer feed in this repo, so the brand is
 * wired to the synthetic sample CSV. The layouts and identity are real;
 * the products are placeholders with drawn SVG artwork, and the display
 * name says so rather than letting a demo pass for a live catalogue.
 */
export const NETTO: BrandDefinition = {
  brand: Brand.parse({
    id: 'netto',
    name: 'Netto — demofeed, syntetiske billeder',
    priceShape: 'tag',
    pageAspect: 0.707,
    logoUrl: null,
    language: 'Danish',
    tokens: {
      brand: '#e2001a',
      accent: '#ffdd00',
      ground: '#ffdd00',
      ink: '#111111',
      // Netto sets the number in yellow inside a black tag, which is the
      // inverse of every other chain here and the whole visual signature.
      priceInk: '#ffdd00',
      headingFont: "'Inter', system-ui, sans-serif",
      bodyFont: "'Inter', system-ui, sans-serif",
    },
    templates: TEMPLATES,
  }),
  sources: [{
    id: 'demo-csv',
    name: 'Demo-CSV',
    format: 'csv',
    path: '/feeds/sample-offers.csv',
    signature: { fields: ['artikelnr', 'varenavn', 'pris'] },
    mapping: {
      retailerId: 'netto',
      sourceName: 'sample-offers.csv',
      currency: 'DKK',
      fields: {
        id: 'artikelnr',
        name: 'varenavn',
        brand: 'maerke',
        category: 'kategori',
        description: 'beskrivelse',
        price: 'pris',
        prePrice: 'foerpris',
        quantity: 'maengde',
        validFrom: 'gyldig_fra',
        validTo: 'gyldig_til',
        imageUrl: 'billede',
        labels: (row: Record<string, unknown>) =>
          classifyLabels(String(row['etiketter'] ?? '')),
      },
    },
  }],
};
