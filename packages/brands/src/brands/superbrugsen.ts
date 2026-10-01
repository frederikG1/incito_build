import { Brand } from '@incitio/schema';
import { template } from '../grid.js';
import { coopExport, COOP_EXPORT_SIGNATURE } from '../mappings/coop-export.js';
import { tjekOffers, tjekTransformed } from '../mappings/tjek.js';
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
  ], { hero: ['hero', 1.08], a: 'standard', b: 'standard' }),

  template('sb/stack-3', 'Stort produkt til højre', [
    'a hero hero hero',
    'a hero hero hero',
    'b hero hero hero',
  ], { hero: 'hero', a: 'standard', b: 'standard' }),

  template('sb/hero-4', 'Stort produkt og tre', [
    'hero hero hero b',
    'hero hero hero b',
    'a    a    c    c',
  ], { hero: ['hero', 1.12], a: 'standard', b: 'standard', c: 'standard' }),

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
  ], { hero: ['hero', 1.05], a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),

  template('sb/grid-6', 'Seks felter', [
    'a a b b',
    'c c d d',
    'e e f f',
  ], {
    a: 'standard', b: 'standard', c: 'standard',
    d: 'standard', e: 'standard', f: 'standard',
  }),

  /*
   * A second flat six-up, because one was not enough.
   *
   * Template choice now follows the offers: a page whose offers are all
   * of a weight gets a layout with no hero, and `sb/grid-6` was the
   * only one SuperBrugsen owned. Three consecutive level categories
   * therefore printed the identical page three times — the exact
   * failure the rotation memory exists to prevent, reached from the
   * other side. Same count and the same flat roles, a different shape:
   * three to a row rather than two, so the rhythm changes without
   * anything pretending to outrank anything.
   *
   * The cells are deliberately EQUAL. A first attempt varied their
   * widths — `d d d e e f` across the lower row — and equal roles in
   * unequal cells is the worst of both: `object-fit: contain` drew one
   * product four times the size of its neighbour while the type stayed
   * identical, so the page claimed a hierarchy the offers did not have.
   * A flat layout has to be flat in its geometry too.
   */
  template('sb/row-6', 'Tre og tre', [
    'a a b b c c',
    'a a b b c c',
    'd d e e f f',
    'd d e e f f',
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
    hero: ['hero', 1.05], a: 'compact', b: 'compact',
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
      /*
       * COOP — the chain's own face, not a match for it.
       *
       * This token used to name Nunito Sans, picked by eye off the
       * week-37 book and honest about being a stand-in. Coop supplied
       * the real thing (Elias Stenalt Werner / IDna Group, 2018), so
       * the guessing stops here.
       *
       * What proved it is the same file: set at the book's own size,
       * COOP breaks "Lotus Comfort toiletpapir / eller Premium
       * køkkenrulle" after `toiletpapir` and runs "613-736 g. Kg-pris
       * maks. 32,63." to within a pixel of the printed line's width.
       * A look-alike matches the letterforms; only the face itself
       * matches the line breaks.
       *
       * Two static weights — see the `@font-face` note in styles.css
       * for why 800 and 900 still land somewhere real.
       */
      headingFont: "'COOP', system-ui, sans-serif",
      bodyFont: "'COOP', system-ui, sans-serif",
      /*
       * The second half of a section heading, and the one thing a
       * single family could not express.
       *
       * The book sets "Krone" in the grotesk and "marked" in a red
       * marker script beside it, and puts a whole-page theme the same
       * way — "Festival" over "Stort udvalg til din fryser". Settled
       * against a zoom of both lines: upright rather than slanted, one
       * stroke weight throughout, rounded terminals, and a `g` whose
       * descender opens rather than loops. Caveat leans and thins at
       * the same size; Patrick Hand has the skeleton but ships no
       * weight axis, so it cannot be both a subtitle and a headline.
       *
       * A stand-in for Coop's licensed script, not that script. See
       * renderer/src/fonts/README.md.
       */
      scriptFont: "'Shantell Sans', 'COOP', system-ui, sans-serif",
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
    /*
     * The packshot file, not the week-37 one.
     *
     * Both are the same format and the same store, but week 37's
     * `images.zoom` are CROPS OF THE PRINTED PAGE — the URL carries
     * `x1r/y1r` coordinates into `p-21.webp` — so each one already
     * contains the chain's own price bubble and fine print. Opening
     * the editor on that sample shows every price twice and looks like
     * a rendering bug. It is still there to build from; it is just the
     * wrong thing to greet someone with.
     */
    path: '/feeds/superbrugsen-tjek.json',
    signature: { fields: ['heading', 'pricing', 'run_from'] },
    mapping: tjekOffers('superbrugsen', 'tilbud.json'),
  }, {
    id: 'coop-export',
    name: 'Coop tilbudsavis-eksport',
    format: 'json',
    path: '/feeds/SuperBrugsenW36.json',
    /*
     * The file the editor opens with.
     *
     * Its photographs are Republica motives — one product, trimmed,
     * on nothing — which is what a tile wants and what makes a group
     * of six read as six products. The `tjek` sample above is the same
     * store's offers with CROPS OF THE PRINTED PAGE for photographs,
     * so six of those in one cell read as six little leaflet pages.
     */
    sample: true,
    signature: COOP_EXPORT_SIGNATURE,
    mapping: coopExport('superbrugsen', 'SuperBrugsenW36.json'),
  }, {
    id: 'tjek-transformed',
    name: 'Tjek transformed offers',
    format: 'json',
    signature: { fields: ['membership_price', 'comment_label_1', 'valid_from'], nested: false },
    mapping: tjekTransformed('superbrugsen', 'transformed-offers.json'),
  }],
};
