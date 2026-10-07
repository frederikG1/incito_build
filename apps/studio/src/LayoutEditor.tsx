import { pagedSheet } from '@incitio/renderer';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CatalogPage, PageTemplate } from '@incitio/schema';
import { useStudio, useStudioPick } from './state.js';

type Rect = { x: number; y: number; w: number; h: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/** How close, in shares of the page, an edge has to come to be caught. */
const CATCH = 0.012;
/** The alley between two cells when one is snapped beside another. */
const ALLEY = 0.014;
/** Nothing smaller: a cell has to hold a product and a price. */
const MIN = 0.08;
/**
 * How far apart two edges may stand and still be one edge shared by two
 * cells. Wider than an alley: a layout measured off a chain's grid keeps
 * that grid's gaps, and they run to three per cent of the page.
 */
const SHARED = 0.04;

/**
 * The cells across the edge being dragged: those whose facing edge
 * stands on it or one alley from it, and that lie beside the held cell
 * rather than past its corner. They move their facing edge with it, so
 * the line between two cells is dragged, not one cell over the other.
 */
export function sharing(rect: Rect, edge: 'n' | 's' | 'e' | 'w', others: { id: string; rect: Rect }[]): string[] {
  const beside = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > CATCH;
  return others.filter(({ rect: o }) => {
    switch (edge) {
      case 'e': return Math.abs(o.x - (rect.x + rect.w)) <= SHARED && beside(rect.y, rect.y + rect.h, o.y, o.y + o.h);
      case 'w': return Math.abs(o.x + o.w - rect.x) <= SHARED && beside(rect.y, rect.y + rect.h, o.y, o.y + o.h);
      case 's': return Math.abs(o.y - (rect.y + rect.h)) <= SHARED && beside(rect.x, rect.x + rect.w, o.x, o.x + o.w);
      case 'n': return Math.abs(o.y + o.h - rect.y) <= SHARED && beside(rect.x, rect.x + rect.w, o.x, o.x + o.w);
    }
  }).map(({ id }) => id);
}

/**
 * Where every cell of a grid layout sits on the page, in shares of the
 * page — read off the grid as the browser laid it out, so switching to
 * boxes moves nothing.
 */
export function gridRects(pageId: string, template: PageTemplate): Record<string, Rect> {
  const stack = document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
  const page = stack?.querySelector<HTMLElement>('.page');
  const grid = page?.querySelector<HTMLElement>('.page__grid');
  if (!page || !grid) return {};
  const P = page.getBoundingClientRect();
  const G = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const cols = style.gridTemplateColumns.split(/\s+/).map(parseFloat).filter((v) => !Number.isNaN(v));
  const rows = style.gridTemplateRows.split(/\s+/).map(parseFloat).filter((v) => !Number.isNaN(v));
  const gapX = parseFloat(style.columnGap) || 0;
  const gapY = parseFloat(style.rowGap) || 0;
  const left = G.left + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
  const top = G.top + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
  const colAt = (i: number) => left + cols.slice(0, i).reduce((a, b) => a + b, 0) + gapX * i;
  const rowAt = (i: number) => top + rows.slice(0, i).reduce((a, b) => a + b, 0) + gapY * i;

  const out: Record<string, Rect> = {};
  const areas = template.areas.map((row) => row.split(' '));
  for (const slot of template.slots) {
    let c0 = Infinity; let c1 = -1; let r0 = Infinity; let r1 = -1;
    areas.forEach((row, r) => row.forEach((id, c) => {
      if (id !== slot.id) return;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }));
    if (c1 < 0 || !cols[c1] || !rows[r1]) continue;
    const x0 = colAt(c0);
    const x1 = colAt(c1) + cols[c1]!;
    const y0 = rowAt(r0);
    const y1 = rowAt(r1) + rows[r1]!;
    out[slot.id] = {
      x: (x0 - P.left) / P.width,
      y: (y0 - P.top) / P.height,
      w: (x1 - x0) / P.width,
      h: (y1 - y0) / P.height,
    };
  }
  return out;
}

/** The value nearest `v` among `targets`, if one is within reach. */
function catchTo(v: number, targets: number[]): number | null {
  let best: number | null = null;
  let gap = CATCH;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d < gap) { gap = d; best = t; }
  }
  return best;
}

