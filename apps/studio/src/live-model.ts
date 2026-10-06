import { departmentOf } from '@incitio/compose';
import type { CatalogDocument, Offer } from '@incitio/schema';

/**
 * Live as data: what the reader is told about each tile, and what a
 * sold-out product may be swapped for.
 *
 * The phone and the change form each replayed the log on their own and
 * disagreed on the edge (a sold-out with a stand-in is "out" to the form
 * but not to the phone). One replay now, read by both.
 */

export interface LiveStatus {
  /** Everything currently sold out, stand-in or not. */
  soldOut: Set<string>;
  /** offerId → the tag its tile wears: "Udsolgt", "Ny pris", "I stedet for …". */
  marks: Map<string, string>;
}

export function liveStatus(document: CatalogDocument): LiveStatus {
  const names = new Map(document.offers.map((o) => [o.id, o.name]));
  const soldOut = new Set<string>();
  const standing = new Map<string, string>();
  const repriced = new Set<string>();
  for (const event of document.live ?? []) {
    if (event.kind === 'udsolgt') {
      soldOut.add(event.offerId);
      if (event.substituteId) standing.set(event.substituteId, event.offerId);
    }
    if (event.kind === 'tilbage') {
      soldOut.delete(event.offerId);
      for (const [sub, from] of standing) if (from === event.offerId) standing.delete(sub);
    }
    if (event.kind === 'pris') repriced.add(event.offerId);
  }
  const marks = new Map<string, string>();
  for (const id of repriced) marks.set(id, 'Ny pris');
  const covered = new Set(standing.values());
  for (const id of soldOut) if (!covered.has(id)) marks.set(id, 'Udsolgt');
  for (const [sub, from] of standing) marks.set(sub, `I stedet for ${names.get(from) ?? 'en udsolgt vare'}`);
  return { soldOut, marks };
}

function placedIds(document: CatalogDocument): Set<string> {
  return new Set(document.pages.flatMap((p) => p.placements.map((pl) => pl.offerId)));
}

/** Products on a page whose name or brand holds the query. */
export function findOnPages(document: CatalogDocument, query: string, limit = 6): Offer[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const placed = placedIds(document);
  return document.offers
    .filter((o) => placed.has(o.id) && `${o.name} ${o.brand}`.toLowerCase().includes(needle))
    .slice(0, limit);
}

/**
 * What may stand in for a sold-out product: the avis's reserve, its own
 * department first. Not on a page, not inside a grouped tile on one, not
 * itself sold out, and with a price of its own.
 */
export function standIns(document: CatalogDocument, offer: Offer, soldOut: Set<string>, limit = 30): Offer[] {
  const placed = placedIds(document);
  const shown = new Set(document.offers.filter((o) => placed.has(o.id)).flatMap((o) => o.members));
  const department = departmentOf(offer);
  return document.offers
    .filter((o) => !placed.has(o.id) && !shown.has(o.id) && !soldOut.has(o.id) && o.members.length === 0 && o.price > 0)
    .sort((a, b) => Number(departmentOf(b) === department) - Number(departmentOf(a) === department))
    .slice(0, limit);
}
