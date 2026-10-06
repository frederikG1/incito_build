import type { Brand, CatalogDocument, CatalogWeek, IncitoEdit, Offer, PageTemplate, FrameLine, Placement, PlacementOverrides, SlotRole, TemplateSlot } from '@incitio/schema';
import { CatalogPage, slotAssignmentOrder, slotCells } from '@incitio/schema';
import { rememberPrinted } from '@incitio/schema';
import { weekOf } from '@incitio/schema';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import { incitoOfferBoxes, offerViewIds, packStyle } from '@incitio/renderer';
import * as api from '../api.js';
import { DEPARTMENT_NAMES, pageDepartment, type Department } from '@incitio/compose';
import { count } from './model.js';
import { isVariantPiece, withTemplates } from './cluster.js';

/** A placement nobody has corrected yet. */
export const FRESH: PlacementOverrides = {
  pinned: false,
  crowdOk: false,
  arrangement: null,
  displayName: null,
  description: null,
  imageScale: 1,
  imageOffsetX: 0,
  imageOffsetY: 0,
  parts: {},
  pack: {},
};

/**
 * This page's placements in prominence order — lead first.
 *
 * Read off the template the page is currently using, so "the weakest
 * offer" means the one in the least prominent slot rather than the one
 * that happens to be last in the array. A placement naming a slot the
 * template does not have is a stale edit and sorts to the end.
 */
export function seatOrder(page: CatalogPage, brand: Brand): Placement[] {
  const template = resolveTemplate(brand, page.templateId);
  if (!template) return page.placements;
  const rank = new Map(slotAssignmentOrder(template).map((slot, i) => [slot.id, i]));
  return [...page.placements].sort(
    (a, b) => (rank.get(a.slotId) ?? 99) - (rank.get(b.slotId) ?? 99),
  );
}

/**
 * Put a page's offers into a different template's slots.
 *
 * Prominence is carried across rather than slot ids: the offer leading
 * the old layout leads the new one, whatever the two layouts happen to
 * have called their cells. Matching on slot id instead would work only
 * while two templates share a naming convention, and would silently
 * scatter the page the first time they did not.
 *
 * Corrections travel with the offer. Someone who nudged a packshot and
 * then tried three layouts should not lose the nudge to the second one.
 */
/** A cell's size on the page, in shares of it, and what it is for. */
export type CellSize = { w: number; h: number; role: SlotRole };

/** How far a cell's shape may change before a tile's nudges no longer fit it. */
export const SHAPE_KEEPS = 1.25;

export function cellSize(brand: Brand, templates: PageTemplate[], templateId: string, slotId: string): CellSize | null {
  const template = templates.find((t) => t.id === templateId) ?? resolveTemplate(brand, templateId);
  const slot = template?.slots.find((entry) => entry.id === slotId);
  if (!template || !slot) return null;
  if (slot.rect) return { w: slot.rect.w, h: slot.rect.h, role: slot.role };
  const cell = slotCells(template, brand.pageAspect).get(slotId);
  if (!cell) return null;
  return { w: cell.width, h: (cell.width * brand.pageAspect) / cell.aspect, role: slot.role };
}

export type Rect = { x: number; y: number; w: number; h: number };

/** `box` shrunk or grown evenly to fit `into`, and centred in it — how a printed offer follows its cell. */
export function fitBox(box: Rect, into: Rect): Rect {
  const k = Math.min(into.w / box.w, into.h / box.h);
  return { x: into.x + (into.w - box.w * k) / 2, y: into.y + (into.h - box.h * k) / 2, w: box.w * k, h: box.h * k };
}

/**
 * The box a published page's offer was printed in — what its cell grows
 * and shrinks around — or `null` on a page drawn by the chain's tiles.
 */
export function printedBase(page: CatalogPage, placement: Placement): Rect | null {
  const incito = page.incito;
  if (!incito || !page.exact || (incito.view as { paged?: unknown }).paged) return null;
  const base = incito.cellBase?.[placement.slotId];
  if (base) return base;
  const views = offerViewIds(incito.view as Parameters<typeof offerViewIds>[0]);
  const view = incito.slots?.[placement.slotId] ?? (views.has(placement.offerId) ? placement.offerId : undefined);
  return view ? incitoOfferBoxes(incito).get(view) ?? null : null;
}

/**
 * The room a tile is actually drawn in.
 *
 * On a published page the offer is its printed design fitted evenly into
 * the cell (`cellFit`), so the box keeps the print's shape whatever the
 * cell's — and a cluster's composition, laid out in that box, is carried
 * by the change in THAT box, evenly, not by the cell's.
 */
export function tileSize(cell: CellSize | null, base: Rect | null): CellSize | null {
  if (!cell || !base || base.w <= 0 || base.h <= 0) return cell;
  const k = Math.min(cell.w / base.w, cell.h / base.h);
  return { w: base.w * k, h: base.h * k, role: cell.role };
}

