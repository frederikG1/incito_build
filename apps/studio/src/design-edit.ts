import type { DesignLayer, OfferDesign } from '@incitio/schema';

/**
 * The geometry of the design editor, apart from the pointer.
 *
 * Everything is in shares of the cell (0..1), as the CMS stores it; the
 * editor converts the snapping distance from screen pixels before it
 * asks. Pure, so snapping, aligning and the history can be tested
 * without a browser — and so they behave the same under the mouse, the
 * arrow keys and the buttons.
 */

export interface Rect { x1: number; y1: number; x2: number; y2: number }
/** A line drawn while something snaps to it: where, and how far along it. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const r4 = (value: number) => Math.round(value * 10000) / 10000;
export const rectOf = (layer: Pick<DesignLayer, 'x1' | 'y1' | 'x2' | 'y2'>): Rect => ({ x1: layer.x1, y1: layer.y1, x2: layer.x2, y2: layer.y2 });

export function bounds(rects: Rect[]): Rect {
  return {
    x1: Math.min(...rects.map((r) => r.x1)), y1: Math.min(...rects.map((r) => r.y1)),
    x2: Math.max(...rects.map((r) => r.x2)), y2: Math.max(...rects.map((r) => r.y2)),
  };
}

/** The lines a field can snap to on one axis: the cell's edges and middle, every other field's edges and middle, the grid. */
function targets(others: Rect[], axis: 'x' | 'y', grid: number | null): number[] {
  const out = [0, 0.5, 1];
  for (const r of others) {
    const [a, b] = axis === 'x' ? [r.x1, r.x2] : [r.y1, r.y2];
    out.push(a, b, (a + b) / 2);
  }
  if (grid) for (let at = grid; at < 1; at += grid) out.push(at);
  return out;
}

/** The nearest target to any of `edges` within `threshold`: how far to move, and to where. */
function nearest(edges: number[], lines: number[], threshold: number): { by: number; at: number } | null {
  let best: { by: number; at: number } | null = null;
  for (const edge of edges) {
    for (const line of lines) {
      const by = line - edge;
      if (Math.abs(by) <= threshold && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, at: line };
    }
  }
  return best;
}

/** Guides for every line the rect now touches, spanning the rect and whatever it lines up with. */
function guidesFor(rect: Rect, others: Rect[], hits: { axis: 'x' | 'y'; at: number }[]): Guide[] {
  const eps = 1e-4;
  return hits.map(({ axis, at }) => {
    const lined = [rect, ...others.filter((o) => (axis === 'x'
      ? [o.x1, o.x2, (o.x1 + o.x2) / 2] : [o.y1, o.y2, (o.y1 + o.y2) / 2]).some((v) => Math.abs(v - at) < eps))];
    const span = axis === 'x'
      ? { from: Math.min(...lined.map((o) => o.y1)), to: Math.max(...lined.map((o) => o.y2)) }
      : { from: Math.min(...lined.map((o) => o.x1)), to: Math.max(...lined.map((o) => o.x2)) };
    // A line on the cell's own edge or middle runs the whole cell.
    const cellLine = [0, 0.5, 1].some((v) => Math.abs(v - at) < eps) && lined.length === 1;
    return { axis, at, ...(cellLine ? { from: 0, to: 1 } : span) };
  });
}

export interface SnapOptions { threshold: { x: number; y: number }; grid: number | null; off?: boolean }

/** Move a rect by (dx, dy), then let its edges or middle catch the nearest line. */
export function snapMove(start: Rect, dx: number, dy: number, others: Rect[], o: SnapOptions): { dx: number; dy: number; guides: Guide[] } {
  if (o.off) return { dx, dy, guides: [] };
  const moved = { x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy };
  const sx = nearest([moved.x1, (moved.x1 + moved.x2) / 2, moved.x2], targets(others, 'x', o.grid), o.threshold.x);
  const sy = nearest([moved.y1, (moved.y1 + moved.y2) / 2, moved.y2], targets(others, 'y', o.grid), o.threshold.y);
  const fdx = dx + (sx?.by ?? 0);
  const fdy = dy + (sy?.by ?? 0);
  const final = { x1: start.x1 + fdx, y1: start.y1 + fdy, x2: start.x2 + fdx, y2: start.y2 + fdy };
  const hits = [
    ...(sx ? [{ axis: 'x' as const, at: sx.at }] : []),
    ...(sy ? [{ axis: 'y' as const, at: sy.at }] : []),
  ];
  return { dx: fdx, dy: fdy, guides: guidesFor(final, others, hits) };
}

