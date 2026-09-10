import { Brand, type OfferLabelInput } from '@incitio/schema';
import { resolveLabels, type LabelAliases, type LabelDictionary } from '@incitio/ingest';
import { template } from '../grid.js';
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
  ], { hero: ['hero', 1.12], a: 'standard', b: 'standard', c: 'standard' }),

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
  ], { lead: ['hero', 1.14], a: 'standard', b: 'standard', c: 'standard', d: 'standard' }),
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
    signature: { fields: ['ProductSku', 'CampaignPriceDK01'] },
    mapping: {
      retailerId: 'nemlig',
      sourceName: 'nemlig.json',
      currency: 'DKK',
      fields: {
      id: 'ProductSku',
      // The feed writes a ready-made offer headline; prefer it over the
      // bare product name, which omits the brand. It is built as
      // "<product> fra <brand>", so a row with no brand arrives with a
      // dangling "fra" that has to be trimmed.
      name: (row) => {
        const headline = String(row['NewOfferTitle_Single'] ?? '').trim();
        const cleaned = headline.replace(/\s+fra\s*$/i, '').trim();
        return cleaned || String(row['ProductName'] ?? '').trim() || null;
      },
      brand: 'ProductBrandName',
      category: ['NewMainCategory', 'MainCategory'],
      // No description: ProductPaidMediaDescription is the quantity line
      // ("8 stk. / 13,5cl") and using it for both renders it twice. The
      // feed's `Description` is a keyword soup, not display copy.
      description: () => null,
      // CampaignPrice is what the customer pays; Price is the before.
      price: ['CampaignPriceDK01', 'Price'],
      prePrice: (row) => {
        const before = Number(String(row['Price'] ?? '').replace(',', '.'));
        const now = Number(String(row['CampaignPriceDK01'] ?? '').replace(',', '.'));
        return Number.isFinite(before) && Number.isFinite(now) && before > now ? before : null;
      },
      savings: 'CampaignCustomerSavingsDK01',
      quantity: 'ProductPaidMediaDescription',
      validFrom: 'CampaignStart',
      validTo: 'CampaignEnd',
      // RawImage is the transparent cutout; the Destination URL is a
      // padded JPEG on white and only a fallback.
      imageUrl: ['RawImage', 'DestinationImageUrlDepend'],
        priority: (row: Record<string, unknown>) =>
          CAMPAIGN_WEIGHT[String(row['CampaignTypeDK01'] ?? '')] ?? null,
        labels: nemligLabels,
      },
    },
  }],
};

/**
 * nemlig grades every offer by campaign tier. That is editorial weight
 * stated by the chain, so it is used directly rather than deriving
 * prominence from discount depth.
 */
const CAMPAIGN_WEIGHT: Record<string, number> = {
  'Prioriterede tilbud': 0.9,
  'Priskup': 0.75,
  'Skarp Pris': 0.6,
  'Kategoritilbud (kampagne)': 0.45,
  'Restsalg': 0.3,
};

/**
 * nemlig's own wording for marks the dictionary already holds. Its feed
 * writes the full Danish name ("Nøglehulsmærket") where the dictionary
 * is filed under the short form, and splits organic into origin variants
 * that share one mark.
 */
const NEMLIG_LABEL_ALIASES: LabelAliases = {
  'Øko (dansk)': 'organic',
  'Øko (europæisk)': 'organic',
  'Økologisk': 'organic',
  'Nøglehulsmærket': 'noglehul',
  'Fuldkornsmærket': 'fuldkorn',
  'Fairtrade-mærket': 'fairtrade',
  'MSC-mærket': 'msc',
  'ASC-mærket': 'asc',
  'Astma-Allergi Danmark': 'astmaforeningen',
  'Vegansk': 'vegan eu',
  'Dybfrost': 'dybfrost',
};

function nemligLabels(
  row: Record<string, unknown>,
  dictionary: LabelDictionary,
): OfferLabelInput[] {
  const labels: OfferLabelInput[] = [];
  const text = (key: string) => String(row[key] ?? '').trim();

  const minQuantity = Number(text('MinQuantity'));
  if (Number.isFinite(minQuantity) && minQuantity > 1) {
    // The "Depend" field holds a complete Danish offer phrase — "Mix 3
    // stk 89.00", "Ta' 2 for 40.00" — not a bare number, so it is used
    // verbatim. Prefixing it produces "2 for Ta' 2 for 40.00".
    const phrase = text('CampaignPriceDependDK01');
    const plainPrice = text('CampaignPriceDK01');
    if (phrase) {
      labels.push({ kind: 'multibuy', text: phrase });
    } else if (plainPrice) {
      labels.push({ kind: 'multibuy', text: `${minQuantity} for ${plainPrice}` });
    }
  }
  if (text('BuyXforYFlag') === 'True') {
    labels.push({ kind: 'multibuy', text: 'Køb X få Y' });
  }

  const splat = text('SaleSplatPriceTextDK01');
  const percent = text('CampaignSaleSplatPriceSavingsDK01');
  if (splat && percent) labels.push({ kind: 'saving', text: `${splat} ${percent}` });

  // Markings is a certification list. Resolving it turns "Øko (dansk)"
  // from a text tag into the Ø-mark itself, and collapses the several
  // spellings of one certification into a single badge.
  labels.push(
    ...resolveLabels(dictionary, text('Markings').split(/[,;|]/), NEMLIG_LABEL_ALIASES),
  );
  if (text('Fritvalg_Flerevarianter')) {
    labels.push({ kind: 'custom', text: text('Fritvalg_Flerevarianter') });
  }
  return labels;
}
