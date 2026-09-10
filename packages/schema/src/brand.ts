import { z } from 'zod';
import { PageTemplate } from './template.js';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The design tokens a brand's stylesheet is written against.
 *
 * These reach the DOM as CSS custom properties on the page root, so the
 * brand stylesheet never hard-codes a colour: it says `var(--brand)` and
 * the token supplies the value. That is the seam that lets a new chain be
 * onboarded by filling in tokens rather than by forking the CSS.
 */
export const BrandTokens = z.object({
  brand: Hex,
  accent: Hex,
  ground: Hex,
  ink: Hex,
  priceInk: Hex,
  headingFont: z.string().min(1),
  bodyFont: z.string().min(1),
});
export type BrandTokens = z.infer<typeof BrandTokens>;

/**
 * The shape a price is printed in. A load-bearing part of chain
 * identity: Netto's rotated black tag and SuperBrugsen's red disc are
 * recognisable at a glance, and swapping them makes one chain's page
 * read as the other's.
 */
export const PriceShape = z.enum(['tag', 'disc', 'plain']);
export type PriceShape = z.infer<typeof PriceShape>;

/**
 * One tenant. Everything that distinguishes one chain from another —
 * feed shape aside, which is code — lives here.
 *
 * `templates` is the chain's OWN layout set. A Netto employee never sees
 * SuperBrugsen's templates, not because the UI hides them but because
 * the brand they are scoped to does not contain them.
 */
export const Brand = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  tokens: BrandTokens,
  /** How an ordinary tile prints its price. */
  priceShape: PriceShape.default('tag'),
  /**
   * How the page's lead tile prints its price, when the chain marks it
   * differently.
   *
   * SuperBrugsen does: measured across the week-37 book, small offers
   * carry a plain black numeral beside the product and only the page's
   * hero gets the red disc. Treating every tile as a disc filled the
   * page with red circles and read as a different chain. Omit and the
   * lead uses `priceShape` like everything else.
   */
  leadPriceShape: PriceShape.nullable().default(null),
  /**
   * The page grounds this chain rotates through, one per page.
   *
   * Chains differ here and the difference is visible at a glance.
   * SuperBrugsen prints a different pastel on each page or section —
   * pale yellow, teal, blue, sage, sand — under one unchanging petal
   * motif; Netto prints its yellow on every page. Empty means "use the
   * `ground` token everywhere", which is the Netto behaviour.
   *
   * Sampled from the page margins of published pages, not guessed. See
   * `npm run refs`.
   */
  groundTints: z.array(Hex).default([]),
  /** A print motif tiled over the ground, in a tone of the ground. */
  groundPattern: z.enum(['none', 'petal']).default('none'),
  /** Page aspect ratio, width / height. 0.707 is portrait A4. */
  pageAspect: z.number().positive().default(0.707),
  logoUrl: z.string().nullable().default(null),
  templates: z.array(PageTemplate).min(1),
  /** Language the curator writes headlines in. */
  language: z.string().min(1).default('Danish'),
});
export type Brand = z.infer<typeof Brand>;

/**
 * The ground for one page.
 *
 * Rotates through `groundTints` so a book does not print the same field
 * forty times; falls back to the single `ground` token for a chain that
 * genuinely uses one colour throughout.
 */
export function pageGround(brand: Brand, pageIndex: number): string {
  const tints = brand.groundTints;
  if (tints.length === 0) return brand.tokens.ground;
  return tints[((pageIndex % tints.length) + tints.length) % tints.length]!;
}

/**
 * Token map as inline CSS custom properties, for the page root element.
 *
 * `--ground` is per PAGE, not per brand, which is why this takes an
 * index. The motif tone is derived from it rather than being its own
 * token: the pattern has to stay the same shape and the same weight on
 * every tint, and deriving it is the only way that holds when a new
 * ground is added.
 */
export function brandCssVars(brand: Brand, pageIndex = 0): Record<string, string> {
  return {
    '--brand': brand.tokens.brand,
    '--accent': brand.tokens.accent,
    '--ground': pageGround(brand, pageIndex),
    '--ink': brand.tokens.ink,
    '--price-ink': brand.tokens.priceInk,
    '--heading-font': brand.tokens.headingFont,
    '--body-font': brand.tokens.bodyFont,
  };
}
