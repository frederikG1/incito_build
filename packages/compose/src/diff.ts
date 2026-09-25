import type { CatalogDocument, Offer } from '@incitio/schema';

/**
 * What changed in the feed since the pages were laid out.
 *
 * The avis is laid out on Monday from Monday's file, and on Wednesday
 * the chain sends another: a price went from 25 to 22, a supplier pulled
 * the salmon, two items were added. Today that is a person comparing
 * two spreadsheets against a proof. This is the comparison, done once,
 * as a list the studio can apply and point at.
 *
 * Matched by id first and by name second — Coop's export keeps its ids
 * between files, a hand-edited CSV often does not, and a name that has
 * not changed is the same product to anyone reading the page.
 */

export const DIFF_FIELDS = [
  'price', 'prePrice', 'savings', 'savingsMax', 'priceFrom', 'comparison',
  'validFrom', 'validTo', 'name', 'description', 'imageUrl',
] as const;
export type DiffField = (typeof DIFF_FIELDS)[number];

export const DIFF_FIELD_NAMES: Record<DiffField, string> = {
  price: 'pris',
  prePrice: 'førpris',
  savings: 'besparelse',
  savingsMax: 'besparelse op til',
  priceFrom: '"fra"-pris',
  comparison: 'enhedspris',
  validFrom: 'gyldig fra',
  validTo: 'gyldig til',
  name: 'navn',
  description: 'underlinje',
  imageUrl: 'billede',
};

export interface OfferChange {
  offerId: string;
  /** The same product in the new file, whose values are applied. */
  next: Offer;
  fields: { field: DiffField; before: unknown; after: unknown }[];
  /** Which page shows it, when one does — the thing a person needs to look at. */
  pageId: string | null;
}

export interface FeedDiff {
  changed: OfferChange[];
  /** On a page, and not in the new file. */
  removed: { offer: Offer; pageId: string }[];
  /** In the new file and nowhere in the avis. */
  added: Offer[];
  /** How many matched without a single difference. */
  unchanged: number;
}

const normal = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').replace(/[*,.]/g, '').trim();

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function feedDiff(document: CatalogDocument, feed: Offer[]): FeedDiff {
  const pageOf = new Map<string, string>();
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  for (const page of document.pages) {
    for (const placement of page.placements) {
      pageOf.set(placement.offerId, page.id);
      // A grouped tile shows its members, so they are on the page too.
      for (const member of byId.get(placement.offerId)?.members ?? []) pageOf.set(member, page.id);
    }
  }

  const nextById = new Map(feed.map((offer) => [offer.id, offer]));
  const nextByName = new Map(feed.map((offer) => [normal(offer.name), offer]));
  const matched = new Set<string>();

  const changed: OfferChange[] = [];
  const removed: FeedDiff['removed'] = [];
  let unchanged = 0;

  for (const offer of document.offers) {
    // A tile made of several products has no row of its own in any feed.
    if (offer.members.length > 0) continue;
    const next = nextById.get(offer.id) ?? nextByName.get(normal(offer.name));
    const pageId = pageOf.get(offer.id) ?? null;
    if (!next) {
      if (pageId) removed.push({ offer, pageId });
      continue;
    }
    matched.add(next.id);
    const fields = DIFF_FIELDS
      .filter((field) => !same(offer[field], next[field]))
      .map((field) => ({ field, before: offer[field], after: next[field] }));
    if (fields.length === 0) unchanged += 1;
    else changed.push({ offerId: offer.id, next, fields, pageId });
  }

  const added = feed.filter((offer) => !matched.has(offer.id) && !byId.has(offer.id));

  // What is on a page first: that is what prints.
  changed.sort((a, b) => Number(Boolean(b.pageId)) - Number(Boolean(a.pageId)));
  return { changed, removed, added, unchanged };
}

/**
 * The new file's values, written into the avis.
 *
 * Every change is applied under the OLD id, so every placement, every
 * hand correction and every grouped tile that points at it keeps
 * pointing at it. New products go in the reserve. Removed products are
 * left exactly where they are: taking a tile off a page is a decision a
 * person makes with the page in front of them, not a side effect.
 */
export function applyFeedDiff(document: CatalogDocument, diff: FeedDiff): CatalogDocument {
  const updates = new Map(diff.changed.map((change) => [change.offerId, change]));
  const offers = document.offers.map((offer) => {
    const change = updates.get(offer.id);
    if (!change) return offer;
    const next = { ...offer };
    for (const { field, after } of change.fields) (next as Record<string, unknown>)[field] = after;
    return next;
  });
  return { ...document, offers: [...offers, ...diff.added] };
}
