/**
 * How much of a page is bare ground, measured rather than judged.
 *
 * The number this module computes already exists in this repo — in a
 * comment. Above `.slot` in `styles.css` someone records having measured
 * a 21-page book by hand: "image boxes covered 56.3% of the page and
 * actual artwork 24.8%, so 31.4% of every sheet was empty ground inside
 * a box reserved for a product. One page spent 63% of its area showing
 * 5.6% of product." That measurement is why the artwork was let out of
 * its cell. It was taken once, never again, and the pages drifted back.
 *
 * So: the same arithmetic, as a function, run by `npm run check` on
 * every catalogue. A rendered page is the only place the question can
 * be answered — a packshot's own margins are invisible to CSS and to
 * TypeScript — but the geometry itself is ordinary arithmetic on
 * rectangles and belongs where it can be tested without a browser.
 *
 * That split is the whole design of this file. The script collects raw
 * rectangles inside `page.evaluate`, where nothing can be imported and
 * nothing can be unit-tested, and hands them here. Everything with a
 * decision in it lives on this side.
 *
 * Coordinates are whatever the caller measured in — the browser hands
 * over CSS pixels — and only ever compared with each other, so the unit
 * never matters.
 */

/** A box, in the shape `getBoundingClientRect` already returns. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const rectArea = (r: Rect): number =>
  Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/** A box cut down to the one it sits in. Empty if they do not meet. */
export function clipRect(rect: Rect, bounds: Rect): Rect {
  return {
    left: Math.max(rect.left, bounds.left),
    top: Math.max(rect.top, bounds.top),
    right: Math.min(rect.right, bounds.right),
    bottom: Math.min(rect.bottom, bounds.bottom),
  };
}

/**
 * The area these boxes cover between them, counting an overlap once.
 *
 * Adding the areas up would be wrong by a lot and always in the
 * flattering direction: a price mark sits ON its product by design —
 * see `.price` — so a tile whose artwork and price overlap heavily
 * would report as fuller than a tile where they do not.
 *
 * Swept by x-coordinate: every distinct vertical edge cuts the plane
 * into strips, and within one strip the set of boxes that span it does
 * not change, so their y-intervals can simply be merged. Exact, and at
 * the dozen boxes a tile has the cost does not matter.
 */
export function unionArea(rects: Rect[]): number {
  const boxes = rects.filter((r) => rectArea(r) > 0);
  if (boxes.length === 0) return 0;

  const edges = [...new Set(boxes.flatMap((r) => [r.left, r.right]))].sort((a, b) => a - b);

  let total = 0;
  for (let i = 0; i < edges.length - 1; i += 1) {
    const x0 = edges[i]!;
    const width = edges[i + 1]! - x0;
    if (width <= 0) continue;

    const spans = boxes
      .filter((r) => r.left <= x0 && r.right >= edges[i + 1]!)
      .map((r) => [r.top, r.bottom] as const)
      .sort((a, b) => a[0] - b[0]);

    let covered = 0;
    let reached = -Infinity;
    for (const [top, bottom] of spans) {
      if (bottom <= reached) continue;
      covered += bottom - Math.max(top, reached);
      reached = bottom;
    }
    total += width * covered;
  }
  return total;
}

/** The share of `bounds` that the boxes cover, 0..1. */
export function coverage(bounds: Rect, rects: Rect[]): number {
  const area = rectArea(bounds);
  if (area <= 0) return 1;
  return Math.min(1, unionArea(rects.map((r) => clipRect(r, bounds))) / area);
}

/**
 * The largest rectangle inside `bounds` that touches nothing.
 *
 * This is the figure a person draws on a proof when they say there is
 * too much air — one big empty region, not a percentage. It is also the
 * honest measure of the complaint: a page can be 70% covered and still
 * look broken if the missing 30% is one block, and 60% covered and look
 * fine if it is spread as the margins around twelve products.
 *
 * Exact rather than sampled. A maximal empty rectangle's left and right
 * edges each rest against an obstacle or against the boundary, so
 * trying every pair of vertical edges and taking the tallest free gap
 * in that strip cannot miss one. O(n³) at worst, on the forty-odd boxes
 * a page has, with the area of the strip pruning most pairs before the
 * sweep.
 *
 * Returns `null` only when nothing fits, which means the page is
 * completely covered.
 */
