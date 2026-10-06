import { resolveTemplate } from '@incitio/brands';
import {
  isImagePage, slotAssignmentOrder,
  type Brand, type CatalogDocument, type Offer, type PageTemplate, type SlotBooking, type SlotRole,
} from '@incitio/schema';
import { slotSignal, type SlotSignal } from './signals.js';

/**
 * Every place on every page, as inventory.
 *
 * A place on the front page is not a cell in a grid to the chain's
 * buyers: it is something a supplier pays for. This is the avis read
 * that way — each place with what it is worth (see `slotSignal`), what
 * stands in it, and who bought it.
 */

export interface SlotInfo {
  key: string;
  pageId: string;
  pageIndex: number;
  pageTitle: string;
  slotId: string;
  role: SlotRole | null;
  /** The place's share of the page, 0..1. */
  share: number;
  offer: Offer | null;
  signal: SlotSignal;
  booking: SlotBooking | null;
  /** 0..100 against the best place in the avis. */
  index: number;
  /** 0..1, this place's rank among the avis's places — what the heat map colours by. */
  warmth: number;
  /** "Topplads", "Plads 3" — counted within its page. */
  name: string;
}

/** How much of the page each place is: its measured box, else its cells of the grid. */
export function slotShares(template: PageTemplate): Map<string, number> {
  const cells = new Map<string, number>();
  let total = 0;
  for (const row of template.areas) {
    for (const name of row.trim().split(/\s+/)) {
      total += 1;
      if (name !== '.') cells.set(name, (cells.get(name) ?? 0) + 1);
    }
  }
  const shares = new Map<string, number>();
  for (const slot of template.slots) {
    shares.set(slot.id, slot.rect
      ? Math.min(1, Math.max(0, slot.rect.w * slot.rect.h))
      : total ? (cells.get(slot.id) ?? 0) / total : 0);
  }
  return shares;
}

export function templateOf(document: CatalogDocument, brand: Brand, templateId: string): PageTemplate | undefined {
  return resolveTemplate(brand, templateId) ?? document.templates.find((entry) => entry.id === templateId);
}

/** A name for a place, as a buyer says it: "Stor plads", "Plads 3". */
export function slotName(slot: Pick<SlotInfo, 'role' | 'slotId'>, order: number): string {
  if (slot.role === 'hero') return 'Topplads';
  if (slot.role === 'feature') return 'Stor plads';
  return `Plads ${order + 1}`;
}

export function slotsOf(document: CatalogDocument, brand: Brand): SlotInfo[] {
  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));
  const bookings = document.bookings ?? [];
  const found: SlotInfo[] = [];
  const pageCount = document.pages.length;
  document.pages.forEach((page, pageIndex) => {
    if (isImagePage(page)) return;
    const template = templateOf(document, brand, page.templateId);
    if (!template) return;
    const shares = slotShares(template);
    let seat = 0;
    for (const slot of slotAssignmentOrder(template)) {
      const placement = page.placements.find((p) => p.slotId === slot.id);
      const share = shares.get(slot.id) ?? 0;
      found.push({
        key: `${page.id}/${slot.id}`,
        pageId: page.id,
        pageIndex,
        pageTitle: page.title,
        slotId: slot.id,
        role: slot.role,
        share,
        offer: placement ? offers.get(placement.offerId) ?? null : null,
        signal: slotSignal({ brandId: document.brandId, pageIndex, pageCount, share, role: slot.role, slotId: slot.id }),
        booking: bookings.find((b) => b.pageId === page.id && b.slotId === slot.id) ?? null,
        index: 0,
        warmth: 0,
        name: slotName({ role: slot.role, slotId: slot.id }, seat++),
      });
    }
  });
  const best = Math.max(1, ...found.map((slot) => slot.signal.views));
  /*
   * Warmth by rank, not by size: the cover's big place is seen several
   * times more than anything else, and a scale stretched to reach it
   * paints every other page the same colour.
   */
  const order = [...found].sort((a, b) => a.signal.views - b.signal.views);
  order.forEach((slot, rank) => {
    slot.index = Math.round((slot.signal.views / best) * 100);
    slot.warmth = order.length > 1 ? rank / (order.length - 1) : 1;
  });
  return found;
}

export { bookingFindings } from '@incitio/workflow';