/**
 * A tile's own corrections, carried into a cell of another size.
 *
 * The products in a cluster are nudged in PAGE percent while the
 * pictures themselves grow and shrink with the cell — so a tile moved to
 * a bigger cell kept its nudges and lost its arrangement: the products
 * grew, their offsets did not, and they slid over each other. Scaling
 * the offsets by the change in the cell's size keeps every product where
 * it was relative to the tile.
 *
 * The base arrangement is pinned for the same reason. Left to itself it
 * is picked by the cell's ROLE, so a tile moved from a hero cell to an
 * ordinary one changed its whole arrangement under the nudges laid on it.
 */
export function carryOverrides(
  overrides: Placement['overrides'],
  offer: Offer | undefined,
  from: CellSize | null,
  to: CellSize | null,
): Placement['overrides'] {
  if (!from || !to || from.w <= 0 || from.h <= 0 || to.h <= 0) return overrides;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  /*
   * Nudges are made for a SHAPE. Scaled apart into a cell of another
   * one — a tall cell turned wide — x grows, y shrinks, and the products
   * slide off each other. Past a quarter's change:
   *
   *   - a cluster's composition keeps its shape, grown or shrunk evenly
   *     to what the new cell has room for. It is the arranged group —
   *     the model's, or somebody's by hand — and the point of the tile;
   *   - the words and the price go back to where the cell's design puts
   *     them, which is drawn for the new shape.
   */
  const reshaped = Math.abs(Math.log(sx / sy)) > Math.log(SHAPE_KEEPS);
  const even = Math.min(sx, sy);
  const pack = Object.fromEntries(Object.entries(overrides.pack ?? {}).map(([key, item]) => [key, {
    ...item,
    offsetX: clamp(item.offsetX * (reshaped ? even : sx), 100),
    offsetY: clamp(item.offsetY * (reshaped ? even : sy), 100),
  }]));
  const parts = Object.fromEntries(Object.entries(overrides.parts ?? {}).map(([key, part]) => [key, reshaped
    ? { ...part, offsetX: 0, offsetY: 0, scale: 1 }
    : { ...part, offsetX: clamp(part.offsetX * sx, 25), offsetY: clamp(part.offsetY * sy, 25) }]));
  const touched = Object.keys(overrides.pack ?? {}).length > 0;
  const count = offer?.imagePack.length ?? 0;
  const arrangement = overrides.arrangement
    ?? (touched && offer && count > 1 ? packStyle(offer.id, count, from.role) : null);
  return { ...overrides, pack, parts, arrangement } as Placement['overrides'];
}

/**
 * A chain layout laid into a page that was read off a publication.
 *
 * Such a page has its cells in measured boxes, under the publication's
 * own headline and banner, and each cell carries the publication's own
 * design for the tile in it — where the packshot, the price mark and the
 * words sit (`TemplateSlot.frame`). Swapped for a chain layout as it
 * stands, the grid started at the top of the sheet, over the headline,
 * every tile fell back to the chain's own design, and the lead became
 * the chain's red feature band — the page stopped looking like itself.
 *
 * So the chain's layout is drawn INTO the area the page's cells already
 * use, and every product takes its own design with it: a frame is in
 * shares of its cell, so it fits a cell of any size. A product arriving
 * in a cell with no frame of its own borrows the page's commonest one.
 * The result is a layout of the page's own, like one shaped by hand.
 */
