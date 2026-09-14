import type { Offer } from '@incitio/schema';

/**
 * How much editorial weight an offer deserves, 0..1.
 *
 * A feed-supplied priority always wins — the chain already knows which
 * offers are its drivers. Otherwise it is derived from discount depth,
 * because in leaflet practice the deepest cut is the page's draw.
 */
export function offerImportance(offer: Offer): number {
  if (offer.priority !== null) return offer.priority;

  let score = 0.3;
  if (offer.prePrice !== null && offer.prePrice > offer.price) {
    const depth = (offer.prePrice - offer.price) / offer.prePrice;
    score += Math.min(depth * 1.4, 0.5);
  } else if (offer.savings !== null && offer.savings > 0) {
    const denominator = offer.price + offer.savings;
    if (denominator > 0) score += Math.min((offer.savings / denominator) * 1.4, 0.5);
  }
  // Multibuy and member deals are the mechanics chains push hardest.
  if (offer.labels.some((l) => l.kind === 'multibuy' || l.kind === 'member')) score += 0.12;

  return Math.max(0, Math.min(1, score));
}

/**
 * Total ordering of offers by editorial weight, strongest first.
 *
 * The id tie-break is load-bearing, not cosmetic: `offerImportance`
 * saturates, so distinct offers routinely share an exact score. Without
 * a final tie-break the result depends on the order rows happened to
 * appear in the feed, which makes regeneration shuffle pages at random.
 */
export function compareByImportance(a: Offer, b: Offer): number {
  const diff = offerImportance(b) - offerImportance(a);
  if (Math.abs(diff) > 1e-9) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * How far the strongest offer in a set stands above the rest, 0..1.
 *
 * This is the number a page's shape should be decided by. A leaflet
 * does not alternate big and small layouts for the sake of variety —
 * it prints one offer large BECAUSE that offer is the week's draw, and
 * prints a flat grid when a page is a dozen equally ordinary items.
 * Choosing the layout from the offers rather than from a die is what
 * makes the size difference mean something.
 *
 * Measured against the median of the rest rather than the mean, so one
 * other strong offer does not erase a genuine leader, and a single weak
 * straggler does not invent one.
 *
 * A lone offer returns 1: a page of one is a page about that one.
 */
export function leadContrast(offers: Offer[]): number {
  if (offers.length === 0) return 0;
  if (offers.length === 1) return 1;
  const scores = offers.map(offerImportance).sort((a, b) => b - a);
  const rest = scores.slice(1);
  const median = rest[Math.floor(rest.length / 2)]!;
  return Math.max(0, Math.min(1, scores[0]! - median));
}

/**
 * Above this, a page is led by one offer and wants a layout with a
 * lead slot; below it the offers are level and a flat grid is the
 * honest shape.
 *
 * 0.12 rather than something rounder because `offerImportance` starts
 * every underived offer at 0.3 and adds at most 0.5 for discount
 * depth: a gap of 0.12 is roughly a quarter of the whole derived
 * range, which is the point where the difference is visible on a
 * printed page rather than merely present in a float.
 */
export const LEAD_CONTRAST_THRESHOLD = 0.12;
