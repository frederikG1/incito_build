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