export function fitLayout(
  document: CatalogDocument,
  brand: Brand,
  page: CatalogPage,
  next: PageTemplate,
  placements: Placement[],
): { template: PageTemplate; placements: Placement[]; notes: CatalogPage['notes']; decorations: CatalogPage['decorations'] } | null {
  const current = document.templates.find((t) => t.id === page.templateId);
  if (!current || !current.slots.every((slot) => slot.rect)) return null;
  const rects = current.slots.map((slot) => slot.rect!);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  // Kept on the paper even when a measured hero ran off it.
  const box = { x: Math.max(0.02, x0), y: Math.max(0.02, y0), w: 0, h: 0 };
  box.w = Math.min(0.98, x1) - box.x;
  box.h = Math.min(0.98, y1) - box.y;

  const columns = next.areas[0]!.split(' ').length;
  const rows = next.areas.length;
  const gap = 0.014;
  const cw = (box.w - gap * (columns - 1)) / columns;
  const rh = (box.h - gap * (rows - 1)) / rows;
  const grid = next.areas.map((row) => row.split(' '));

  // Frames by the product that wore them — with the cell they were
  // measured in — and the page's commonest one.
  type Worn = { frame: NonNullable<TemplateSlot['frame']>; rect: NonNullable<TemplateSlot['rect']> };
  const worn = (slot: TemplateSlot | undefined): Worn | undefined =>
    slot?.frame && slot.rect ? { frame: slot.frame, rect: slot.rect } : undefined;
  const frameOf = new Map(page.placements.map((placement) => [
    placement.offerId,
    worn(current.slots.find((slot) => slot.id === placement.slotId)),
  ]));
  // Every frame the document's own layouts carry — this page's first, then
  // the rest of the publication's, which share its design.
  const frames = [
    ...current.slots.map(worn),
    ...document.templates.filter((t) => t.id !== current.id).flatMap((t) => t.slots.map(worn)),
  ].filter((entry): entry is Worn => Boolean(entry));
  const common = frames[Math.floor(Math.min(frames.length, current.slots.length) / 2)];

  /*
   * A frame is drawn for a SHAPE. A hero's — packshot on the left, words in
   * a narrow column on the right — squeezed into a square cell put the
   * words in a sliver and the products in a corner. So a product keeps its
   * own frame only while the new cell is roughly the shape it was made
   * for; otherwise it borrows the page's frame whose cell is the nearest
   * shape, which is how that page lays out a cell like this one.
   */
  // Width over height as printed, for a cell in shares of the page.
  const printed = (rect: { w: number; h: number }) => (rect.w / rect.h) * brand.pageAspect;
  // The shape a frame was drawn for: stated, or read off its words — set
  // beside the packshot is a frame for a wide cell, beneath it a square one.
  const designed = (entry: Worn) => {
    const f = entry.frame;
    if (f.shape) return f.shape;
    const beside = f.words && f.words.x >= f.media.x + f.media.w * 0.7;
    return beside ? 2 : 1.1;
  };
  const shapeGap = (entry: Worn, rect: { w: number; h: number }) =>
    Math.abs(Math.log(designed(entry) / printed(rect)));
  const frameFor = (own: Worn | undefined, rect: { w: number; h: number }): Worn | undefined => {
    if (own && shapeGap(own, rect) < Math.log(1.35)) return own;
    const nearest = [...frames].sort((a, b) => shapeGap(a, rect) - shapeGap(b, rect))[0];
    if (!nearest) return own ?? common;
    if (own && shapeGap(own, rect) <= shapeGap(nearest, rect)) return own;
    return nearest;
  };

  /*
   * The frame's type is set in shares of the PAGE, so in a smaller cell
   * the price and the words stayed their old size and burst out of it.
   * Scaled by the change in the cell's area — not its tighter side, which
   * shrank the copy a little further at every change of layout — the
   * copy keeps its proportion to the tile, and grows back with it.
   */
  const resized = (entry: Worn, rect: { w: number; h: number }): Worn['frame'] => {
    const k = Math.max(0.45, Math.min(1.6, Math.sqrt((rect.w * rect.h) / (entry.rect.w * entry.rect.h))));
    if (Math.abs(k - 1) < 0.02) return entry.frame;
    const line = (l: FrameLine): FrameLine => ({
      ...l,
      size: Math.min(0.5, l.size * k),
      ...(l.margin ? { margin: l.margin.map((m) => m * k) } : {}),
      ...(typeof l.width === 'number' ? { width: Math.min(1, l.width * k) } : {}),
    });
    const f = entry.frame;
    return {
      ...f,
      ...(f.type ? { type: { name: f.type.name * k, body: f.type.body * k, figure: Math.min(0.5, f.type.figure * k), pack: f.type.pack * k } } : {}),
      ...(f.priceLines ? { priceLines: f.priceLines.map(line) } : {}),
      ...(f.badges ? { badges: f.badges.map((b) => ({ ...b, lines: b.lines.map(line) })) } : {}),
    };
  };

  const slots = next.slots.map((slot) => {
    let c0 = Infinity; let c1 = -1; let r0 = Infinity; let r1 = -1;
    grid.forEach((row, r) => row.forEach((id, c) => {
      if (id !== slot.id) return;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }));
    const rect = {
      x: box.x + c0 * (cw + gap),
      y: box.y + r0 * (rh + gap),
      w: (c1 - c0 + 1) * cw + (c1 - c0) * gap,
      h: (r1 - r0 + 1) * rh + (r1 - r0) * gap,
    };
    const offerId = placements.find((placement) => placement.slotId === slot.id)?.offerId;
    const own = offerId ? frameOf.get(offerId) : undefined;
    const borrowed = frameFor(own, rect);
    /*
     * A borrowed frame lends its LAYOUT; the price mark stays the
     * product's own — "Ugens køb" on its red roundel is what the offer
     * is, and it should not turn into the next cell's white bubble.
     */
    const source = borrowed && own && borrowed !== own
      ? {
        ...borrowed,
        frame: {
          ...borrowed.frame,
          splash: own.frame.splash,
          priceInk: own.frame.priceInk,
          priceLines: own.frame.priceLines,
          priceStack: own.frame.priceStack,
          ...(own.frame.type && borrowed.frame.type
            ? { type: { ...borrowed.frame.type, figure: own.frame.type.figure * Math.sqrt((borrowed.rect.w * borrowed.rect.h) / (own.rect.w * own.rect.h)), pack: own.frame.type.pack * Math.sqrt((borrowed.rect.w * borrowed.rect.h) / (own.rect.w * own.rect.h)) } }
            : {}),
        },
      }
      : borrowed;
    const frame = source ? { ...resized(source, rect), shape: designed(borrowed!) } : undefined;
    return {
      ...slot,
      // The chain's red band is its own furniture, not this page's.
      role: slot.role === 'feature' ? 'hero' as const : slot.role,
      rect,
      ...(frame ? { frame } : {}),
    };
  });

  /*
   * What the page laid ON a product goes with it: "Storkøb min. 1,3 kg"
   * belongs to the bananas, the splash of fries to the potatoes. A note
   * or a picture whose middle sat in a product's old cell keeps its place
   * relative to that cell in the product's new one; everything else — the
   * headline, the banner — stays where the page put it.
   */
  /*
   * Everything laid on a product moves as ONE piece with it — the same
   * even scale, the same centring — or the tile comes apart: the motif
   * one way, the group another, "Storkøb" a third. The piece is the box
   * the offer is drawn in (its print fitted into the cell, on a
   * published page), so what was on the tile stays where it was on it.
   */
  const moves = page.placements.map((placement) => {
    const cell = current.slots.find((slot) => slot.id === placement.slotId)?.rect;
    const target = slots.find((slot) => slot.id === placements.find((p) => p.offerId === placement.offerId)?.slotId)?.rect;
    if (!cell || !target) return null;
    const base = printedBase(page, placement);
    const from = base ? fitBox(base, cell) : cell;
    const to = fitBox(from, base ? fitBox(base, target) : target);
    return { cell, from, to, k: to.w / from.w };
  }).filter((move): move is NonNullable<typeof move> => Boolean(move));
  const carrierOf = (cx: number, cy: number) => moves.find(({ cell }) =>
    cx >= cell.x && cx <= cell.x + cell.w && cy >= cell.y && cy <= cell.y + cell.h);
  const clampPos = (v: number) => Math.min(1.5, Math.max(-0.5, v));
  const carry = (move: (typeof moves)[number], x: number, y: number) => ({
    x: move.to.x + (x - move.from.x) * move.k,
    y: move.to.y + (y - move.from.y) * move.k,
  });
  const notes = (page.notes ?? []).map((note) => {
    if (note.behind) return note;
    const h = note.h ?? 0.03;
    const move = carrierOf(note.x + note.w / 2, note.y + h / 2);
    if (!move) return note;
    const at = carry(move, note.x, note.y);
    return {
      ...note,
      x: clampPos(at.x),
      y: clampPos(at.y),
      w: Math.min(2, Math.max(0.02, note.w * move.k)),
      ...(note.h !== null ? { h: Math.min(2, Math.max(0.01, note.h * move.k)) } : {}),
      size: Math.min(0.3, Math.max(0.005, note.size * move.k)),
    };
  });
  const ratio = brand.pageAspect;
  const decorations = page.decorations.map((decor) => {
    if (decor.id.startsWith('pub-masthead')) return decor;
    if (decor.rect) {
      const r = decor.rect;
      const move = carrierOf(r.x + r.w / 2, r.y + r.h / 2);
      if (!move) return decor;
      const at = carry(move, r.x, r.y);
      return {
        ...decor,
        rect: {
          x: clampPos(at.x), y: clampPos(at.y),
          w: Math.min(2, Math.max(0.01, r.w * move.k)),
          h: Math.min(2, Math.max(0.01, r.h * move.k)),
        },
      };
    }
    /*
     * A picture hung off a corner — an AI motif beside its product. Its
     * corner point is carried (see `motifDecoration` for the geometry),
     * so a bottom- or right-hung picture needs no height to move.
     */
    const w = decor.scale;
    const left = decor.anchor.endsWith('left');
    const top = decor.anchor.startsWith('top');
    const bleedX = 0.14 * w;
    const bleedY = 0.14 * w * ratio;
    const px = left ? decor.offsetX / 100 - bleedX : decor.offsetX / 100 + 1 + bleedX;
    const py = top ? decor.offsetY / 100 - bleedY : decor.offsetY / 100 + 1 + bleedY;
    // Its middle, near enough to tell which tile it stands by.
    const cx = left ? px + w / 2 : px - w / 2;
    const cy = top ? py + (w * ratio) / 2 : py - (w * ratio) / 2;
    const move = carrierOf(cx, cy);
    if (!move) return decor;
    const at = carry(move, px, py);
    const scale = Math.min(0.6, Math.max(0.05, w * move.k));
    const bx = 0.14 * scale;
    const by = 0.14 * scale * ratio;
    const round = (v: number) => Math.round(Math.min(75, Math.max(-75, v * 100)) * 10) / 10;
    return {
      ...decor,
      scale,
      offsetX: round(left ? at.x + bx : at.x - 1 - bx),
      offsetY: round(top ? at.y + by : at.y - 1 - by),
    };
  });

  const id = `own/${page.id}`;
  const template: PageTemplate = { ...next, id, name: `${next.name} — i sidens egen stil`, slots };
  const templates = [...document.templates.filter((t) => t.id !== id), template];
  return {
    template,
    notes,
    decorations,
    placements: placements.map((placement) => {
      const before = page.placements.find((entry) => entry.offerId === placement.offerId);
      return {
        ...placement,
        overrides: before
          ? carryOverrides(
            before.overrides,
            document.offers.find((offer) => offer.id === placement.offerId),
            tileSize(cellSize(brand, document.templates, page.templateId, before.slotId), printedBase(page, before)),
            tileSize(cellSize(brand, templates, id, placement.slotId), printedBase(page, before)),
          )
          : placement.overrides,
      };
    }),
  };
}

