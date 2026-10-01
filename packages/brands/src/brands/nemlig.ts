import { Brand } from '@incitio/schema';
import { template } from '../grid.js';
import { datafeedwatchNemlig, DATAFEEDWATCH_NEMLIG_SIGNATURE } from '../mappings/datafeedwatch-nemlig.js';
import type { BrandDefinition } from '../types.js';

/**
 * nemlig.com's page shapes.
 *
 * nemlig is a webshop brand with no printed catalogue to mine, so these
 * are authored rather than measured: an airy five-column grid on light
 * stock, generous margins, and no editorial bands. The one thing the
 * feed does dictate is density — 95% of its artwork is packshots on
 * white, which need room around them, so nothing here goes past eight.
 */
const TEMPLATES = [
  template('nemlig/row-3', 'Tre på række', [
    'a a b b c c',
    'a a b b c c',
  ], { a: 'standard', b: 'standard', c: 'standard' }),

  template('nemlig/hero-5', 'Fremhævet vare og fire', [
    'hero hero hero a a a',
    'hero hero hero b b b',
    'c    c    d    d e e',
  ], { hero: 'hero', a: 'standard', b: 'standard', c: 'standard', d: 'standard', e: 'standard' }),

  template('nemlig/grid-4', 'Fire felter', [
    'a a a b b b',
    'c c c d d d',
  ], { a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),

  template('nemlig/grid-6', 'Seks felter', [
    'a a b b c c',
    'd d e e f f',
  ], {
    a: 'standard', b: 'standard', c: 'standard',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  template('nemlig/grid-8', 'Otte felter', [
    'a a b b c c d d',
    'e e f f g g h h',
  ], {
    a: 'compact', b: 'compact', c: 'compact', d: 'compact',
    e: 'compact', f: 'compact', g: 'compact', h: 'compact',
  }),

  template('nemlig/duo-2', 'To fremhævede varer', [
    'a a a b b b',
  ], { a: 'hero', b: 'hero' }),

  template('nemlig/split-4', 'Fremhævet vare og tre', [
    'hero hero hero a a a',
    'hero hero hero b b c',
  ], { hero: ['hero', 1.08], a: 'standard', b: 'standard', c: 'standard' }),

  template('nemlig/band-6', 'Bånd øverst og fem under', [
    'band band band band band band',
    'a    a    b    b    c    c',
    'd    d    d    e    e    e',
  ], {
    band: 'feature', a: 'standard', b: 'standard',
    c: 'standard', d: 'standard', e: 'standard',
  }),

  template('nemlig/tower-5', 'Høj vare til venstre', [
    'lead lead a a b b',
    'lead lead c c d d',
  ], { lead: ['hero', 1.1], a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),
];

/**
 * nemlig.com, from their DataFeedWatch export (see
 * scripts/convert-feed-xml.mjs).
 *
 * Notable for being the feed with usable product photography: `RawImage`
 * is a 576px RGBA cutout with a real alpha channel, so products
 * composite onto any ground instead of arriving as a crop of someone
 * else's page.
 */
export const NEMLIG: BrandDefinition = {
  brand: Brand.parse({
    id: 'nemlig',
    name: 'nemlig.com',
    priceShape: 'plain',
    pageAspect: 0.707,
    logoUrl: null,
    language: 'Danish',
    tokens: {
      brand: '#e2001a',
      accent: '#ffe000',
      // Tinted paper rather than white: products sit on a ground, not in
      // cards, but nemlig prints far lighter than a discount chain.
      ground: '#fbf3e4',
      ink: '#1a1a1a',
      priceInk: '#e2001a',
      /*
       * Inter, and here it is not a placeholder.
       *
       * The other two chains named Inter because nobody had chosen
       * anything — and nothing loaded it, so all three printed in the
       * system fallback. nemlig is the one brand in this repo that is
       * a web shop rather than a printed book, and a neutral UI
       * grotesk is its actual register. Now it is loaded rather than
       * merely named.
       */
      headingFont: "'Inter', system-ui, sans-serif",
      bodyFont: "'Inter', system-ui, sans-serif",
    },
    templates: TEMPLATES,
  }),
  sources: [{
    id: 'datafeedwatch',
    name: 'DataFeedWatch-eksport',
    format: 'json',
    path: '/feeds/nemlig.json',
    signature: DATAFEEDWATCH_NEMLIG_SIGNATURE,
    mapping: datafeedwatchNemlig('nemlig', 'nemlig.json'),
  }],
};
