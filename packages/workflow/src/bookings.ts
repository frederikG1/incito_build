import type { CatalogDocument } from '@incitio/schema';
import type { Stop } from './stop.js';

/**
 * What a sold place must hold, and what it does.
 *
 * A stop, every one: a supplier who paid for the front page and finds
 * a competitor in it — or an empty cell — is a credit note, and the
 * avis is the only place it can still be caught.
 */
export function bookingFindings(document: CatalogDocument | null): Stop[] {
  if (!document) return [];
  const found: Stop[] = [];
  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));
  for (const booking of document.bookings ?? []) {
    const index = document.pages.findIndex((page) => page.id === booking.pageId);
    const page = document.pages[index];
    const base = { kind: 'solgt' as const, weight: 'stop' as const };
    if (!page) {
      found.push({
        ...base, id: `solgt:${booking.id}:side`, pageId: null, pageNumber: null, offerId: booking.offerId,
        said: `Pladsen solgt til ${booking.supplier} står på en side, der er taget ud`,
      });
      continue;
    }
    const at = { pageId: page.id, pageNumber: index + 1 };
    const placement = page.placements.find((p) => p.slotId === booking.slotId);
    if (!placement) {
      found.push({
        ...base, ...at, id: `solgt:${booking.id}:tom`, offerId: null,
        said: `Side ${index + 1}: pladsen solgt til ${booking.supplier} er tom`,
      });
      continue;
    }
    if (booking.offerId && placement.offerId !== booking.offerId
      && !offers.get(placement.offerId)?.members.includes(booking.offerId)) {
      const wanted = offers.get(booking.offerId)?.name ?? 'den aftalte vare';
      const shown = offers.get(placement.offerId)?.name ?? 'en anden vare';
      found.push({
        ...base, ...at, id: `solgt:${booking.id}:vare`, offerId: placement.offerId,
        said: `Side ${index + 1}: pladsen er solgt til ${booking.supplier} for ${wanted}, men viser ${shown}`,
      });
    }
  }
  return found;
}
