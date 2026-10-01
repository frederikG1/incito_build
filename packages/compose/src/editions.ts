import type {
  Brand, CatalogDocument, FeedEdition, Offer, OfferFeed, PublicationVariant,
} from '@incitio/schema';
import { recordVariant, resolveVariant } from '@incitio/edit/core';
import { applyFeedDiff, DIFF_FIELD_NAMES, feedDiff, type FeedDiff, type OfferChange } from './diff.js';

/**
 * Store and region editions against their own feeds.
 *
 * A chain with local prices does not send one file. It sends the
 * chain-wide one and, per region or store, one more — and what the
 * platform reads is those files merged into one, each row saying which
 * editions it is sold in. This is both halves of that: an edition's
 * file turned into the edition (its own products, its prices, what it
 * does not carry), the editions checked against their files, and the
 * files merged into the one output.
 *
 * The edition stays a difference from the base, never a copy — see
 * `PublicationVariant`. A file per store changes what the difference
 * says, not how it is kept.
 */

/** The edition id every merged feed has: the base, sold wherever no edition is. */
export const BASE_EDITION = 'alle';

const normal = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').replace(/[*,.]/g, '').trim();

/** Every offer shown on a page, grouped tiles' members included, by id and by name. */
function onPages(document: CatalogDocument): { ids: Set<string>; names: Set<string> } {
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const ids = new Set<string>();
  for (const page of document.pages) {
    for (const placement of page.placements) {
      ids.add(placement.offerId);
      for (const member of byId.get(placement.offerId)?.members ?? []) ids.add(member);
    }
  }
  const names = new Set([...ids].map((id) => byId.get(id)).filter(Boolean).map((offer) => normal(offer!.name)));
  return { ids, names };
}

export interface EditionCheck {
  /** Null for "Alle butikker", the base. */
  variantId: string | null;
  name: string;
  stores: string[];
  /** Products standing on the edition's pages. */
  onPages: number;
  /** The file it is checked against, when it has one. */
  feed: { name: string; offers: number } | null;
  /** On a page, and not in the file. */
  missing: FeedDiff['removed'];
  /** On a page, and the file says otherwise. */
  differs: OfferChange[];
  /** In the file, and on none of the edition's pages. */
  unplaced: Offer[];
  /** Edits of this edition that no longer fit the base. */
  conflicts: string[];
  /** What prints wrong if nobody looks: missing + differs + conflicts. */
  problems: number;
}

/** One edition, as resolved, against the file it should match. */
export function checkEdition(
  document: CatalogDocument,
  feed: { name: string; offers: Offer[] } | null,
  meta: { variantId: string | null; name: string; stores: string[]; conflicts?: string[] },
): EditionCheck {
  const shown = onPages(document);
  const conflicts = meta.conflicts ?? [];
  const diff = feed ? feedDiff(document, feed.offers) : null;
  const missing = diff?.removed ?? [];
  const differs = (diff?.changed ?? []).filter((change) => change.pageId);
  const unplaced = (feed?.offers ?? []).filter(
    (offer) => !shown.ids.has(offer.id) && !shown.names.has(normal(offer.name)),
  );
  return {
    variantId: meta.variantId,
    name: meta.name,
    stores: meta.stores,
    onPages: shown.ids.size,
    feed: feed ? { name: feed.name, offers: feed.offers.length } : null,
    missing,
    differs,
    unplaced,
    conflicts,
    problems: missing.length + differs.length + conflicts.length,
  };
}

/** The base and every edition, each against its own file. The base's file is the week's. */
export function checkEditions(
  base: CatalogDocument,
  baseFeed: { name: string; offers: Offer[] } | null,
  brand: Brand,
): EditionCheck[] {
  return [
    checkEdition(base, baseFeed, { variantId: null, name: 'Alle butikker', stores: [] }),
    ...(base.variants ?? []).map((variant) => {
      const resolved = resolveVariant(base, variant.id, brand);
      return checkEdition(resolved.document, variant.feed ?? null, {
        variantId: variant.id, name: variant.name, stores: variant.stores, conflicts: resolved.conflicts,
      });
    }),
  ];
}

export interface EditionFromFeed {
  variant: PublicationVariant;
  diff: FeedDiff;
  /** What the file says that an edition cannot hold — a local name, a saving — named, not lost. */
  unrepresented: string[];
}

/**
 * An edition's own file, written into the edition.
 *
 * The same comparison as Wednesday's corrections (`feedDiff`), run on the
 * edition as it stands: products only this file has go in its reserve,
 * other prices become its price edits, and a product the file does not
 * carry comes off its pages — here it does, unlike on the base, because
 * a store's file not listing a product IS that store not selling it.
 * Uploading again next week compares against what the last file made.
 */
