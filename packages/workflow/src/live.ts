import type { CatalogDocument, LiveEvent } from '@incitio/schema';

export class LiveError extends Error {}

/** What a live change asks for — the rest (`before`, id, time) is the server's to fill in. */
export type LiveRequest = Pick<LiveEvent, 'kind' | 'offerId' | 'substituteId' | 'after' | 'who'>;

/**
 * One change to an avis that is out, applied to its pages and logged.
 *
 * Sold out: the stand-in takes the product's place and the product
 * waits in reserve. Back: the product takes its place back. A price:
 * the offer's price changes, and the log keeps before and after —
 * `before` read from the avis, never from the caller, because "what did
 * the shopper see" is the question the log answers.
 */
export function applyLive(document: CatalogDocument, request: LiveRequest, id: string, at: string): CatalogDocument {
  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));
  const offer = offers.get(request.offerId);
  if (!offer) throw new LiveError(`ingen vare "${request.offerId}" i avisen`);
  const placed = (offerId: string) => document.pages.some((page) => page.placements.some((p) => p.offerId === offerId));
  const log = document.live ?? [];
  const entry: LiveEvent = {
    id, at, kind: request.kind, offerId: request.offerId,
    substituteId: request.kind === 'udsolgt' ? request.substituteId ?? null : null,
    before: null, after: null, who: request.who ?? '',
  };

  const swapIn = (doc: CatalogDocument, from: string, to: string): CatalogDocument => ({
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      placements: page.placements.map((p) => (p.offerId === from ? { ...p, offerId: to } : p)),
    })),
  });

  let next: CatalogDocument = document;
  if (request.kind === 'pris') {
    const after = request.after;
    if (after === null || after === undefined || !(after > 0)) throw new LiveError('en ny pris skal være over 0');
    if (after === offer.price) throw new LiveError(`${offer.name} koster allerede ${after}`);
    entry.before = offer.price;
    entry.after = after;
    next = { ...next, offers: next.offers.map((o) => (o.id === offer.id ? { ...o, price: after } : o)) };
  } else if (request.kind === 'udsolgt') {
    if (!placed(offer.id)) throw new LiveError(`${offer.name} står ikke i avisen`);
    if (entry.substituteId) {
      if (entry.substituteId === offer.id) throw new LiveError('en vare kan ikke stå i stedet for sig selv');
      if (!offers.has(entry.substituteId)) throw new LiveError(`ingen vare "${entry.substituteId}" i avisen`);
      if (placed(entry.substituteId)) throw new LiveError(`${offers.get(entry.substituteId)!.name} står allerede i avisen`);
      next = swapIn(next, offer.id, entry.substituteId);
    }
  } else {
    const out = [...log].reverse().find((e) => e.offerId === offer.id && (e.kind === 'udsolgt' || e.kind === 'tilbage'));
    if (out?.kind !== 'udsolgt') throw new LiveError(`${offer.name} er ikke meldt udsolgt`);
    if (out.substituteId) next = swapIn(next, out.substituteId, offer.id);
  }
  return { ...next, live: [...log, entry] };
}
