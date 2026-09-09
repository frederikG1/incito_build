import { resolveLabels, type FieldMapping, type LabelAliases, type LabelDictionary } from '@incitio/ingest';
import type { OfferLabelInput, Theme } from '@incitio/schema';

/**
 * Everything that is specific to one retailer: how to read their feed and
 * how their pages should look. Onboarding a retailer is meant to be one
 * entry here and nothing else.
 */
export interface RetailerConfig {
  id: string;
  displayName: string;
  mapping: FieldMapping;
  theme: Theme;
  pageAspect: number;
  /** Path the studio fetches the feed from, relative to the static root. */
  feedPath: string;
  feedFormat: 'csv' | 'json';
  /**
   * How many offers the finished catalog should carry. Omit when the feed
   * is already curated to catalog size; set it when the feed is a full
   * product range that has to be cut down.
   */
  targetOfferCount?: number;
  /**
   * This retailer's own mined template library, under data/templates/.
   * SuperBrugsen does not want Netto's layouts, so a chain with its own
   * back catalogue gets its own house style; one without falls back to
   * the pooled library.
   */
  houseLibrary?: string;
}

/**
 * Feeds ship label text as an opaque delimited string. The kind is
 * inferred so the tile can colour it, while the original wording is kept
 * verbatim — retailers are particular about that, and some of it is
 * legally fixed phrasing that must not be reworded.
 */
export function classifyLabels(raw: string, separator = '|'): OfferLabelInput[] {
  return raw
    .split(separator)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const lower = text.toLowerCase();
      if (lower.includes('medlem')) return { kind: 'member' as const, text };
      if (/\d\s*for\s*\d/.test(lower)) return { kind: 'multibuy' as const, text };
      if (lower.includes('spar')) return { kind: 'saving' as const, text };
      if (lower.includes('øko')) return { kind: 'organic' as const, text };
      if (lower.startsWith('ny')) return { kind: 'new' as const, text };
      return { kind: 'custom' as const, text };
    });
}

const DEFAULT_THEME: Theme = {
  name: 'Sample',
  brandColor: '#c8102e',
  accentColor: '#ffd200',
  pageBackground: '#ffffff',
  textColor: '#1a1a1a',
  headingFont: "'Inter', system-ui, sans-serif",
  bodyFont: "'Inter', system-ui, sans-serif",
  logoUrl: null,
};

/**
 * Scaffolding from before any real feed existed. Its "products" are
 * generated SVG silhouettes, not photography — the name says so, because
 * "Ugens tilbud" sitting next to "Ugens tilbud hos nemlig.com" invited
 * exactly the confusion of thinking the fake one had failed to load real
 * images.
 */
export const SAMPLE_RETAILER: RetailerConfig = {
  id: 'sample',
  displayName: 'Demo — syntetiske billeder (ikke rigtige fotos)',
  pageAspect: 0.707,
  feedPath: '/feeds/sample-offers.csv',
  feedFormat: 'csv',
  theme: DEFAULT_THEME,
  mapping: {
    retailerId: 'sample',
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
      labels: (row) => classifyLabels(String(row['etiketter'] ?? '')),
    },
  },
};

/**
 * nemlig.com, from their DataFeedWatch export (see
 * scripts/convert-feed-xml.mjs). Notable for being the first real feed
 * with usable product photography: `RawImage` is a 576px RGBA cutout
 * with a real alpha channel, so products can be composited into any tile
 * instead of arriving as a crop of someone else's page.
 */
export const NEMLIG_RETAILER: RetailerConfig = {
  id: 'nemlig',
  displayName: 'nemlig.com — rigtige produktfotos',
  pageAspect: 0.707,
  feedPath: '/feeds/nemlig.json',
  feedFormat: 'json',
  // The feed is nemlig's whole campaign range. A leaflet publishes a
  // fraction of it — SuperBrugsen runs 160 offers over 40 pages.
  targetOfferCount: 160,
  theme: {
    ...DEFAULT_THEME,
    name: 'nemlig',
    brandColor: '#e2001a',
    accentColor: '#ffe000',
  },
  mapping: {
    retailerId: 'nemlig',
    sourceName: 'nemlig.json',
    currency: 'DKK',
    fields: {
      id: 'ProductSku',
      // The feed writes a ready-made offer headline; prefer it over the
      // bare product name, which omits the brand. The headline is built as
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
      // ("8 stk. / 13,5cl"), and using it for both renders it twice.
      // The feed's `Description` is a keyword soup, not display copy.
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
      priority: (row) => CAMPAIGN_WEIGHT[String(row['CampaignTypeDK01'] ?? '')] ?? null,
      labels: nemligLabels,
    },
  },
};

/**
 * nemlig grades every offer by campaign tier. That is editorial weight
 * stated by the retailer, so it is used directly rather than deriving
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
 * writes the full Danish name ("Nøglehulsmærket") where the dictionary is
 * filed under the short form, and splits organic into origin variants
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
    // verbatim. Retailers are particular about this wording and some of
    // it is legally fixed; prefixing it produces "2 for Ta' 2 for 40.00".
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

  // nemlig's Markings column is a certification list. Resolving it against
  // the label dictionary turns "Øko (dansk)" from a text tag into the Ø-mark
  // itself, and collapses the several spellings of one certification into a
  // single badge — the feed lists Danish and European organic separately,
  // and a tile carrying both says the same thing twice.
  labels.push(
    ...resolveLabels(dictionary, text('Markings').split(/[,;|]/), NEMLIG_LABEL_ALIASES),
  );
  if (text('Fritvalg_Flerevarianter')) {
    labels.push({ kind: 'custom', text: text('Fritvalg_Flerevarianter') });
  }
  return labels;
}

/**
 * SuperBrugsen, from Coop's own tilbudsavis export.
 *
 * The richest feed so far editorially: it states which page each offer ran
 * on, how prominent it was (`Priority` 2 = large, 4 = small — verified
 * against hotspot areas from the same week), and whether its artwork is a
 * packshot or a lifestyle shot (`MotivType`). It carries no image URLs at
 * all, though, so tiles render without photography until `Motivid`
 * resolves to somewhere.
 */
export const SUPERBRUGSEN_RETAILER: RetailerConfig = {
  id: 'superbrugsen',
  displayName: 'SuperBrugsen — uge 36 (uden billeder)',
  pageAspect: 0.707,
  feedPath: '/feeds/SuperBrugsenW36.json',
  feedFormat: 'json',
  // 52 templates at 3-10 slots, mined from 63 of SuperBrugsen's own pages.
  houseLibrary: '/templates/house/superbrugsen.json',
  theme: { ...DEFAULT_THEME, name: 'SuperBrugsen', brandColor: '#e30613', accentColor: '#ffe600' },
  mapping: {
    retailerId: 'superbrugsen',
    sourceName: 'SuperBrugsenW36.json',
    currency: 'DKK',
    // Offers live in Pages[].Entries[]; the page number rides along
    // because it is the retailer's own editorial grouping.
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
      // Priority is inverse prominence: 2 is the big tile, 4 the small one.
      priority: (row) => {
        const value = Number(row['Priority']);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, (5 - value) / 3)) : null;
      },
      labels: (row) => {
        const labels: OfferLabelInput[] = [];
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
};

export const RETAILERS: Record<string, RetailerConfig> = {
  [SAMPLE_RETAILER.id]: SAMPLE_RETAILER,
  [NEMLIG_RETAILER.id]: NEMLIG_RETAILER,
  [SUPERBRUGSEN_RETAILER.id]: SUPERBRUGSEN_RETAILER,
};