export function feedToEdition(
  base: CatalogDocument,
  variantId: string,
  feed: { name: string; readAt: string; offers: Offer[] },
  brand: Brand,
): EditionFromFeed {
  const resolved = resolveVariant(base, variantId, brand);
  const diff = feedDiff(resolved.document, feed.offers);
  const applied = applyFeedDiff(resolved.document, diff);
  const gone = new Set(diff.removed.map((entry) => entry.offer.id));
  const pages = applied.pages.map((page) => ({
    ...page,
    placements: page.placements.filter((placement) => !gone.has(placement.offerId)),
  }));
  // Local products the last file brought and this one does not, unless someone put them on a page.
  const inBase = new Set(base.offers.map((offer) => offer.id));
  const inFeed = new Set(feed.offers.map((offer) => offer.id));
  const inFeedNames = new Set(feed.offers.map((offer) => normal(offer.name)));
  const placed = new Set(pages.flatMap((page) => page.placements.map((placement) => placement.offerId)));
  const offers = applied.offers.filter((offer) => inBase.has(offer.id) || placed.has(offer.id)
    || inFeed.has(offer.id) || inFeedNames.has(normal(offer.name)));

  const { variant, unrepresented } = recordVariant(base, resolved.variant, { ...applied, pages, offers }, brand);
  const unsaid = diff.changed.flatMap((change) => change.fields
    .filter(({ field }) => field !== 'price' && field !== 'prePrice')
    .map(({ field }) => `${DIFF_FIELD_NAMES[field]} på ${change.next.name}`));
  return {
    variant: { ...variant, feed: { name: feed.name, readAt: feed.readAt, offers: feed.offers } },
    diff,
    unrepresented: [...unrepresented, ...unsaid],
  };
}

export interface EditionInput extends FeedEdition {
  /** The edition's own file. Null: it sells what the base does. */
  offers: Offer[] | null;
}

const withoutScope = (offer: Offer): Offer => {
  const { editions: _scoped, ...rest } = offer;
  return rest;
};

/**
 * Several feeds as the one the platform reads.
 *
 * A product every edition sells alike is one row with no `editions`,
 * which keeps the output as small as the chain-wide file for a chain
 * whose regions differ in three prices. A product that differs is one
 * row per version, each naming the editions it is sold in; the version
 * the base sells keeps the product's id and the others take
 * `<id>@<first edition>`, so ids stay unique and a reader that ignores
 * editions still gets the chain-wide avis. An edition's rows are matched
 * to the base's by id and then by name, as `feedDiff` does.
 */
export function mergeEditionFeeds(
  retailerId: string,
  base: Offer[],
  editions: EditionInput[],
): OfferFeed {
  const baseById = new Map(base.map((offer) => [offer.id, offer]));
  const baseByName = new Map(base.map((offer) => [normal(offer.name), offer]));
  const align = (offer: Offer): Offer => {
    if (baseById.has(offer.id)) return offer;
    const same = baseByName.get(normal(offer.name));
    return same ? { ...offer, id: same.id } : offer;
  };
  const scopes = [
    { id: BASE_EDITION, offers: base },
    ...editions.map((edition) => ({ id: edition.id, offers: edition.offers ? edition.offers.map(align) : base })),
  ].map((scope) => ({ id: scope.id, byId: new Map(scope.offers.map((offer) => [offer.id, withoutScope(offer)])) }));

  const order: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    for (const id of scope.byId.keys()) if (!seen.has(id)) { seen.add(id); order.push(id); }
  }

  const offers: Offer[] = [];
  for (const id of order) {
    const versions = new Map<string, { offer: Offer; scopes: string[] }>();
    let everywhere = true;
    for (const scope of scopes) {
      const offer = scope.byId.get(id);
      if (!offer) { everywhere = false; continue; }
      const key = JSON.stringify(offer);
      const version = versions.get(key) ?? { offer, scopes: [] };
      version.scopes.push(scope.id);
      versions.set(key, version);
    }
    const all = [...versions.values()];
    if (everywhere && all.length === 1) { offers.push(all[0]!.offer); continue; }
    const keeper = all.find((version) => version.scopes.includes(BASE_EDITION)) ?? all[0]!;
    for (const version of all) {
      offers.push({
        ...version.offer,
        id: version === keeper ? id : `${id}@${version.scopes[0]}`,
        editions: version.scopes,
      });
    }
  }

  return {
    retailerId,
    sourceName: `samlet af ${editions.filter((edition) => edition.offers).length + 1} feeds`,
    offers,
    editions: [
      { id: BASE_EDITION, name: 'Alle butikker', stores: [] },
      ...editions.map(({ id, name, stores }) => ({ id, name, stores })),
    ],
  };
}

/** A merged feed back into one list per edition — the inverse of `mergeEditionFeeds`. */
export function splitMergedFeed(feed: OfferFeed): Map<string, Offer[]> {
  const ids = (feed.editions ?? [{ id: BASE_EDITION, name: '', stores: [] }]).map((edition) => edition.id);
  const known = new Set(ids);
  const own = (offer: Offer): string => {
    const at = offer.id.lastIndexOf('@');
    return at > 0 && known.has(offer.id.slice(at + 1)) ? offer.id.slice(0, at) : offer.id;
  };
  return new Map(ids.map((edition) => [
    edition,
    feed.offers
      .filter((offer) => !offer.editions || offer.editions.includes(edition))
      .map((offer) => ({ ...withoutScope(offer), id: own(offer) })),
  ]));
}
