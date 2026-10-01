import { Brand } from '@incitio/schema';
import { cmsGridTemplates } from '../grid.js';
import type { BrandDefinition } from '../types.js';

/**
 * Løvbjerg.
 *
 * Everything here is read off the chain's own Tjek CMS setup (uge 16–17,
 * staging), not drawn: the colours are the ones its section designs use
 * most — the yellow field and the two reds — and the offer designs ship
 * in `data/designs/loevbjerg-cms.json`, 76 of them, the list 17 of the
 * 18 store copies agree on. Pages are the CMS's offer grids.
 *
 * Every store has its own publication in the CMS; here they are one
 * avis with editions — see `@incitio/cms` and `npm run cms`.
 *
 * Set in Logical (Bold Monday): Heavy for headings and prices, Regular
 * for text — the faces its CMS config links.
 */
export const LOEVBJERG: BrandDefinition = {
  brand: Brand.parse({
    id: 'loevbjerg',
    name: 'Løvbjerg',
    priceShape: 'plain',
    pageAspect: 0.6,
    logoUrl: null,
    language: 'Danish',
    tokens: {
      brand: '#bd0e47',
      accent: '#fae200',
      ground: '#fae200',
      ink: '#000000',
      priceInk: '#ffffff',
      headingFont: "'Logical', system-ui, sans-serif",
      bodyFont: "'Logical', system-ui, sans-serif",
    },
    templates: cmsGridTemplates('loevbjerg'),
  }),
  sources: [],
};