export function reseat(
  page: CatalogPage,
  brand: Brand,
  next: PageTemplate,
  document?: CatalogDocument,
): Placement[] {
  const slots = slotAssignmentOrder(next);
  const templates = [...(document?.templates ?? []), next];
  return seatOrder(page, brand)
    .slice(0, slots.length)
    .map((placement, index) => {
      const slotId = slots[index]!.id;
      if (!document) return { ...placement, slotId };
      const offer = document.offers.find((entry) => entry.id === placement.offerId);
      return {
        ...placement,
        slotId,
        overrides: carryOverrides(
          placement.overrides,
          offer,
          tileSize(cellSize(brand, templates, page.templateId, placement.slotId), printedBase(page, placement)),
          tileSize(cellSize(brand, templates, next.id, slotId), printedBase(page, placement)),
        ),
      };
    });
}

/**
 * Offers built into the document that no page is showing.
 *
 * A product inside a placed group is ON the page, even though no
 * placement names it: the tile shows its photograph and the price
 * covers it. Counting it as bench would tell the editor there are six
 * spare products waiting when in fact they are printed.
 */
export function benchOf(document: CatalogDocument): Offer[] {
  const placed = new Set(document.pages.flatMap((p) => p.placements).map((p) => p.offerId));
  const shown = new Set(document.offers
    .filter((offer) => placed.has(offer.id))
    .flatMap((offer) => offer.members));
  return document.offers.filter(
    (offer) => !placed.has(offer.id) && !shown.has(offer.id) && !isVariantPiece(offer.id),
  );
}

