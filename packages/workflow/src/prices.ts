import type { CatalogDocument, Offer } from '@incitio/schema';
import type { Stop } from './stop.js';
import { normalPrice, standInPrices } from './stand-in.js';

/**
 * The price rules an avis is printed under.
 *
 * Danish price marking, since the EU Omnibus directive (2022), says
 * a discount may only be stated against the LOWEST price the product
 * had in the 30 days before. "Før 49,-" over a product that was 39,-
 * on campaign two weeks ago is a misleading price
 * claim, and it is the chain's name on it. Today somebody checks this by
 * hand, or nobody does.
 *
 * Two kinds of check here. The arithmetic ones need nothing but the
 * avis and are real: "Spar 10" on 49 → 35 is wrong whatever happened
 * last month. The 30-day one needs the price history, which comes from
 * a `PriceSource` — the stand-in until the chain's price file is
 * connected, see `stand-in.ts`.
 *
 * The studio runs these to warn; the server runs the same ones to refuse.
 */

export interface PriceHistory {
  /** Oldest first, one per day, the 30 days before the avis starts. */
  days: number[];
  /** The lowest of them: what a "før"-price may not exceed. */
  lowest: number;
}

/** Where 30-day price history comes from. Synchronous: the server reads it ahead of the request. */
export interface PriceSource {
  /** True while the history is made up. */
  demo: boolean;
  /** Null when the source knows nothing about the product — the check then cannot pass or fail. */
  history(offer: Offer): PriceHistory | null;
}

const kr = (value: number) => (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));
const near = (a: number, b: number) => Math.abs(a - b) < 0.015;

export interface PriceVerdict {
  offer: Offer;
  /** The price the avis compares with. */
  claimed: number;
  /** The lowest of the last 30 days. */
  lowest: number;
  days: number[];
  ok: boolean;
}

/** Every product on a page that states a saving, with what the history says about it. */
export function priceVerdicts(document: CatalogDocument, prices: PriceSource = standInPrices): PriceVerdict[] {
  const placed = new Set(document.pages.flatMap((page) => page.placements.map((p) => p.offerId)));
  const verdicts: PriceVerdict[] = [];
  for (const offer of document.offers) {
    if (!placed.has(offer.id)) continue;
    const claimed = normalPrice(offer);
    const history = claimed === null ? null : prices.history(offer);
    if (claimed === null || !history) continue;
    verdicts.push({ offer, claimed, lowest: history.lowest, days: history.days, ok: claimed <= history.lowest + 0.005 });
  }
  return verdicts;
}

export function priceRuleFindings(document: CatalogDocument | null, prices: PriceSource = standInPrices): Stop[] {
  if (!document) return [];
  const found: Stop[] = [];
  const pageOf = new Map<string, { pageId: string; number: number }>();
  document.pages.forEach((page, index) => {
    for (const p of page.placements) pageOf.set(p.offerId, { pageId: page.id, number: index + 1 });
  });

  for (const verdict of priceVerdicts(document, prices)) {
    if (verdict.ok) continue;
    const at = pageOf.get(verdict.offer.id)!;
    found.push({
      id: `førpris:${verdict.offer.id}`,
      kind: 'førpris',
      said: `Side ${at.number}: ${verdict.offer.name} — førpris ${kr(verdict.claimed)}, men laveste pris de sidste 30 dage var ${kr(verdict.lowest)}`,
      pageId: at.pageId,
      pageNumber: at.number,
      offerId: verdict.offer.id,
      weight: 'stop',
    });
  }

  for (const offer of document.offers) {
    const at = pageOf.get(offer.id);
    if (!at) continue;
    const base = { pageId: at.pageId, pageNumber: at.number, offerId: offer.id };

    // "Spar" that is not the difference between the two prices it stands between.
    if (offer.prePrice !== null && offer.savings !== null && offer.savingsMax === null
      && offer.prePrice > offer.price && !near(offer.prePrice - offer.price, offer.savings)) {
      found.push({
        ...base,
        id: `spar:${offer.id}`,
        kind: 'førpris',
        said: `Side ${at.number}: ${offer.name} — «spar ${kr(offer.savings)}» passer ikke med ${kr(offer.prePrice)} → ${kr(offer.price)} (spar ${kr(Math.round((offer.prePrice - offer.price) * 100) / 100)})`,
        weight: 'stop',
      });
    }

    // A "before" that is not above the price claims a saving of nothing.
    if (offer.prePrice !== null && offer.prePrice > 0 && offer.prePrice <= offer.price) {
      found.push({
        ...base,
        id: `førlav:${offer.id}`,
        kind: 'førpris',
        said: `Side ${at.number}: ${offer.name} — førprisen ${kr(offer.prePrice)} er ikke højere end prisen ${kr(offer.price)}`,
        weight: 'stop',
      });
    }

    // A member price that is no better than everybody's.
    if (offer.memberPrice !== null && offer.memberPrice > offer.price) {
      found.push({
        ...base,
        id: `medlem:${offer.id}`,
        kind: 'førpris',
        said: `Side ${at.number}: ${offer.name} — medlemsprisen ${kr(offer.memberPrice)} er højere end prisen ${kr(offer.price)}`,
        weight: 'se',
      });
    }
  }
  return found;
}
