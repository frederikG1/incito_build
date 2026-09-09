import { z } from 'zod';

/**
 * Image references arrive as absolute URLs from hosted feeds and as
 * root-relative paths from exports meant to sit alongside an asset
 * bundle. Both are accepted; `javascript:` and other active schemes are
 * not, since this value is written straight into an <img src>.
 */
export const ImageRef = z.string().refine(
  (value) => {
    if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
    try {
      const scheme = new URL(value).protocol;
      return scheme === 'http:' || scheme === 'https:' || scheme === 'data:';
    } catch {
      return false;
    }
  },
  { message: 'must be an http(s)/data URL or a relative path' },
);

/**
 * A price label that must render verbatim on the tile — "Medlemspris",
 * "3 for 2", "Spar 20%". These are legally/commercially load-bearing, so
 * they are modelled as data rather than left to generated copy.
 */
export const OfferLabel = z.object({
  kind: z.enum(['member', 'multibuy', 'saving', 'new', 'organic', 'custom']),
  text: z.string().min(1),
  /**
   * Artwork for marks that retailers require to appear as the mark itself
   * — Økologi, Fairtrade, Nøglehul. Null means render `text` as a tag,
   * which stays the behaviour for every label that has no registered logo.
   */
  image: ImageRef.nullable().default(null),
  /** Light-background variant, when the dictionary registers one. */
  imageOnDark: ImageRef.nullable().default(null),
});
export type OfferLabel = z.infer<typeof OfferLabel>;
/**
 * The shape a producer supplies, before Zod fills the artwork defaults.
 * Feed mappings build labels by hand and should not have to spell out
 * `image: null` on every one.
 */
export type OfferLabelInput = z.input<typeof OfferLabel>;

/**
 * The unit a price is quoted in. Retail leaflets are legally required to
 * show a comparable unit price in most markets, so `comparison` is kept
 * separate from the headline `price` rather than derived at render time.
 */
export const Quantity = z.object({
  /** Numeric size, e.g. 0.5 for "0,5 l". Null when the offer is per-piece. */
  size: z.number().positive().nullable(),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'pcs', 'm', 'pack']),
  /** How many physical items the offer covers ("2 stk."). */
  pieceCount: z.number().int().positive().default(1),
});
export type Quantity = z.infer<typeof Quantity>;

export const ComparisonPrice = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(['kg', 'l', 'pcs', 'm']),
});
export type ComparisonPrice = z.infer<typeof ComparisonPrice>;

/**
 * One offer as it arrives from a retailer feed, after normalisation.
 * Every field a tile could conceivably render lives here; the layout
 * engine never reaches back to the raw feed.
 */
export const Offer = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  brand: z.string().default(''),
  category: z.string().default('uncategorised'),

  price: z.number().nonnegative(),
  /** Price before the discount, when the feed supplies one. */
  prePrice: z.number().nonnegative().nullable().default(null),
  savings: z.number().nonnegative().nullable().default(null),
  currency: z.string().length(3).default('DKK'),
  comparison: ComparisonPrice.nullable().default(null),

  quantity: Quantity,
  validFrom: z.string().date(),
  validTo: z.string().date(),

  imageUrl: ImageRef.nullable().default(null),
  labels: z.array(OfferLabel).default([]),

  /**
   * Editorial weight from the feed, 0..1, when the retailer already knows
   * which offers are the drivers. The planner may override it; absent a
   * value the layout engine derives one from discount depth.
   */
  priority: z.number().min(0).max(1).nullable().default(null),
});
export type Offer = z.infer<typeof Offer>;

export const OfferFeed = z.object({
  retailerId: z.string().min(1),
  sourceName: z.string().default(''),
  offers: z.array(Offer),
});
export type OfferFeed = z.infer<typeof OfferFeed>;