/**
 * A published page's tree, told where each of its offers stands now.
 *
 * The tree finds an offer's printed design by the NAME of its cell
 * (`IncitoSource.slots`), and every layout names its cells a, b, c… — so
 * a product moved into a new layout's "a" was drawn in the design of
 * whichever offer the publication printed in its "a": another product's
 * price mark, another product's words. The names are rewritten to follow
 * the products, and each cell's starting box (`cellBase`) with them.
 */
export function incitoFollows(page: CatalogPage, placements: Placement[]): CatalogPage['incito'] {
  const incito = page.incito;
  if (!incito || (incito.view as { paged?: unknown }).paged) return incito;
  const views = offerViewIds(incito.view as Parameters<typeof offerViewIds>[0]);
  const printed = incitoOfferBoxes(incito);
  const slots: Record<string, string> = {};
  const cellBase: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const placement of placements) {
    const before = page.placements.find((entry) => entry.offerId === placement.offerId);
    const view = before
      ? incito.slots?.[before.slotId] ?? (views.has(placement.offerId) ? placement.offerId : undefined)
      : undefined;
    if (!view || !views.has(view)) continue;
    slots[placement.slotId] = view;
    const base = (before ? incito.cellBase?.[before.slotId] : undefined) ?? printed.get(view);
    if (base) cellBase[placement.slotId] = base;
  }
  return { ...incito, slots, cellBase };
}

/**
 * The facts a rule reads, filled in from the week's file on products
 * saved before the reader knew them — billedtype, besparelse i %,
 * kampagne, medlemspris, mængderabat. Only what is missing: nothing the
 * avis already says, and nothing anybody wrote, is replaced.
 */
export function withFeedFacts(document: CatalogDocument, feed: Offer[]): CatalogDocument {
  const byId = new Map(feed.map((offer) => [offer.id, offer]));
  let changed = false;
  const offers = document.offers.map((offer) => {
    const fresh = byId.get(offer.id);
    if (!fresh) return offer;
    const patch: Partial<Offer> = {};
    if ((offer.imageKind ?? null) === null && fresh.imageKind) patch.imageKind = fresh.imageKind;
    if ((offer.savingsPercent ?? null) === null && fresh.savingsPercent !== null) patch.savingsPercent = fresh.savingsPercent;
    if (!offer.campaign && fresh.campaign) patch.campaign = fresh.campaign;
    if ((offer.memberPrice ?? null) === null && fresh.memberPrice !== null) patch.memberPrice = fresh.memberPrice;
    const missing = fresh.labels.filter((label) => label.kind === 'multibuy'
      && !offer.labels.some((own) => own.kind === 'multibuy'));
    if (missing.length > 0) patch.labels = [...offer.labels, ...missing];
    if (Object.keys(patch).length === 0) return offer;
    changed = true;
    return { ...offer, ...patch };
  });
  return changed ? { ...document, offers } : document;
}