export function largestEmptyRect(bounds: Rect, obstacles: Rect[]): Rect | null {
  const blocked = obstacles
    .map((o) => clipRect(o, bounds))
    .filter((o) => rectArea(o) > 0);

  const edges = [...new Set([
    bounds.left,
    bounds.right,
    ...blocked.flatMap((o) => [o.left, o.right]),
  ])]
    .filter((x) => x >= bounds.left && x <= bounds.right)
    .sort((a, b) => a - b);

  const height = bounds.bottom - bounds.top;
  let best: Rect | null = null;
  let bestArea = 0;

  for (let i = 0; i < edges.length - 1; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const left = edges[i]!;
      const right = edges[j]!;
      const width = right - left;
      // The tallest this strip could possibly be. Most pairs die here.
      if (width <= 0 || width * height <= bestArea) continue;

      const spans = blocked
        .filter((o) => o.left < right && o.right > left)
        .map((o) => [o.top, o.bottom] as const)
        .sort((a, b) => a[0] - b[0]);

      let open = bounds.top;
      const consider = (top: number, bottom: number) => {
        const area = width * (bottom - top);
        if (area > bestArea) {
          bestArea = area;
          best = { left, right, top, bottom };
        }
      };
      for (const [top, bottom] of spans) {
        if (top > open) consider(open, top);
        open = Math.max(open, bottom);
      }
      if (bounds.bottom > open) consider(open, bounds.bottom);
    }
  }

  return best;
}

/**
 * The boxes as a coarse grid of "has ink here".
 *
 * Needed because the two things being compared cannot be measured the
 * same way otherwise. A rendered page is a set of rectangles and can be
 * measured exactly; a chain's printed page is a JPEG and can only be
 * measured by looking at pixels. Comparing an exact number against a
 * sampled one and calling the difference a regression would be a
 * mistake, so both sides are reduced to the same grid first and the
 * same algorithm is run over it.
 *
 * A cell counts as ink when its CENTRE is inside a box. That is the
 * same rule the pixel side uses, and it is why the two agree.
 */
export function inkGrid(bounds: Rect, rects: Rect[], columns: number, rows: number): boolean[][] {
  const width = (bounds.right - bounds.left) / columns;
  const height = (bounds.bottom - bounds.top) / rows;
  const grid: boolean[][] = [];
  for (let y = 0; y < rows; y += 1) {
    const cy = bounds.top + (y + 0.5) * height;
    const row: boolean[] = [];
    for (let x = 0; x < columns; x += 1) {
      const cx = bounds.left + (x + 0.5) * width;
      row.push(rects.some((r) => cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom));
    }
    grid.push(row);
  }
  return grid;
}

/** Where the largest empty block sits, in grid cells. */
export interface CellRect { x: number; y: number; width: number; height: number }

/**
 * The largest all-empty block of a grid.
 *
 * The bitmap twin of `largestEmptyRect`, for the side of the comparison
 * that is a photograph rather than a layout. The standard histogram
 * sweep: walk down the rows keeping, for each column, how many empty
 * cells run upward from here, and take the largest rectangle under that
 * histogram at every row. Linear in the grid.
 */
export function largestEmptyCells(grid: boolean[][]): CellRect | null {
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;
  if (rows === 0 || columns === 0) return null;

  const run = new Array<number>(columns).fill(0);
  let best: CellRect | null = null;
  let bestArea = 0;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) run[x] = grid[y]![x] ? 0 : run[x]! + 1;

    // Monotone stack over the histogram, with a sentinel 0 at the end so
    // every bar is closed without a second pass.
    const stack: number[] = [];
    for (let x = 0; x <= columns; x += 1) {
      const height = x === columns ? 0 : run[x]!;
      while (stack.length > 0 && run[stack[stack.length - 1]!]! >= height) {
        const top = stack.pop()!;
        const tall = run[top]!;
        const left = stack.length === 0 ? 0 : stack[stack.length - 1]! + 1;
        const area = tall * (x - left);
        if (tall > 0 && area > bestArea) {
          bestArea = area;
          best = { x: left, y: y - tall + 1, width: x - left, height: tall };
        }
      }
      stack.push(x);
    }
  }
  return best;
}
