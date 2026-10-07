import {
  APPROVAL_ROLE_NAMES,
  type Brand, type CatalogDocument, type LiveEvent,
} from '@incitio/schema';
import { printFindings } from './print.js';
import { lanesOf } from './approvals.js';
import { bookingFindings } from './bookings.js';
import { priceRuleFindings, type PriceSource } from './prices.js';
import { newStops, type Stop } from './stop.js';
import { standInPrices } from './stand-in.js';

/**
 * What the server holds an avis to, whoever is writing.
 *
 * The studio already shows all of this as it is edited; these are the
 * same checks run where a script or a stale tab cannot step around them.
 * Pure, so the rules are tested here and the server only wires them.
 */

/** A local edition, resolved — the avis as that store's shoppers see it. */
export interface ResolvedEdition { id: string; name: string; document: CatalogDocument }

/** Fields only the workflow endpoints write. A plain save keeps what is stored. */
export const SERVER_OWNED = ['approvals', 'bookings', 'live'] as const;

/**
 * The incoming document with the workflow left as stored.
 *
 * A save carries the whole document, and a document the studio has
 * held for an hour carries an hour-old list of signatures. Taking the
 * stored ones is what makes a save unable to forge or drop a signature,
 * a sold place or a line of the live log — and what lets an old tab,
 * an undo or a restored version save at all. `kept` names what was
 * ignored, so a caller can tell.
 */
export function keepWorkflow(stored: CatalogDocument | null, incoming: CatalogDocument): { document: CatalogDocument; kept: string[] } {
  const kept: string[] = [];
  const next: CatalogDocument = { ...incoming };
  for (const field of SERVER_OWNED) {
    const want = stored?.[field];
    if (JSON.stringify(incoming[field] ?? []) !== JSON.stringify(want ?? [])) kept.push(field);
    if (want === undefined) delete next[field];
    else (next as Record<string, unknown>)[field] = want;
  }
  // In or out of "udgivet" is publishing, and publishing has its own door.
  const storedStatus = stored?.status ?? 'kladde';
  if (incoming.status !== storedStatus && (incoming.status === 'udgivet' || storedStatus === 'udgivet')) {
    kept.push('status');
    next.status = storedStatus;
  }
  return { document: next, kept };
}

export interface WriteVerdict {
  /** What the write would break. Non-empty: refuse it. */
  refused: Stop[];
  /** Price changes on a published avis, to be appended to its live log. */
  logged: Omit<LiveEvent, 'id' | 'at'>[];
}

/**
 * Whether a write may go through, one document (or one edition) at a time.
 *
 * A write may not break a sold place: a stop about a booking that was
 * not there before refuses it. Faults that were there already pass —
 * a place sold before it was filled is not the writer's doing.
 *
 * On a published avis it may not introduce a price that breaks the
 * price rules, nor a print stop the document can see (an emptied place,
 * a product with no price) — and every price it changes is logged as a live
 * change, so the log stays the whole answer to "what did the shopper
 * see" however the change arrived.
 */
/**
 * The price rules, minus what someone let go while the history is made up.
 * With real price history nothing is let go: the law is the law.
 */
function priceStops(doc: CatalogDocument, prices: PriceSource) {
  const found = priceRuleFindings(doc, prices);
  return prices.demo ? heeded(doc, found) : found;
}

export function checkWrite(
  before: CatalogDocument,
  after: CatalogDocument,
  options: { prices?: PriceSource; who?: string; brand?: Brand } = {},
): WriteVerdict {
  const prices = options.prices ?? standInPrices;
  const refused = newStops(bookingFindings(before), bookingFindings(after));
  const logged: WriteVerdict['logged'] = [];
  if (before.status === 'udgivet') {
    refused.push(...newStops(priceStops(before, prices), priceStops(after, prices)));
    // Nor a hole in what readers already have: an emptied place, a product without a price or picture.
    if (options.brand) refused.push(...newStops(printFindings(before, options.brand), heeded(after, printFindings(after, options.brand))));
    const then = new Map(before.offers.map((offer) => [offer.id, offer.price]));
    for (const offer of after.offers) {
      const was = then.get(offer.id);
      if (was === undefined || was === offer.price) continue;
      logged.push({ kind: 'pris', offerId: offer.id, substituteId: null, before: was, after: offer.price, who: options.who ?? '' });
    }
  }
  return { refused, logged };
}

export interface Blocker { id: string; said: string }

/**
 * The print checks left once what someone ignored is taken out — see
 * `CatalogDocument.ignored`. Print checks only; the caller never passes
 * price-rule or sold-place findings through this.
 */
export function heeded<F extends { id: string }>(document: CatalogDocument, findings: F[]): F[] {
  const ignored = new Set(document.ignored ?? []);
  return ignored.size ? findings.filter((finding) => !ignored.has(finding.id)) : findings;
}

/**
 * Why an avis may not be published yet — empty when it may.
 *
 * Every role signed, and nothing it answers for changed since; no stop
 * in the price rules, on a sold place or in the print checks — in the
 * avis and in every local edition, since a store's own offer is printed
 * under the same law. The measured print checks (the drawn page) are the
 * server's to add — see `packages/server/src/print.ts`.
 */
export function publishBlockers(
  document: CatalogDocument,
  editions: ResolvedEdition[],
  prices: PriceSource = standInPrices,
  /** With a brand, the print checks the document can answer count too — see `printFindings`. */
  brand?: Brand,
): Blocker[] {
  const blockers: Blocker[] = [];
  for (const lane of lanesOf(document)) {
    if (lane.state === 'mangler') blockers.push({ id: `godkend:${lane.role}`, said: `${APPROVAL_ROLE_NAMES[lane.role]} har ikke godkendt` });
    if (lane.state === 'forældet') {
      blockers.push({ id: `godkend:${lane.role}`, said: `${APPROVAL_ROLE_NAMES[lane.role]} skal se ${lane.changes.length} ${lane.changes.length === 1 ? 'ændring' : 'ændringer'} igen` });
    }
  }
  const stops = (doc: CatalogDocument) => [
    ...priceStops(doc, prices), ...bookingFindings(doc), ...(brand ? heeded(doc, printFindings(doc, brand)) : []),
  ].filter((stop) => stop.weight === 'stop');
  const seen = new Set<string>();
  for (const stop of stops(document)) {
    seen.add(stop.id);
    blockers.push({ id: stop.id, said: stop.said });
  }
  for (const edition of editions) {
    for (const stop of stops(edition.document)) {
      // The same fault in the base and in nineteen editions is one fault.
      if (seen.has(stop.id)) continue;
      seen.add(stop.id);
      blockers.push({ id: `${edition.id}:${stop.id}`, said: `${edition.name}: ${stop.said}` });
    }
  }
  return blockers;
}
