import { useEffect, useState } from 'react';
import type { CatalogDocument, Offer } from '@incitio/schema';
import * as api from './api.js';

/**
 * What changed since last week's avis — what a proof-reader looks for
 * first, and what the page cards now say before anyone has to.
 *
 * A product is "the same" by its id, or else by its name: feeds re-key
 * rows from week to week, and "Arla minimælk 1 l" is still the product
 * the reader remembers. Per page: products last week did not carry, and
 * products whose price moved. For the avis: the products that left.
 */

export interface PageDelta { fresh: number; repriced: number }
export interface WeekDiff {
  /** The week compared against, for the words: "siden uge 39". */
  since: number | null;
  pages: Map<string, PageDelta>;
  fresh: number;
  repriced: number;
  /** Products last week's pages showed and this week's do not. */
  gone: number;
}

const key = (offer: Offer) => offer.name.trim().toLowerCase();

function shown(document: CatalogDocument): Offer[] {
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const out: Offer[] = [];
  for (const page of document.pages) {
    for (const placement of page.placements) {
      const offer = byId.get(placement.offerId);
      if (offer) out.push(offer);
    }
  }
  return out;
}

export function weekDiff(previous: CatalogDocument, document: CatalogDocument): WeekDiff {
  const before = shown(previous);
  const beforeById = new Map(before.map((offer) => [offer.id, offer]));
  const beforeByName = new Map(before.map((offer) => [key(offer), offer]));
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const pages = new Map<string, PageDelta>();
  const matched = new Set<Offer>();
  let fresh = 0;
  let repriced = 0;

  for (const page of document.pages) {
    const delta: PageDelta = { fresh: 0, repriced: 0 };
    for (const placement of page.placements) {
      const offer = byId.get(placement.offerId);
      if (!offer) continue;
      const was = beforeById.get(offer.id) ?? beforeByName.get(key(offer));
      if (!was) { delta.fresh += 1; continue; }
      matched.add(was);
      if (Math.abs(was.price - offer.price) >= 0.005) delta.repriced += 1;
    }
    fresh += delta.fresh;
    repriced += delta.repriced;
    if (delta.fresh || delta.repriced) pages.set(page.id, delta);
  }

  const gone = new Set(before.filter((offer) => !matched.has(offer)).map(key)).size;
  return { since: previous.week?.week ?? null, pages, fresh, repriced, gone };
}

/** "3 nye · 1 ny pris" — or nothing, for a page that is as it was. */
export function deltaSaid(delta: PageDelta | undefined): string {
  if (!delta) return '';
  return [
    delta.fresh ? `${delta.fresh} ${delta.fresh === 1 ? 'ny' : 'nye'}` : '',
    delta.repriced ? `${delta.repriced} ${delta.repriced === 1 ? 'ny pris' : 'nye priser'}` : '',
  ].filter(Boolean).join(' · ');
}

/*
 * Last week's avis, fetched once per avis rather than once per page
 * card. Keyed by this avis and the one before it, so a new save of
 * either is a new comparison.
 */
const cache = new Map<string, Promise<CatalogDocument | null>>();
const order = (week: { year: number; week: number } | null | undefined) => (week ? week.year * 100 + week.week : 0);

export function previousOf(document: CatalogDocument | null, catalogues: api.CatalogSummary[]): api.CatalogSummary | null {
  if (!document?.week) return null;
  return catalogues
    .filter((c) => c.id !== document.id && c.week && order(c.week) < order(document.week) && c.status !== 'skjult')
    .sort((a, b) => order(b.week) - order(a.week))[0] ?? null;
}

export function usePreviousWeek(
  document: CatalogDocument | null,
  brandId: string | null,
  catalogues: api.CatalogSummary[],
): CatalogDocument | null {
  const before = previousOf(document, catalogues);
  const id = brandId && before ? `${brandId}/${before.id}@${before.updatedAt}` : null;
  const [previous, setPrevious] = useState<{ id: string; doc: CatalogDocument | null } | null>(null);
  useEffect(() => {
    if (!id || !brandId || !before) return;
    let live = true;
    if (!cache.has(id)) cache.set(id, api.fetchCatalogue(brandId, before.id).catch(() => null));
    void cache.get(id)!.then((doc) => { if (live) setPrevious({ id, doc }); });
    return () => { live = false; };
  }, [id]);
  return previous && previous.id === id ? previous.doc : null;
}

/** The diff for the open avis, computed once however many cards ask. */
const diffs = new WeakMap<CatalogDocument, WeakMap<CatalogDocument, WeekDiff>>();
export function cachedDiff(previous: CatalogDocument | null, document: CatalogDocument | null): WeekDiff | null {
  if (!previous || !document) return null;
  let inner = diffs.get(document);
  if (!inner) { inner = new WeakMap(); diffs.set(document, inner); }
  let diff = inner.get(previous);
  if (!diff) { diff = weekDiff(previous, document); inner.set(previous, diff); }
  return diff;
}
