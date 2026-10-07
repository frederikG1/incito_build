import type { CatalogDocument, Offer } from '@incitio/schema';

/**
 * The same product, arrived twice.
 *
 * A page read off the chain's publication brings its offers with Tjek's
 * ids; the week's feed brings the same products with the feed's. Mammen
 * hytteost is `Cpa5e-…` with no brand on page 15 and `1073807`, brand
 * "Mammen", in the feed — two ids, one product, and filling from the
 * reserve printed it twice. Same words, same price, and a brand that
 * agrees or is missing on one side: that is what a reader sees as the
 * same offer, whichever file it came from.
 */
const words = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function sameShown(a: Pick<Offer, 'id' | 'name' | 'brand' | 'price'>, b: Pick<Offer, 'id' | 'name' | 'brand' | 'price'>): boolean {
  if (a.id === b.id) return true;
  if (words(a.name) !== words(b.name) || a.price !== b.price) return false;
  return !a.brand || !b.brand || words(a.brand) === words(b.brand);
}

/** Every offer the pages print, the products inside a placed cluster included. */
export function printedOffers(document: CatalogDocument): Offer[] {
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const ids = new Set(document.pages.flatMap((page) => page.placements.flatMap((placement) => [
    placement.offerId, ...(byId.get(placement.offerId)?.members ?? []),
  ])));
  return [...ids].map((id) => byId.get(id)).filter((offer): offer is Offer => Boolean(offer));
}

/**
 * The candidates with nothing already printed — and no two of them the
 * same product, so one fill cannot seat both copies either.
 */
export function withoutTwins<T extends Pick<Offer, 'id' | 'name' | 'brand' | 'price'>>(candidates: T[], printed: Pick<Offer, 'id' | 'name' | 'brand' | 'price'>[]): T[] {
  const kept: T[] = [];
  for (const offer of candidates) {
    if (printed.some((other) => sameShown(offer, other))) continue;
    if (kept.some((other) => sameShown(offer, other))) continue;
    kept.push(offer);
  }
  return kept;
}