/**
 * The page's cells as boxes to drag and resize.
 *
 * Laid over the sheet while the page's layout is being edited, and over
 * everything on it: while you are shaping the page, a click is about
 * the cells, not the products in them. Edges catch on the page's own
 * margins, on their neighbours' edges and one alley away from them, so
 * a page shaped by hand still lines up. An edge two cells share is
 * dragged as one: the neighbour gives what the held cell takes. With
 * Alt held, the cell moves alone.
 */
export function LayoutEditor({ page, template }: { page: CatalogPage; template: PageTemplate }) {
  const s = useStudioPick('document', 'endGesture', 'ownLayout', 'removeCell', 'setCellRect', 'setCellRects');
  const root = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<string | null>(null);

  // Every cell in a box of its own before anything can be dragged.
  useEffect(() => {
    const owned = s.document?.templates.some((t) => t.id === template.id);
    if (owned && template.slots.every((slot) => slot.rect)) return;
    s.ownLayout(page.id, gridRects(page.id, template));
    // Once per page and layout — the layout it creates is complete.
  }, [page.id, template.id]);

  const offers = new Map((s.document?.offers ?? []).map((offer) => [offer.id, offer]));
  const cells = template.slots.filter((slot) => slot.rect);
  // On a page picture a cell nobody filled shows what was printed there.
  const sheet = pagedSheet(page.incito);

  function start(event: ReactPointerEvent<HTMLElement>, slotId: string, edge: Edge) {
    const host = root.current;
    const rect = cells.find((slot) => slot.id === slotId)?.rect;
    if (!host || !rect) return;
    event.preventDefault();
    event.stopPropagation();
    setHeld(slotId);
    const box = host.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    const rest = cells.filter((slot) => slot.id !== slotId).map((slot) => ({ id: slot.id, rect: slot.rect! }));
    // Per dragged side, the neighbours that share it — read once, at the start of the drag.
    const sides = edge === 'move' ? [] : (['n', 's', 'e', 'w'] as const).filter((side) => edge.includes(side));
    const linked = new Map(sides.map((side) => [side, sharing(rect, side, rest)]));
    const moving = new Set([...linked.values()].flat());
    // A neighbour that moves along is nothing to catch on.
    const targets = (free: boolean) => {
      const others = rest.filter((o) => free || !moving.has(o.id)).map((o) => o.rect);
      return {
        xs: [0.03, 0.97, ...others.flatMap((o) => [o.x, o.x + o.w, o.x - ALLEY, o.x + o.w + ALLEY])],
        ys: [0.03, 0.97, ...others.flatMap((o) => [o.y, o.y + o.h, o.y - ALLEY, o.y + o.h + ALLEY])],
      };
    };
    const tied = targets(false);
    const loose = targets(true);
    const byId = new Map(rest.map((o) => [o.id, o.rect]));
    /* How far a shared edge may go before a neighbour gets smaller than
       `MIN`: the room the narrowest of them has to give. */
    const room = (side: 'n' | 's' | 'e' | 'w') => Math.min(Infinity, ...(linked.get(side) ?? []).map((id) => {
      const o = byId.get(id)!;
      return (side === 'e' || side === 'w' ? o.w : o.h) - MIN;
    }));
    const gesture = `cell:${page.id}:${slotId}:${Date.now()}`;
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }

    const onMove = (move: PointerEvent) => {
      const alone = move.altKey;
      const { xs, ys } = alone ? loose : tied;
      const dx = (move.clientX - from.x) / box.width;
      const dy = (move.clientY - from.y) / box.height;
      let { x, y, w, h } = rect;
      if (edge === 'move') {
        x += dx; y += dy;
        const left = catchTo(x, xs);
        const right = catchTo(x + w, xs);
        if (left !== null) x = left; else if (right !== null) x = right - w;
        const topCatch = catchTo(y, ys);
        const bottom = catchTo(y + h, ys);
        if (topCatch !== null) y = topCatch; else if (bottom !== null) y = bottom - h;
      } else {
        // A neighbour sharing the edge may only give so much.
        const limit = (side: 'n' | 's' | 'e' | 'w', v: number, sign: 1 | -1) =>
          alone ? v : sign > 0 ? Math.min(v, room(side)) : Math.max(v, -room(side));
        if (edge.includes('w')) {
          const nx = catchTo(x + dx, xs) ?? x + dx;
          w = Math.max(MIN, w + (x - limit('w', nx - x, -1) - x)); x = x + rect.w - w;
        }
        if (edge.includes('e')) {
          const nr = catchTo(x + w + dx, xs) ?? x + w + dx;
          w = Math.max(MIN, limit('e', nr - (x + w), 1) + x + w - x);
        }
        if (edge.includes('n')) {
          const ny = catchTo(y + dy, ys) ?? y + dy;
          h = Math.max(MIN, h + (y - limit('n', ny - y, -1) - y)); y = y + rect.h - h;
        }
        if (edge.includes('s')) {
          const nb = catchTo(y + h + dy, ys) ?? y + h + dy;
          h = Math.max(MIN, limit('s', nb - (y + h), 1) + y + h - y);
        }
      }
      // A cell may hang off the sheet a little, never vanish off it.
      x = Math.min(0.95, Math.max(-0.1, x));
      y = Math.min(0.95, Math.max(-0.1, y));
      const next = { x, y, w: Math.min(1.1, w), h: Math.min(1.1, h) };
      const rects: Record<string, Rect> = { [slotId]: next };
      if (!alone) {
        // Each neighbour's facing edge goes where the held cell's edge went, the alley between them kept.
        for (const [side, ids] of linked) {
          for (const id of ids) {
            const o = rects[id] ?? byId.get(id)!;
            const b = byId.get(id)!;
            if (side === 'e') { const shift = next.x + next.w - (rect.x + rect.w); rects[id] = { ...o, x: b.x + shift, w: b.w - shift }; }
            if (side === 'w') { const shift = next.x - rect.x; rects[id] = { ...o, w: b.w + shift }; }
            if (side === 's') { const shift = next.y + next.h - (rect.y + rect.h); rects[id] = { ...o, y: b.y + shift, h: b.h - shift }; }
            if (side === 'n') { const shift = next.y - rect.y; rects[id] = { ...o, h: b.h + shift }; }
          }
        }
      }
      // Released Alt mid-drag: the neighbours go back to where they stood.
      else for (const id of moving) rects[id] = byId.get(id)!;
      s.setCellRects(page.id, rects, gesture);
    };
    const onUp = () => {
      try { target.releasePointerCapture(event.pointerId); } catch { /* never held */ }
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      s.endGesture();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  return (
    <div
      ref={root}
      className="celledit"
      onPointerDown={(event) => { if (event.target === event.currentTarget) setHeld(null); }}
    >
      {cells.map((slot) => {
        const r = slot.rect!;
        const placement = page.placements.find((entry) => entry.slotId === slot.id);
        const offer = placement ? offers.get(placement.offerId) : undefined;
        return (
          <div
            key={slot.id}
            className={`celledit__cell${held === slot.id ? ' is-held' : ''}${offer ? '' : ' is-empty'}`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            onPointerDown={(event) => start(event, slot.id, 'move')}
          >
            <span className="celledit__name">{offer?.name ?? (sheet && !sheet.printed?.[slot.id] ? 'som trykt' : 'tomt felt')}</span>
            {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((edge) => (
              <i
                key={edge}
                className={`celledit__grip celledit__grip--${edge}`}
                onPointerDown={(event) => start(event, slot.id, edge)}
              />
            ))}
            {held === slot.id && (
              <button
                className="celledit__drop"
                title={offer ? 'Fjern feltet — varen går i reserve' : 'Fjern feltet'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => { s.removeCell(page.id, slot.id); setHeld(null); }}
              >
                Fjern felt
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
