import { Brand } from '@incitio/schema';
import { cmsGridTemplates } from '../grid.js';
import type { BrandDefinition } from '../types.js';

/**
 * Wolt Market.
 *
 * Read off its Tjek CMS setup (uge 16, staging): one national
 * publication whose sections are the feed's categories ("cohorts"), each
 * a Main design of five offers and an Overflow design for the rest. The
 * colours are the section designs' own — the dark green, the cream, the
 * Wolt blue — and the offer designs ship in `data/designs/wolt-cms.json`:
 * "Design 1" with a version per price type, its dark-mode twin and the
 * lifestyle "Design 2".
 *
 * Set in Omnes Bold for headings and prices and Roboto for text — the
 * faces its CMS config links.
 */
export const WOLT: BrandDefinition = {
  brand: Brand.parse({
    id: 'wolt',
    name: 'Wolt Market',
    priceShape: 'plain',
    pageAspect: 0.6,
    logoUrl: null,
    language: 'Danish',
    tokens: {
      brand: '#00c2e8',
      accent: '#0f3310',
      ground: '#f6f0e9',
      ink: '#0f3310',
      priceInk: '#0f3310',
      headingFont: "'Omnes', system-ui, sans-serif",
      bodyFont: "'Roboto', system-ui, sans-serif",
    },
    templates: cmsGridTemplates('wolt'),
  }),
  sources: [],
};
