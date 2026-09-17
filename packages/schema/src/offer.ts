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
  /**
   * Whether this price is the LOWEST of several, not the only one.
   *
   * A "frit valg" offer is normally one price covering every product in
   * it, and that is the only reason a leaflet may print one number over
   * a row of six bottles. Where a feed says the products differ, the
   * number has to be printed as "fra 49,-" — a single figure over goods
   * that are not all that price is the kind of thing a shopper discovers
   * at the till, and it is the chain's name on the page.
   *
   * Defaults to false and stays false unless a feed states otherwise.
   * Neither shipped feed does today: both give one `price` per offer and
   * express variation in the SAVING instead — see `savingsMax`.
   */
  priceFrom: z.boolean().default(false),
  /** Price before the discount, when the feed supplies one. */
  prePrice: z.number().nonnegative().nullable().default(null),
  /**
   * What is saved, and the LOW end of it when the products differ.
   *
   * Paired with `savingsMax`. The chain's own export carries "Spar
   * 29,95 - 49,95" on an offer of two wines that had different normal
   * prices, and printing only the first number tells a shopper holding
   * the other bottle something untrue about their own purchase. Both
   * ends or neither.
   */
  savings: z.number().nonnegative().nullable().default(null),
  /** The high end, when the saving is a range. Null when it is one figure. */
  savingsMax: z.number().nonnegative().nullable().default(null),
  currency: z.string().length(3).default('DKK'),
  comparison: ComparisonPrice.nullable().default(null),

  quantity: Quantity,
  /**
   * What one unit of this offer IS, in the chain's own words.
   *
   * "1 pose", "1 bakke", "1 bundt", "1 flaske/dåse". Not the weight —
   * that is `quantity` and it belongs in the fine print. This is the
   * line a printed leaflet sets immediately above the price, because it
   * is what the number applies to, and a price with no unit over a
   * photograph of six bottles is ambiguous in the one direction that
   * matters.
   *
   * Empty when the feed does not say. Never derived from the weight: the
   * word is editorial and only the chain knows whether its carrots come
   * in a pose or a net.
   */
  pack: z.string().default(''),
  validFrom: z.string().date(),
  validTo: z.string().date(),

  imageUrl: ImageRef.nullable().default(null),
  /**
   * Every variant of this one offer, for a tile that shows them together.
   *
   * "Frit valg" and "Flere varianter" offers are one price covering
   * several products, and published leaflets print them as a cluster in a
   * single tile rather than picking one at random: 85% of the mined
   * grocery tiles carry two or more images, and 72% of SuperBrugsen's
   * offers supply two or more motives. Ordered as the feed gave them, the
   * first being the one `imageUrl` also points at.
   *
   * Empty or single-entry means an ordinary one-product tile — the
   * renderer falls back to `imageUrl`, so a feed without variants needs
   * no special handling.
   */
  imagePack: z.array(ImageRef).max(8).default([]),
  labels: z.array(OfferLabel).default([]),

  /**
   * Editorial weight from the feed, 0..1, when the retailer already knows
   * which offers are the drivers. The planner may override it; absent a
   * value the layout engine derives one from discount depth.
   */
  priority: z.number().min(0).max(1).nullable().default(null),

  /**
   * The offers this one was assembled from, when somebody assembled it.
   *
   * A printed leaflet does not give every product a cell. It groups: one
   * price, one headline, six cheeses photographed together, "frit valg"
   * in the fine print. That is an editorial act — the editor picked
   * those six — and it is the only way to put new products on a page
   * whose layout is already decided, because the alternative is to
   * change the layout.
   *
   * Empty on everything that came out of a feed, which is the point: a
   * grouped offer is not a feed record and must not be mistaken for
   * one. What is in here is exactly what a reader is being told the
   * price covers, so it is also what an editor gets to see and undo.
   *
   * Defaulted, so every catalogue saved before grouping existed still
   * parses.
   */
  members: z.array(z.string()).max(8).default([]),
});
export type Offer = z.infer<typeof Offer>;

/** The words `a` and `b` start with, as whole words. */
function sharedPrefix(a: string, b: string): string {
  const one = a.split(/\s+/);
  const two = b.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < Math.min(one.length, two.length); i += 1) {
    if (one[i]!.toLowerCase() !== two[i]!.toLowerCase()) break;
    out.push(one[i]!);
  }
  return out.join(' ');
}

