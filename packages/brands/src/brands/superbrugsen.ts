import { Brand, type OfferLabelInput } from '@incitio/schema';
import { resolveLabels, type LabelDictionary } from '@incitio/ingest';
import { template } from '../grid.js';
import { tjekOffers } from '../tjek.js';
import type { BrandDefinition } from '../types.js';

/**
 * SuperBrugsen's page shapes, drawn from the week-37 catalogue.
 *
 * Where Netto is dense, SuperBrugsen is calm: four columns rather than
 * six, and two to eight offers a page. Several shapes at each count, on
 * purpose — the count fixes the template, so a chain with one layout
 * per count prints the same page over and over however cleverly the
 * pages were planned.
 */
const TEMPLATES = [
  template('sb/solo-2', 'Ét stort produkt og et bånd', [
    'hero hero hero hero',
    'hero hero hero hero',
    'hero hero hero hero',
    'band band band band',
  ], { hero: 'hero', band: 'feature' }),

  template('sb/duo-2', 'To store side om side', [
    'a a b b',
    'a a b b',
  ], { a: 'hero', b: 'hero' }),

  template('sb/hero-3', 'Stort produkt med to under', [
    'hero hero hero hero',
    'hero hero hero hero',
    'a    a    b    b',
  ], { hero: ['hero', 1.12], a: 'standard', b: 'standard' }),

  template('sb/stack-3', 'Stort produkt til højre', [
    'a hero hero hero',
    'a hero hero hero',
    'b hero hero hero',
  ], { hero: 'hero', a: 'standard', b: 'standard' }),

  template('sb/hero-4', 'Stort produkt og tre', [
    'hero hero hero b',
    'hero hero hero b',
    'a    a    c    c',
  ], { hero: ['hero', 1.16], a: 'standard', b: 'standard', c: 'standard' }),

  template('sb/grid-4', 'Fire lige felter', [
    'a a b b',
    'a a b b',
    'c c d d',
    'c c d d',
  ], { a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),

  template('sb/feature-5', 'Bånd øverst og fire under', [
    'band band band band',
    'a    a    b    b',
    'a    a    b    b',
    'c    c    d    d',
    'c    c    d    d',
  ], { band: 'feature', a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),

  template('sb/hero-5', 'Hovedvare øverst og fire under', [
    'hero hero hero hero',
    'hero hero hero hero',
    'a    a    b    b',
    'c    c    d    d',
  ], { hero: ['hero', 1.08], a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),

  template('sb/grid-6', 'Seks felter', [
    'a a b b',
    'c c d d',
    'e e f f',
  ], {
    a: 'standard', b: 'standard', c: 'standard',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  template('sb/lead-6', 'Hovedvare og fem mindre', [
    'hero hero hero b',
    'hero hero hero c',
    'a    d    e    e',
  ], {
    // The lead breaks out of its cell and prints over the row below —
    // the size difference is what says which offer carries the page.
    hero: ['hero', 1.08], a: 'compact', b: 'compact',
    c: 'compact', d: 'compact', e: 'standard',
  }),

  template('sb/grid-8', 'Otte felter', [
    'a a b b',
    'c c d d',
    'e e f f',
    'g g h h',
  ], {
    a: 'compact', b: 'compact', c: 'compact', d: 'compact',
    e: 'compact', f: 'compact', g: 'compact', h: 'compact',
  }),
];

/**
 * Republica's motive service, where SuperBrugsen's artwork lives.
 *
 * Taken from the chain's own offers transformer. `trim=1` is what makes
 * these usable on a coloured page field: the service returns the
 * packshot cropped to the product, so it drops onto the cream ground
 * without a white box around it.
 *
 * The key is necessarily visible to the browser — it fetches the images
 * — so this is not a secret leaking by living here.
 */
const REPUBLICA_KEY = 'k8kf7626waqu4p3scbegcqghay74a6q8';

function republicaImage(motivId: string): string {
  return `https://imageservice2.republica.dk/motive/${motivId}`
    + `?size=800&format=png&trim=1&key=${REPUBLICA_KEY}`;
}

/**
 * SuperBrugsen, from Coop's own tilbudsavis export.
 *
 * Identity sampled from the printed week-37 book, not guessed: the page
 * ground CHANGES from spread to spread while the petal motif over it
 * stays put, small offers carry a plain black numeral and the page's
 * lead carries a red disc, and Coop red is reserved for editorial
 * bands. An earlier version of this file claimed one cream ground
 * everywhere and a disc on every tile; both were wrong, and both were
 * settled by looking at the pages rather than by reasoning about them.
 */
export const SUPERBRUGSEN: BrandDefinition = {
  brand: Brand.parse({
    id: 'superbrugsen',
    name: 'SuperBrugsen',
    // Measured across the week-37 book: a small offer carries a plain
    // black numeral beside the product, and only the page's lead gets
    // the red disc. Discs on every tile filled the page with circles.
    priceShape: 'plain',
    leadPriceShape: 'disc',
    /*
     * The grounds SuperBrugsen rotates through, sampled from the page
     * margins of the week-37 book (`npm run refs -- --chain SuperBrugsen`).
     *
     * An earlier reading of this brand claimed one cream field on every
     * page. That was wrong, and looking at the printed book settles it:
     * the ground changes from spread to spread — pale yellow, teal,
     * blue, sage, sand, rose — while the petal motif over it never
     * changes. The motif tone is derived from whichever ground is in
     * play, so a new tint needs nothing else.
     */
    groundTints: [
      '#fff1b8',
      '#d8e8e7',
      '#fae0da',
      '#cedeb1',
      '#bad4e1',
      '#f4e3d0',
      '#eae0d6',
    ],
    groundPattern: 'petal',
    pageAspect: 0.707,
    logoUrl: null,
    language: 'Danish',
    tokens: {
      brand: '#e2001a',
      accent: '#ffe88a',
      ground: '#fff1b8',
      ink: '#1a1a1a',
      // The disc carries white; the plain numerals carry ink. See the
      // note on priceShape.
      priceInk: '#1a1a1a',
      headingFont: "'Inter', system-ui, sans-serif",
      bodyFont: "'Inter', system-ui, sans-serif",
    },
    templates: TEMPLATES,
  }),
  /*
   * Two formats, both real.
   *
   * A single store publishes through the Tjek offers API — a flat
   * array with structured pricing, quantity and photography — and that
   * is the one a shop actually hands over, so it leads. Coop's own
   * tilbudsavis export is richer editorially (it states variants and
   * certification marks) but arrives nested two levels down and only
   * for a whole campaign. An upload is matched to whichever reader
   * fits it; neither can read the other's file.
   */
  sources: [{
    id: 'tjek',
    name: 'Tjek offers API',
    format: 'json',
    path: '/feeds/superbrugsen-tjek-uge37.json',
    signature: { fields: ['heading', 'pricing', 'run_from'] },
    mapping: tjekOffers('superbrugsen', 'tilbud.json'),
  }, {
    id: 'coop-export',
    name: 'Coop tilbudsavis-eksport',
    format: 'json',
    path: '/feeds/SuperBrugsenW36.json',
    signature: { fields: ['Header', 'Motivid', 'Priority'], nested: true },
    mapping: {
      retailerId: 'superbrugsen',
      sourceName: 'SuperBrugsenW36.json',
      currency: 'DKK',
    // Offers live in Pages[].Entries[]; the page number rides along
    // because it is the chain's own editorial grouping.
    extractRows: (payload) => {
      const pages = (payload as { Pages?: unknown[] })?.Pages;
      if (!Array.isArray(pages)) return [];
      return pages.flatMap((page) => {
        const p = page as { PageNumber?: number; PageName?: string; Entries?: unknown[] };
        return (p.Entries ?? []).map((entry) => ({
          ...(entry as Record<string, unknown>),
          _pageNumber: p.PageNumber,
          _pageName: p.PageName,
        }));
      });
    },
    fields: {
      id: (row) => String(row['Id'] ?? '') || null,
      name: 'Header',
      brand: (row) => {
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        return (varer[0] as { BrandName?: string }).BrandName ?? null;
      },
      category: (row) => {
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        return (varer[0] as { CategoryName?: string }).CategoryName ?? null;
      },
      description: 'InfoTextVarebeskrivelse',
      price: 'Price',
      prePrice: 'NormalPrice',
      savings: 'Save',
      quantity: 'Quantity',
      validFrom: 'ValidDateFrom',
      validTo: 'ValidDateTo',
      /*
       * Artwork, via the motive id. The entry carries its own `Motivid`
       * and it matches `Varer[0].MotivId` on all 160 week-36 entries, so
       * the entry-level value is used and the first product is only a
       * fallback for a feed where it is missing.
       */
      imageUrl: (row) => {
        const own = String(row['Motivid'] ?? '').trim();
        if (own) return republicaImage(own);
        const varer = row['Varer'];
        if (!Array.isArray(varer) || varer.length === 0) return null;
        const first = String((varer[0] as { MotivId?: unknown }).MotivId ?? '').trim();
        return first ? republicaImage(first) : null;
      },
      /*
       * Every variant of the offer, for a "Frit valg" tile. 115 of the
       * 160 week-36 entries carry two or more distinct motives and 111 of
       * those are flagged "Frit valg" or "Flere varianter" — one price
       * covering several products. Rendering just the first would print a
       * tile that names three variants and shows one.
       */
      imagePack: (row) => {
        const varer = Array.isArray(row['Varer']) ? row['Varer'] : [];
        const ids = [
          String(row['Motivid'] ?? '').trim(),
          ...varer.map((v) => String((v as { MotivId?: unknown }).MotivId ?? '').trim()),
        ].filter(Boolean);
        return ids.map(republicaImage);
      },
      // Priority is inverse prominence: 2 is the big tile, 4 the small one.
      priority: (row) => {
        const value = Number(row['Priority']);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, (5 - value) / 3)) : null;
      },
      labels: (row: Record<string, unknown>, dictionary: LabelDictionary) => {
        const labels: OfferLabelInput[] = [];

        // `Logos` lists mark names — "Økologi", "Flag", "Bedre dyrevelfærd
        // 3" — and the shipped dictionary keys artwork off exactly those
        // strings. Resolving here turns the name into the mark itself and
        // collapses the several spellings of one certification.
        const logos = row['Logos'];
        if (Array.isArray(logos)) {
          labels.push(...resolveLabels(dictionary, logos.map((l) => String(l ?? ''))));
        }

        const free = String(row['InfoTextFritvalg'] ?? '').trim();
        if (free) labels.push({ kind: 'custom', text: free });
        const variants = String(row['InfoTextFlerevarianter'] ?? '').trim();
        if (variants) labels.push({ kind: 'custom', text: variants });
        if (Number(row['MemberPrice']) > 0) {
          labels.push({ kind: 'member', text: `Medlemspris ${row['MemberPrice']}` });
        }
        return labels;
      },
      },
    },
  }],
};
