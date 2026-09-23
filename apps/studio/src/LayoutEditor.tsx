import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CatalogPage, PageTemplate } from '@incitio/schema';
import { useStudio } from './state.js';

type Rect = { x: number; y: number; w: number; h: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/** How close, in shares of the page, an edge has to come to be caught. */
const CATCH = 0.012;
/** The alley between two cells when one is snapped beside another. */
const ALLEY = 0.014;
/** Nothing smaller: a cell has to hold a product and a price. */
const MIN = 0.08;

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
 * a page shaped by hand still lines up.
 */
export function LayoutEditor({ page, template }: { page: CatalogPage; template: PageTemplate }) {
  const s = useStudio();
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

  function start(event: ReactPointerEvent<HTMLElement>, slotId: string, edge: Edge) {
    const host = root.current;
    const rect = cells.find((slot) => slot.id === slotId)?.rect;
    if (!host || !rect) return;
    event.preventDefault();
    event.stopPropagation();
    setHeld(slotId);
    const box = host.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    const others = cells.filter((slot) => slot.id !== slotId).map((slot) => slot.rect!);
    const xs = [0.03, 0.97, ...others.flatMap((o) => [o.x, o.x + o.w, o.x - ALLEY, o.x + o.w + ALLEY])];
    const ys = [0.03, 0.97, ...others.flatMap((o) => [o.y, o.y + o.h, o.y - ALLEY, o.y + o.h + ALLEY])];
    const gesture = `cell:${page.id}:${slotId}:${Date.now()}`;
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }

    const onMove = (move: PointerEvent) => {
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
        if (edge.includes('w')) {
          const nx = catchTo(x + dx, xs) ?? x + dx;
          w = Math.max(MIN, w + (x - nx)); x = x + rect.w - w;
        }
        if (edge.includes('e')) {
          const nr = catchTo(x + w + dx, xs) ?? x + w + dx;
          w = Math.max(MIN, nr - x);
        }
        if (edge.includes('n')) {
          const ny = catchTo(y + dy, ys) ?? y + dy;
          h = Math.max(MIN, h + (y - ny)); y = y + rect.h - h;
        }
        if (edge.includes('s')) {
          const nb = catchTo(y + h + dy, ys) ?? y + h + dy;
          h = Math.max(MIN, nb - y);
        }
      }
      // A cell may hang off the sheet a little, never vanish off it.
      x = Math.min(0.95, Math.max(-0.1, x));
      y = Math.min(0.95, Math.max(-0.1, y));
      s.setCellRect(page.id, slotId, { x, y, w: Math.min(1.1, w), h: Math.min(1.1, h) }, gesture);
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
            <span className="celledit__name">{offer?.name ?? 'tomt felt'}</span>
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