/** The one value they all share, or null. */
function agreed<T>(values: T[], same: (a: T, b: T) => boolean): T | null {
  const first = values[0];
  if (first === undefined) return null;
  return values.every((value) => same(value, first)) ? first : null;
}

/**
 * Several offers as one, the way a leaflet prints "frit valg".
 *
 * One cell, one price, every product photographed together. This is how
 * products are added to a page whose layout is already settled — the
 * grid does not move, the tile's contents do.
 *
 * Everything that could be untrue about the result is resolved
 * downwards, never upwards:
 *
 *   price       the LOWEST, marked `priceFrom` the moment they differ.
 *               One figure printed over goods that are not all that
 *               price is what a shopper discovers at the till.
 *   comparison  the HIGHEST unit price, which is precisely what the
 *               chains' own "Kg-pris maks. 61,25" means. Dropped
 *               entirely unless every member quotes the same unit.
 *   validity    the window in which they are ALL on offer — the latest
 *               start and the earliest end.
 *   labels      only the ones every member carries. An Ø-mark on a
 *               tile where one of six is not organic is a false claim,
 *               not a rounding error.
 *   quantity    theirs if they agree, nothing if they do not. A weight
 *               that describes one of six products is worse than none.
 *
 * The name is a first draft and is meant to be rewritten: two members
 * read "A eller B", more than two take whatever words they all begin
 * with, and everything else falls back to the first name and "m.fl.".
 * The editor renames it in place — see `PlacementOverrides.displayName`.
 */
export function groupOffers(members: Offer[], id: string): Offer {
  const first = members[0];
  if (!first) throw new Error('kan ikke samle nul tilbud');
  if (members.length === 1) return first;

  const names = members.map((offer) => offer.name);
  const prefix = names.slice(1).reduce((all, name) => sharedPrefix(all, name), names[0]!);
  const name = members.length === 2
    ? `${names[0]} eller ${names[1]}`
    : (prefix.split(/\s+/).filter(Boolean).length >= 2
      ? `${prefix} — flere varianter`
      : `${names[0]} m.fl.`);

  const prices = members.map((offer) => offer.price);
  const units = members.map((offer) => offer.comparison?.unit ?? null);
  const unit = agreed(units, (a, b) => a === b);
  const quantity = agreed(
    members.map((offer) => offer.quantity),
    (a, b) => a.size === b.size && a.unit === b.unit && a.pieceCount === b.pieceCount,
  );

  const everyone = (label: OfferLabel) =>
    members.every((offer) => offer.labels.some(
      (other) => other.kind === label.kind && other.text === label.text,
    ));

  return {
    id,
    name,
    /* What the page has to say about a grouped tile, in the chain's own
       words. The sizes are not listed: they differ, that is the whole
       reason this is one tile, and the unit price below carries the
       comparison the law asks for. */
    description: 'Flere varianter. Frit valg.',
    brand: agreed(members.map((offer) => offer.brand), (a, b) => a === b) ?? '',
    category: agreed(members.map((offer) => offer.category), (a, b) => a === b) ?? first.category,

    price: Math.min(...prices),
    priceFrom: new Set(prices).size > 1,
    prePrice: null,
    savings: null,
    savingsMax: null,
    currency: first.currency,
    comparison: unit
      ? { value: Math.max(...members.map((offer) => offer.comparison!.value)), unit }
      : null,

    quantity: quantity ?? { size: null, unit: 'pcs', pieceCount: 1 },
    pack: agreed(members.map((offer) => offer.pack), (a, b) => a === b) ?? '',
    validFrom: members.map((offer) => offer.validFrom).sort().at(-1)!,
    validTo: members.map((offer) => offer.validTo).sort()[0]!,

    imageUrl: first.imageUrl,
    // Deduplicated: two variants of one product often carry the same
    // photograph, and a cluster that prints it twice reads as a mistake.
    imagePack: [...new Set(members.map((offer) => offer.imageUrl).filter(
      (url): url is string => Boolean(url),
    ))].slice(0, 8),
    labels: first.labels.filter(everyone),
    priority: Math.max(...members.map((offer) => offer.priority ?? 0)) || null,
    members: members.map((offer) => offer.id).slice(0, 8),
  };
}

export const OfferFeed = z.object({
  retailerId: z.string().min(1),
  sourceName: z.string().default(''),
  offers: z.array(Offer),
});
export type OfferFeed = z.infer<typeof OfferFeed>;