/** The page put on another layout with the same number of cells. */
export function onTemplate(document: CatalogDocument, brand: Brand, pageId: string, next: PageTemplate): CatalogDocument {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page) return document;
  const seated = reseat(page, brand, next, document);
  // A page in its own style keeps it — see `fitLayout`.
  const fitted = next.id.startsWith('own/') ? null : fitLayout(document, brand, page, next, seated);
  return {
    ...document,
    templates: fitted
      ? [...document.templates.filter((t) => t.id !== fitted.template.id), fitted.template]
      : document.templates,
    pages: document.pages.map((entry) => (entry.id === pageId
      ? {
        ...entry,
        templateId: fitted?.template.id ?? next.id,
        placements: fitted?.placements ?? seated,
        incito: incitoFollows(entry, fitted?.placements ?? seated),
        ...(fitted ? { notes: fitted.notes, decorations: fitted.decorations } : {}),
      }
      : entry)),
  };
}

/**
 * The page at another number of products: dropping takes from the
 * bottom of the page, adding fills the weakest cells from the bench.
 */
export function atCount(
  document: CatalogDocument, brand: Brand, pageId: string, count: number, chosen: PageTemplate | null,
): CatalogDocument {
  const page = document.pages.find((p) => p.id === pageId);
  if (!page) return document;
  /*
   * A layout at the new count, preferring one whose shape is closest to
   * the current page's — a six-up that becomes a three-up should not
   * also swap its hero for a flat row unless the brand has nothing else.
   */
  const here = resolveTemplate(brand, page.templateId);
  const next = chosen
    ?? templatesForCount(brand, count).find((t) => t.slots[0]?.role === here?.slots[0]?.role)
    ?? templatesForCount(brand, count)[0];
  if (!next) return document;

  const offers = seatOrder(page, brand).slice(0, count).map((p) => p.offerId);
  for (const offer of benchOf(document)) {
    if (offers.length >= count) break;
    offers.push(offer.id);
  }
  if (offers.length === 0) return document;

  const kept = new Map(page.placements.map((p) => [p.offerId, p]));
  const slots = slotAssignmentOrder(next).slice(0, offers.length);
  const seated = slots.map((slot, index) => {
    const offerId = offers[index]!;
    const before = kept.get(offerId);
    // An offer coming off the bench has no corrections yet;
    // one that was already here keeps the ones it has.
    return before
      ? {
        ...before,
        slotId: slot.id,
        overrides: carryOverrides(
          before.overrides,
          document.offers.find((entry) => entry.id === offerId),
          tileSize(cellSize(brand, document.templates, page.templateId, before.slotId), printedBase(page, before)),
          tileSize(cellSize(brand, [...document.templates, next], next.id, slot.id), printedBase(page, before)),
        ),
      }
      : { offerId, slotId: slot.id, overrides: FRESH };
  });
  // A page in its own style keeps it — see `fitLayout`. The
  // corrections are already carried; fitting only moves the cells.
  const fitted = fitLayout(document, brand, page, next, seated.map((placement) => {
    const before = kept.get(placement.offerId);
    return before ? { ...placement, overrides: before.overrides } : placement;
  }));
  return {
    ...document,
    templates: fitted
      ? [...document.templates.filter((t) => t.id !== fitted.template.id), fitted.template]
      : document.templates,
    pages: document.pages.map((p) => (p.id === pageId
      ? {
        ...p,
        templateId: fitted?.template.id ?? next.id,
        placements: fitted?.placements ?? seated,
        incito: incitoFollows(p, fitted?.placements ?? seated),
        ...(fitted ? { notes: fitted.notes, decorations: fitted.decorations } : {}),
      }
      : p)),
  };
}

/** Bumped when carrying changes, so a layout remembered by the old carry is not brought back. */
export const LAYOUT_MEMORY_V = 2;

/** Which of the gallery's layouts the page is in — its template's id when none. */
export function layoutKey(page: CatalogPage): string {
  return page.layout && page.layout.templateId === page.templateId ? page.layout.option : page.templateId;
}

/**
 * The page in one of the gallery's layouts — worked out, not applied.
 *
 * Pure, so the gallery can draw the page in every layout before any is
 * chosen, and the choice is the drawing it showed. The layout the page
 * is leaving is written down on the page first, and a layout it has
 * been in before comes back as it was left: trying three shapes and
 * returning to the first must give the first back, not the third
 * stretched into it.
 */