/**
 * Drag one handle of a rect. Only the edges the handle holds move, and
 * only they snap. `keepRatio` (shift on a corner) holds the proportions,
 * as in every drawing program.
 */
export function snapResize(
  start: Rect, handle: Handle, dx: number, dy: number, others: Rect[],
  o: SnapOptions & { keepRatio?: boolean; min: { x: number; y: number } },
): { rect: Rect; guides: Guide[] } {
  const r = { ...start };
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (west) r.x1 += dx;
  if (east) r.x2 += dx;
  if (north) r.y1 += dy;
  if (south) r.y2 += dy;

  const hits: { axis: 'x' | 'y'; at: number }[] = [];
  if (!o.off) {
    const lx = targets(others, 'x', o.grid);
    const ly = targets(others, 'y', o.grid);
    if (west || east) {
      const s = nearest([west ? r.x1 : r.x2], lx, o.threshold.x);
      if (s) { if (west) r.x1 += s.by; else r.x2 += s.by; hits.push({ axis: 'x', at: s.at }); }
    }
    if (north || south) {
      const s = nearest([north ? r.y1 : r.y2], ly, o.threshold.y);
      if (s) { if (north) r.y1 += s.by; else r.y2 += s.by; hits.push({ axis: 'y', at: s.at }); }
    }
  }

  if (o.keepRatio && (west || east) && (north || south)) {
    const ratio = (start.x2 - start.x1) / Math.max(1e-6, start.y2 - start.y1);
    const w = r.x2 - r.x1;
    const h = r.y2 - r.y1;
    // The side that moved further leads; the other follows.
    if (Math.abs(w / ratio - (start.y2 - start.y1)) >= Math.abs(h - (start.y2 - start.y1))) {
      const nh = w / ratio;
      if (north) r.y1 = r.y2 - nh; else r.y2 = r.y1 + nh;
    } else {
      const nw = h * ratio;
      if (west) r.x1 = r.x2 - nw; else r.x2 = r.x1 + nw;
    }
  }

  // Never inside out, never smaller than a pixel or two.
  if (r.x2 - r.x1 < o.min.x) { if (west) r.x1 = r.x2 - o.min.x; else r.x2 = r.x1 + o.min.x; }
  if (r.y2 - r.y1 < o.min.y) { if (north) r.y1 = r.y2 - o.min.y; else r.y2 = r.y1 + o.min.y; }
  return { rect: r, guides: guidesFor(r, others, hits) };
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Line fields up. One field lines up with the cell; several with the
 * box around them, as Photoshop does with a selection.
 */
export function align(rects: Rect[], how: Align): Rect[] {
  const to = rects.length === 1 ? { x1: 0, y1: 0, x2: 1, y2: 1 } : bounds(rects);
  return rects.map((r) => {
    const w = r.x2 - r.x1;
    const h = r.y2 - r.y1;
    switch (how) {
      case 'left': return { ...r, x1: to.x1, x2: to.x1 + w };
      case 'right': return { ...r, x1: to.x2 - w, x2: to.x2 };
      case 'hcenter': { const x1 = (to.x1 + to.x2) / 2 - w / 2; return { ...r, x1, x2: x1 + w }; }
      case 'top': return { ...r, y1: to.y1, y2: to.y1 + h };
      case 'bottom': return { ...r, y1: to.y2 - h, y2: to.y2 };
      case 'vcenter': { const y1 = (to.y1 + to.y2) / 2 - h / 2; return { ...r, y1, y2: y1 + h }; }
    }
  });
}

/** Equal gaps between three or more fields, keeping the outermost where they are. */
export function distribute(rects: Rect[], axis: 'x' | 'y'): Rect[] {
  if (rects.length < 3) return rects;
  const [a1, a2] = axis === 'x' ? ['x1', 'x2'] as const : ['y1', 'y2'] as const;
  const order = rects.map((r, i) => ({ r, i })).sort((p, q) => p.r[a1] - q.r[a1]);
  const total = order.reduce((sum, { r }) => sum + (r[a2] - r[a1]), 0);
  const span = order[order.length - 1]!.r[a2] - order[0]!.r[a1];
  const gap = (span - total) / (order.length - 1);
  const out = [...rects];
  let at = order[0]!.r[a1];
  for (const { r, i } of order) {
    const size = r[a2] - r[a1];
    out[i] = { ...r, [a1]: at, [a2]: at + size };
    at += size + gap;
  }
  return out;
}

/** Write rects back onto their layers, rounded as the CMS keeps them. */
export function placeLayers(design: OfferDesign, rects: Map<string, Rect>): OfferDesign {
  return {
    ...design,
    layers: design.layers.map((layer) => {
      const r = rects.get(String(layer.id));
      return r ? { ...layer, x1: r4(r.x1), y1: r4(r.y1), x2: r4(r.x2), y2: r4(r.y2) } : layer;
    }),
  };
}

/** Move fields by (dx, dy) shares. */
export function moveLayers(design: OfferDesign, ids: string[], dx: number, dy: number): OfferDesign {
  const wanted = new Set(ids);
  return placeLayers(design, new Map(design.layers.filter((l) => wanted.has(String(l.id)))
    .map((l) => [String(l.id), { x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy }])));
}

/**
 * Up or down the stack. The CMS lists the top field first, so "forward"
 * is towards the start of the list. `edge` goes all the way.
 */
export function restack(design: OfferDesign, ids: string[], direction: 'forward' | 'backward', edge = false): OfferDesign {
  const wanted = new Set(ids);
  const layers = [...design.layers];
  const moving = layers.filter((l) => wanted.has(String(l.id)));
  if (moving.length === 0) return design;
  if (edge) {
    const rest = layers.filter((l) => !wanted.has(String(l.id)));
    return { ...design, layers: direction === 'forward' ? [...moving, ...rest] : [...rest, ...moving] };
  }
  const step = direction === 'forward' ? -1 : 1;
  const indices = layers.map((l, i) => (wanted.has(String(l.id)) ? i : -1)).filter((i) => i >= 0);
  for (const i of step < 0 ? indices : [...indices].reverse()) {
    const j = i + step;
    if (j < 0 || j >= layers.length || wanted.has(String(layers[j]!.id))) continue;
    [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  }
  return { ...design, layers };
}

/** Copies of fields, with ids the design does not have, shifted a little so they are seen. */
export function cloneLayers(design: OfferDesign, layers: DesignLayer[], shift: { x: number; y: number }): { design: OfferDesign; ids: string[] } {
  let next = design.layers.reduce((most, l) => Math.max(most, typeof l.id === 'number' ? l.id : Number(l.id) || 0), 0) + 1;
  const ids = new Map<string, number>();
  for (const layer of layers) ids.set(String(layer.id), next++);
  const copies = layers.map((layer) => {
    const id = ids.get(String(layer.id))!;
    const parent = layer.parent_id != null && ids.has(String(layer.parent_id)) ? ids.get(String(layer.parent_id))! : layer.parent_id ?? null;
    return {
      ...structuredClone(layer),
      id,
      parent_id: parent,
      x1: r4(layer.x1 + shift.x), x2: r4(layer.x2 + shift.x), y1: r4(layer.y1 + shift.y), y2: r4(layer.y2 + shift.y),
      paragraphs: layer.paragraphs.map((p, n) => ({ ...p, id: `${id}-${n + 1}` })),
    };
  });
  return { design: { ...design, layers: [...copies, ...design.layers] }, ids: copies.map((c) => String(c.id)) };
}

/** Which fields a marquee catches: any it touches. */
export function caught(design: OfferDesign, box: Rect): string[] {
  return design.layers
    .filter((l) => l.x1 < box.x2 && l.x2 > box.x1 && l.y1 < box.y2 && l.y2 > box.y1)
    .map((l) => String(l.id));
}

/* --------------------------------------------------------- history */

/**
 * Undo and redo for one design.
 *
 * A step is a finished gesture — a whole drag, an align, a delete — not
 * every pointer move. Typing in a field coalesces: edits with the same
 * `key` inside `window` ms are one step, so ⌘Z takes back the word, not
 * the letter.
 */
export interface History { past: OfferDesign[]; future: OfferDesign[]; key: string | null; at: number }
export const emptyHistory = (): History => ({ past: [], future: [], key: null, at: 0 });
const LIMIT = 200;

export function record(history: History, before: OfferDesign, key: string | null = null, now = Date.now(), window = 900): History {
  if (key && history.key === key && now - history.at < window) return { ...history, at: now, future: [] };
  return { past: [...history.past, before].slice(-LIMIT), future: [], key, at: now };
}

export function undo(history: History, current: OfferDesign): { history: History; design: OfferDesign } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future], key: null, at: 0 }, design: previous };
}

export function redo(history: History, current: OfferDesign): { history: History; design: OfferDesign } | null {
  const next = history.future[0];
  if (!next) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1), key: null, at: 0 }, design: next };
}
