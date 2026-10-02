import { departmentOf } from '@incitio/compose';
import type { CatalogDocument, CatalogPage, Offer } from '@incitio/schema';
import type { Household } from './signals.js';

/**
 * One avis, read in a household's order.
 *
 * Pure, so it can be tested and so the phone preview and whatever later
 * serves the real thing order pages the same way.
 */

/** Products on a page — a grouped tile's members, else the tile. */
export function productsOn(page: CatalogPage, offers: Map<string, Offer>): Offer[] {
  return page.placements.flatMap((p) => {
    const offer = offers.get(p.offerId);
    if (!offer) return [];
    const members = offer.members.map((id) => offers.get(id)).filter((m): m is Offer => Boolean(m));
    return members.length ? members : [offer];
  });
}

/** Whether a product is on the household's shopping list. */
export function onList(offer: Offer, household: Household): boolean {
  const words = `${offer.name} ${offer.description}`.toLowerCase();
  return household.list.some((word) => words.includes(word));
}

/**
 * The pages in the order this household should meet them.
 *
 * The front page stays first — it is the chain's, and it is what the
 * avis is recognised by. The rest by how much of the page is what the
 * household buys, with their shopping list counting double. Pages are
 * never redrawn, only reordered: every place still holds what was sold.
 */
export function orderFor(document: CatalogDocument, household: Household | null): CatalogPage[] {
  if (!household || document.pages.length < 3) return document.pages;
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const score = (page: CatalogPage) => {
    const products = productsOn(page, offers);
    if (products.length === 0) return -1;
    let total = 0;
    for (const product of products) {
      const rank = household.likes.indexOf(departmentOf(product));
      if (rank >= 0) total += household.likes.length - rank;
      if (onList(product, household)) total += household.likes.length * 2;
    }
    return total / Math.sqrt(products.length);
  };
  const [cover, ...rest] = document.pages;
  return [cover!, ...rest
    .map((page, index) => ({ page, index, score: score(page) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.page)];
}