export function pageInLayout(
  document: CatalogDocument, brand: Brand, pageId: string, option: PageTemplate,
): CatalogDocument | null {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page) return null;
  const known = document.templates.some((t) => t.id === option.id)
    ? document
    : { ...document, templates: [...document.templates, option] };
  const chain = withTemplates(brand, known.templates);
  const current = known.templates.find((t) => t.id === page.templateId) ?? resolveTemplate(chain, page.templateId);
  const leaving = layoutKey(page);
  const layouts = current
    ? {
      ...page.layouts,
      [leaving]: { v: LAYOUT_MEMORY_V, template: current, placements: page.placements, notes: page.notes, decorations: page.decorations },
    }
    : page.layouts;

  const memory = option.id === leaving ? undefined : page.layouts?.[option.id];
  const bench = new Set(benchOf(known).map((offer) => offer.id));
  const here = new Set(page.placements.map((p) => p.offerId));
  // Only while every product it held is still here or on the bench.
  const recallable = memory && memory.v === LAYOUT_MEMORY_V && memory.placements.length > 0 && memory.placements.every(
    (p) => here.has(p.offerId) || bench.has(p.offerId),
  );

  let next: CatalogDocument;
  if (recallable) {
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((entry) => [entry.id, entry]));
    const notes = byId(memory.notes);
    const decorations = byId(memory.decorations);
    next = {
      ...known,
      templates: [...known.templates.filter((t) => t.id !== memory.template.id), memory.template],
      pages: known.pages.map((entry) => (entry.id === pageId
        ? {
          ...entry,
          templateId: memory.template.id,
          placements: memory.placements,
          incito: incitoFollows(entry, memory.placements),
          // Where the words and pictures stood — what they say is today's.
          notes: entry.notes.map((note) => {
            const was = notes.get(note.id);
            return was ? { ...note, x: was.x, y: was.y, w: was.w, h: was.h, size: was.size } : note;
          }),
          decorations: entry.decorations.map((decor) => {
            const was = decorations.get(decor.id);
            return was ? { ...decor, rect: was.rect } : decor;
          }),
        }
        : entry)),
    };
  } else if (option.slots.length === page.placements.length) {
    next = onTemplate(known, chain, pageId, option);
  } else {
    next = atCount(known, chain, pageId, option.slots.length, option);
  }
  if (next === known) return null;
  return {
    ...next,
    pages: next.pages.map((entry) => (entry.id === pageId
      ? { ...entry, layouts, layout: { option: option.id, templateId: entry.templateId } }
      : entry)),
  };
}

/* -------------------------------------------------- the week, carried */

export const DIFF_NAMES: Record<string, string> = {
  price: 'pris', prePrice: 'førpris', savings: 'besparelse', savingsMax: 'besparelse',
  priceFrom: '"fra"', comparison: 'enhedspris', validFrom: 'gyldighed', validTo: 'gyldighed',
  name: 'navn', description: 'underlinje', imageUrl: 'billede',
};

export function kroner(value: unknown): string {
  return typeof value === 'number'
    ? value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}

/**
 * Whether a file is corrections to the open avis or another leaflet.
 *
 * Half of what the pages show must be in the file. Wednesday's
 * corrections to this week keep nearly every product; a different
 * leaflet — another week, another edition — shares a handful, and
 * applying it would mark the rest as pulled from the shelves.
 */
export function sameAvis(arrival: { onPages: number; matched: number }): boolean {
  return arrival.onPages > 0 && arrival.matched / arrival.onPages >= 0.5;
}

/**
 * A published page learns which of its cells held which offer, the
 * first time one of them is refilled.
 *
 * Pages imported before `IncitoSource.slots` existed only know it by
 * id — the placement names the publication's own offer — and a refill
 * erases exactly that. Read off the page as it was the moment before,
 * the cell keeps its layout for whatever is put in it.
 */
export function rememberCells(before: CatalogDocument, after: CatalogDocument): CatalogDocument {
  if (before === after) return after;
  let changed = false;
  /*
   * Products leaving the avis — a feed's "udgået", a new week — may be
   * the ones a published page printed. The page writes down what it
   * printed first, so it can still put the new product in its place.
   */
  const learned = before.offers === after.offers
    ? after.pages
    : after.pages.map((page) => rememberPrinted(page, before.offers));
  if (learned.some((page, index) => page !== after.pages[index])) changed = true;
  /*
   * A published page's cells, the first time "Rediger layout" moves one:
   * where they stood before, so the offer in each follows by the change —
   * see `incitoCellBoxes`. A cell already far from its offer's printed box
   * was moved before this was kept, and starts from the printed box.
   */
  const based = before.templates === after.templates ? learned : learned.map((page) => {
    if (!page.incito || page.incito.cellBase || (page.incito.view as { paged?: unknown }).paged) return page;
    const was = before.templates.find((entry) => entry.id === page.templateId);
    const now = after.templates.find((entry) => entry.id === page.templateId);
    if (!was || !now || was === now) return page;
    const drawn = incitoOfferBoxes(page.incito);
    const cellBase: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const slot of was.slots) {
      if (!slot.rect) continue;
      const viewId = page.incito.slots?.[slot.id]
        ?? page.placements.find((entry) => entry.slotId === slot.id)?.offerId;
      const printed = viewId ? drawn.get(viewId) : undefined;
      const apart = printed && ['x', 'y', 'w', 'h'].some((key) => (
        Math.abs(printed[key as 'x'] - slot.rect![key as 'x']) > 0.03));
      cellBase[slot.id] = apart && printed ? printed : slot.rect;
    }
    changed = true;
    return { ...page, incito: { ...page.incito, cellBase } };
  });
  const pages = based.map((page) => {
    if (!page.incito || Object.keys(page.incito.slots ?? {}).length > 0) return page;
    const was = before.pages.find((entry) => entry.id === page.id);
    if (!was || was.placements === page.placements) return page;
    const views = offerViewIds(page.incito.view as never);
    const slots = Object.fromEntries(was.placements
      .filter((placement) => views.has(placement.offerId))
      .map((placement) => [placement.slotId, placement.offerId]));
    if (Object.keys(slots).length === 0) return page;
    changed = true;
    return { ...page, incito: { ...page.incito, slots } };
  });
  return changed ? { ...after, pages } : after;
}

