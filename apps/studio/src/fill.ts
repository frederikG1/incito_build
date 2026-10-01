/**
 * The room a page leaves empty, and two ways to use it.
 *
 * A page dealt from a section or read off a publication keeps its cells
 * where they were drawn, and when the week has fewer products — or the
 * printed page carried a banner that is gone — the bottom of the sheet
 * stands empty. Measured here in shares of the page, as the cells are:
 * the free band under the products, down to the first thing that is
 * not a product (a footer line, a banner) or the page's own margin.
 *
 * Then either the cells stretch into it, keeping their arrangement, or
 * it takes more rows of the same pattern and the cells stretch into
 * what is left over. Pure: the studio measures, this decides.
 */

export interface Box { x: number; y: number; w: number; h: number }

export interface Room {
  /** Where the products end now, and how far down they may go. */
  from: number;
  to: number;
  /** The empty band, as a share of the page's height. */
  free: number;
  /** Whole rows of the page's own last row that fit in it. */
  rows: number;
  /** Cells in one such row. */
  perRow: number;
}

const bottom = (box: Box) => box.y + box.h;
const overlapsX = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;
const area = (box: Box) => box.w * box.h;
function shared(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function bounds(cells: Box[]): Box {
  const x = Math.min(...cells.map((c) => c.x));
  const y = Math.min(...cells.map((c) => c.y));
  return { x, y, w: Math.max(...cells.map((c) => c.x + c.w)) - x, h: Math.max(...cells.map(bottom)) - y };
}

/** The cells of the bottom row: those whose top is within half a cell of the lowest top. */
function lastRow(cells: Box[]): Box[] {
  const lowest = Math.max(...cells.map((c) => c.y));
  const tall = Math.min(...cells.map((c) => c.h));
  return cells.filter((c) => c.y >= lowest - tall / 2).sort((a, b) => a.x - b.x);
}

/** The vertical gap between rows, as drawn; a small default for a single row. */
function rowGap(cells: Box[]): number {
  const tops = [...new Set(cells.map((c) => Math.round(c.y * 200) / 200))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (const cell of cells) {
    const below = cells.filter((o) => o !== cell && overlapsX(cell, o) && o.y >= bottom(cell) - 0.005);
    if (below.length) gaps.push(Math.min(...below.map((o) => o.y - bottom(cell))));
  }
  if (gaps.length === 0 || tops.length < 2) return 0.012;
  return Math.max(0, Math.min(...gaps));
}

/**
 * How much room the page leaves under its products.
 *
 * `obstacles` are everything on the page that is not a product: what
 * overlaps the products' own area (a logo stamped on a tile) is theirs
 * and does not stop them; what stands below them does. The side margin
 * the cells keep is kept at the foot too.
 */
export function measureRoom(cells: Box[], obstacles: Box[]): Room | null {
  if (cells.length === 0) return null;
  const all = bounds(cells);
  const margin = Math.max(0.015, Math.min(all.x, 1 - (all.x + all.w)));
  const gap = rowGap(cells);
  const below = obstacles
    .filter((o) => shared(o, all) < area(o) * 0.2)
    .filter((o) => overlapsX(o, all) && o.y >= bottom(all) - 0.01);
  const to = Math.min(1 - margin, ...below.map((o) => o.y - gap));
  const free = Math.max(0, to - bottom(all));
  const row = lastRow(cells);
  const height = Math.max(...row.map((c) => c.h));
  // A row fits if the cells above give up at most a seventh of their height for it.
  const rows = Math.floor((free + all.h * 0.15 + 0.001) / (height + gap));
  return { from: bottom(all), to, free, rows, perRow: row.length };
}

/** The cells stretched down to `to`, keeping their order and their gaps' proportions. */
export function stretch(cells: Box[], to: number): Box[] {
  const all = bounds(cells);
  const k = (to - all.y) / all.h;
  return cells.map((c) => ({ x: c.x, y: all.y + (c.y - all.y) * k, w: c.w, h: c.h * k }));
}

/**
 * `rows` more rows of the page's last row, under it, and then every
 * cell stretched into what the new rows leave over. The new cells come
 * back separately, in reading order, because they are the ones that
 * need products.
 */
export function addRows(cells: Box[], to: number, rows: number): { cells: Box[]; added: Box[] } {
  const row = lastRow(cells);
  const gap = rowGap(cells);
  const height = Math.max(...row.map((c) => c.h));
  const added: Box[] = [];
  for (let n = 1; n <= rows; n += 1) {
    for (const cell of row) added.push({ x: cell.x, y: cell.y + n * (height + gap), w: cell.w, h: cell.h });
  }
  const grown = stretch([...cells, ...added], to);
  return { cells: grown.slice(0, cells.length), added: grown.slice(cells.length) };
}

/**
 * The page as drawn: every cell's box, and every box that is not a
 * product, in shares of the page. Null for a page printed as published —
 * its sheet is a picture, and its empty paper is the picture's.
 */
export function readPageBoxes(pageId: string): { cells: { slotId: string; box: Box }[]; obstacles: Box[] } | null {
  const stack = document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
  const page = stack?.querySelector<HTMLElement>('.page');
  if (!page) return null;
  const P = page.getBoundingClientRect();
  if (P.width === 0 || P.height === 0) return null;
  const share = (element: Element): Box => {
    const r = element.getBoundingClientRect();
    return { x: (r.left - P.left) / P.width, y: (r.top - P.top) / P.height, w: r.width / P.width, h: r.height / P.height };
  };
  const cells = [...page.querySelectorAll<HTMLElement>('.page__grid > .slot[data-slot-id]')]
    .map((element) => ({ slotId: element.dataset.slotId!, box: share(element) }))
    .filter((cell) => cell.box.w > 0 && cell.box.h > 0);
  const obstacles = [...page.querySelectorAll('.page__decor, .page__note:not(.page__note--behind), .page__masthead')]
    .map(share)
    .filter((box) => box.w > 0 && box.h > 0);
  return cells.length > 0 ? { cells, obstacles } : null;
}
