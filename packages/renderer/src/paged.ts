import type { IncitoEditInput, IncitoSource, Offer, PageTemplate } from '@incitio/schema';
import { incitoBlocks, type IncitoBlock } from './incito.js';

/**
 * A page published as a picture, printed as the picture — with cells.
 *
 * Most chains on Tjek publish their avis as page images (Netto, REMA,
 * Lidl), not incito. Such a page is imported as a sheet whose ground is
 * the picture (see `pagedPage` in `@incitio/publication`), and its cells
 * are ordinary cells of an ordinary layout — `TemplateSlot.rect`, the
 * same boxes a SuperBrugsen page's offers get, and edited the same way.
 *
 * The tree printed for such a page is made here, from the layout, every
 * time: one box per cell, holding the paper under the cell and the
 * cell's own crop of the picture — the product as printed, a thing that
 * can be pointed at, moved and taken away. Made rather than stored, so
 * a cell moved, grown or added in "Rediger layout" prints its new crop
 * without anything to keep in step.
 *
 * What a cell shows:
 *   - printed — nobody has put a product in it: the crop;
 *   - gone    — the product the publication printed there was taken off
 *               the page: the paper;
 *   - new     — another product stands there: the paper, and on it the
 *               chain's own tile (drawn by `PageView`, not here), so the
 *               new product is edited with every tool a tile has.
 */

/** What `pagedPage` writes on the sheet. */
export interface PagedSheet {
  image: string;
  /** The picture's own pixels. */
  width: number;
  height: number;
  /** The page's paper colour, for a cell that has none of its own. */
  paper?: string;
  /** The publication's own products, by cell, when it said what they were. */
  printed?: Record<string, { id: string; price: number }>;
}

export type CellState = 'printed' | 'gone' | 'new';

const CELL = 'cell-';

interface Page {
  incito: IncitoSource;
  placements: { offerId: string; slotId: string }[];
  incitoEdits?: Record<string, IncitoEditInput>;
}

/** The picture a sheet was made from, or null for a page printed from its own tree. */
export function pagedSheet(source: IncitoSource | null | undefined): PagedSheet | null {
  const mark = (source?.view as Record<string, unknown> | undefined)?.['paged'] as PagedSheet | undefined;
  return mark && typeof mark.image === 'string' ? mark : null;
}

/** The cell a published offer's box stands for — by the tree's slots, or by the cell it is. */
export function incitoSlotOf(
  page: { incito: IncitoSource | null; placements: { offerId: string; slotId: string }[] },
  viewId: string | null | undefined,
): string | undefined {
  if (!viewId || !page.incito) return undefined;
  if (pagedSheet(page.incito)) return viewId.startsWith(CELL) ? viewId.slice(CELL.length) : undefined;
  return Object.entries(page.incito.slots ?? {}).find(([, view]) => view === viewId)?.[0]
    ?? page.placements.find((placement) => placement.offerId === viewId)?.slotId;
}

/** What every cell of a picture page shows now. */
export function cellStates(page: Page, template: PageTemplate | null | undefined, offers: Map<string, Offer>): Map<string, CellState> {
  const sheet = pagedSheet(page.incito);
  const states = new Map<string, CellState>();
  if (!sheet || !template) return states;
  for (const slot of template.slots) {
    if (!slot.rect) continue;
    const printed = sheet.printed?.[slot.id];
    const placement = page.placements.find((entry) => entry.slotId === slot.id);
    const now = placement ? offers.get(placement.offerId) : undefined;
    if (!placement || !now) {
      states.set(slot.id, printed ? 'gone' : 'printed');
    } else if (printed && placement.offerId === printed.id && now.price === printed.price) {
      states.set(slot.id, 'printed');
    } else {
      states.set(slot.id, 'new');
    }
  }
  return states;
}

/** A cell's path in the tree, as its edits are keyed — see `keyOf`. */
const cellKey = (slotId: string) => `c-${slotId}`;

/**
 * The page's tree as it stands, for printing and for pointing at.
 *
 * Unchanged for a page printed from its own publication tree; made from
 * the layout for a page made from a picture — see the note above.
 */
export function boundIncito(page: Page, offers: Map<string, Offer>, template?: PageTemplate | null): IncitoSource {
  const sheet = pagedSheet(page.incito);
  if (!sheet) return page.incito;
  const width = Number((page.incito.view as Record<string, unknown>)['layout_width']) || page.incito.width;
  const height = Number((page.incito.view as Record<string, unknown>)['layout_height']) || page.incito.height;
  const states = cellStates(page, template, offers);
  const edits = page.incitoEdits ?? {};
  const fade = 'linear-gradient(to right, transparent, #000 7px, #000 calc(100% - 7px), transparent)';
  const fadeDown = 'linear-gradient(to bottom, transparent, #000 7px, #000 calc(100% - 7px), transparent)';

  const cells = (template?.slots ?? []).flatMap((slot) => {
    const rect = slot.rect;
    const state = states.get(slot.id);
    if (!rect || !state) return [];
    const x = rect.x * width;
    const y = rect.y * height;
    const w = rect.w * width;
    const h = rect.h * height;
    const crop = edits[`${cellKey(slot.id)}.1`];
    const touched = Boolean(crop && (crop.hidden || crop.dx || crop.dy || (crop.scale ?? 1) !== 1));
    // The paper, a little larger than the cell and faded at its edges so
    // it meets the page's own pattern without a seam. Only drawn when
    // something shows it: under an untouched crop it would only flash a
    // page of coloured boxes while the picture loads.
    const paper = state !== 'printed' || touched
      ? {
        view_name: 'View',
        layout_width: 'calc(100% + 14px)',
        layout_height: 'calc(100% + 14px)',
        layout_margin_top: -7,
        layout_margin_left: -7,
        background_color: slot.paper ?? sheet.paper ?? '#ffffff',
        style: `-webkit-mask-image:${fade},${fadeDown};-webkit-mask-composite:source-in;mask-image:${fade},${fadeDown};mask-composite:intersect`,
      }
      : { view_name: 'View', layout_width: 0, layout_height: 0 };
    const printed = state === 'printed'
      ? {
        view_name: 'View',
        style: 'position:absolute',
        layout_left: 0,
        layout_top: 0,
        layout_width: w,
        layout_height: h,
        background_image: sheet.image,
        background_image_size: `${width}px ${height}px`,
        background_image_position: `${-x}px_${-y}px`,
      }
      : { view_name: 'View', layout_width: 0, layout_height: 0 };
    return [{
      view_name: 'AbsoluteLayout',
      role: 'offer',
      id: `${CELL}${slot.id}`,
      path_key: cellKey(slot.id),
      paged_cell: true,
      style: 'position:absolute',
      layout_left: x,
      layout_top: y,
      layout_width: w,
      layout_height: h,
      clip_children: false,
      child_views: [paper, printed],
    }];
  });

  return {
    ...page.incito,
    view: { ...(page.incito.view as Record<string, unknown>), child_views: cells },
  };
}

/** The elements of a published page as it stands now — `incitoBlocks` of `boundIncito`. */
export function pageBlocks(page: Page, offers: readonly Offer[], template?: PageTemplate | null): IncitoBlock[] {
  return incitoBlocks(boundIncito(page, new Map(offers.map((offer) => [offer.id, offer])), template));
}