/** Every correction field of an element, filled in — see `IncitoEdit`. */
export const UNEDITED: IncitoEdit = { hidden: false, dx: 0, dy: 0, scale: 1 };

/**
 * One change to some elements of one published page.
 *
 * An element whose record ends up saying nothing — shown, unmoved, at
 * its own size, in its own words — loses the record, so the page's
 * edits list only what somebody actually changed.
 */
export function withIncitoEdit(
  document: CatalogDocument, pageId: string, paths: string[], change: (was: IncitoEdit) => IncitoEdit,
): CatalogDocument {
  return {
    ...document,
    pages: document.pages.map((page) => {
      if (page.id !== pageId) return page;
      const edits = { ...(page.incitoEdits ?? {}) };
      for (const path of paths) {
        const next = change({ ...UNEDITED, ...edits[path] });
        if (!next.texts) delete next.texts;
        const plain = !next.hidden && !next.texts && next.dx === 0 && next.dy === 0 && next.scale === 1;
        if (plain) delete edits[path];
        else edits[path] = next;
      }
      return { ...page, incitoEdits: edits };
    }),
  };
}

/** Offers the avis carries and no page shows, alone or inside a grouped tile. */
export function unplaced(document: CatalogDocument): Offer[] {
  const placed = new Set(document.pages.flatMap((page) => page.placements)
    .map((placement) => placement.offerId));
  const shown = new Set(document.offers
    .filter((offer) => placed.has(offer.id))
    .flatMap((offer) => offer.members));
  return document.offers.filter((offer) => !placed.has(offer.id) && !shown.has(offer.id));
}

/** The products a page prints, grouped tiles read as their members. */
export function offersOnPage(document: CatalogDocument, pageId: string): Offer[] {
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const page = document.pages.find((entry) => entry.id === pageId);
  return (page?.placements ?? [])
    .map((placement) => byId.get(placement.offerId))
    .filter((offer): offer is Offer => Boolean(offer));
}

/** What a page is about, for naming it in the gallery and the book. */
export function departmentOfPage(document: CatalogDocument, pageId: string): Department | null {
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const products = offersOnPage(document, pageId).flatMap((offer) => (offer.members.length > 0
    ? offer.members.map((id) => byId.get(id)).filter((m): m is Offer => Boolean(m))
    : [offer]));
  return pageDepartment(products);
}

/** A default name and tags for page N, when nobody has typed one. */
export function sectionNaming(document: CatalogDocument, index: number): { name: string; tags: string[] } {
  const page = document.pages[index]!;
  if (page.kind === 'image') {
    return { name: page.background?.subject || `Billedside ${index + 1}`, tags: ['billedside'] };
  }
  const department = departmentOfPage(document, page.id);
  const label = department ? DEPARTMENT_NAMES[department] : 'Blandet';
  return {
    name: page.title || `${label} · side ${index + 1}`,
    tags: [department ?? 'blandet', ...(index === 0 ? ['forside'] : [])],
  };
}

/** One page, packaged for the section library. */
export function sectionOf(
  document: CatalogDocument, pageId: string, name: string, tags: string[],
): api.Section | null {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page) return null;
  const onPage = offersOnPage(document, pageId);
  const members = new Set(onPage.flatMap((offer) => offer.members));
  const preview = [...onPage, ...document.offers.filter((offer) => members.has(offer.id))].slice(0, 40);
  return {
    id: `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Uden navn',
    tags: [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
    // A section travels without the avis it came from — it takes what it printed along.
    page: rememberPrinted(page, document.offers),
    template: document.templates.find((entry) => entry.id === page.templateId) ?? null,
    preview,
    createdAt: '',
  };
}

/** The week most of a feed's offers start in. */
export function feedWeek(offers: Offer[]): CatalogWeek | null {
  const counts = new Map<string, { week: CatalogWeek; n: number }>();
  for (const offer of offers) {
    const week = weekOf(new Date(`${offer.validFrom}T12:00:00Z`));
    const key = `${week.year}-${week.week}`;
    const entry = counts.get(key) ?? { week, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.week ?? null;
}

/** Pixels a product photograph is fetched at: on the overview's cards and the shelf, and in the page editor. */
export const THUMB_PX = 240;
export const EDITOR_PX = 560;
