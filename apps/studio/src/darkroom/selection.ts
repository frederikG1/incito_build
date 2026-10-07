/*
 * Selections on a photograph — marquee, ellipse, magic wand — and the
 * outline a selection is saved as.
 *
 * A selection is a bitmap the size of the analysis grid (one byte a
 * pixel, 0 or 1) while somebody is making it, because adding, taking
 * away and flood-filling are bitmap work. What is SAVED is its outline,
 * traced to an SVG path — see `ImageMask` — so the document holds a few
 * hundred characters instead of a picture, and the feather stays a
 * number that can be changed later.
 *
 * Pure: no DOM, so the tests run it on hand-made pixels.
 */

export type Bitmap = Uint8Array;
export type Combine = 'replace' | 'add' | 'subtract' | 'intersect';
export interface Box { x: number; y: number; w: number; h: number }

/** The longest side photographs are analysed at — enough for a packshot's outline, small enough to fill instantly. */
export const GRID = 640;

/** The grid a photograph of this size is analysed on, in its own proportions. */
export function gridFor(naturalW: number, naturalH: number): { w: number; h: number } {
  const k = Math.min(1, GRID / Math.max(naturalW, naturalH, 1));
  return { w: Math.max(1, Math.round(naturalW * k)), h: Math.max(1, Math.round(naturalH * k)) };
}

export function rectBitmap(w: number, h: number, box: Box): Bitmap {
  const out = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(w, Math.round(box.x + box.w));
  const y1 = Math.min(h, Math.round(box.y + box.h));
  for (let y = y0; y < y1; y++) out.fill(1, y * w + x0, y * w + Math.max(x0, x1));
  return out;
}

export function ellipseBitmap(w: number, h: number, box: Box): Bitmap {
  const out = new Uint8Array(w * h);
  const rx = box.w / 2;
  const ry = box.h / 2;
  if (rx <= 0 || ry <= 0) return out;
  const cx = box.x + rx;
  const cy = box.y + ry;
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(h, Math.ceil(box.y + box.h)); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (dy * dy > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.max(0, Math.round(cx - half));
    const x1 = Math.min(w, Math.round(cx + half));
    if (x1 > x0) out.fill(1, y * w + x0, y * w + x1);
  }
  return out;
}

/**
 * The magic wand: every pixel within `tolerance` (0–255, on the worst
 * channel, alpha included) of the one clicked — joined to it when
 * `contiguous`, anywhere in the photograph when not.
 *
 * A scanline fill rather than a pixel-by-pixel one: a packshot's ground
 * is one huge region, and a queue of single pixels for 400.000 of them
 * is the difference between instant and a visible pause.
 */
export function magicWand(
  rgba: Uint8ClampedArray, w: number, h: number,
  x: number, y: number, tolerance: number, contiguous = true,
): Bitmap {
  const out = new Uint8Array(w * h);
  const sx = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const s = (sy * w + sx) * 4;
  const seed = [rgba[s]!, rgba[s + 1]!, rgba[s + 2]!, rgba[s + 3]!];
  const near = (p: number) => {
    const i = p * 4;
    return Math.abs(rgba[i]! - seed[0]!) <= tolerance
      && Math.abs(rgba[i + 1]! - seed[1]!) <= tolerance
      && Math.abs(rgba[i + 2]! - seed[2]!) <= tolerance
      && Math.abs(rgba[i + 3]! - seed[3]!) <= tolerance;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (near(p)) out[p] = 1;
    return out;
  }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    let left = px;
    const row = py * w;
    if (out[row + left] || !near(row + left)) continue;
    while (left > 0 && !out[row + left - 1] && near(row + left - 1)) left--;
    let right = px;
    while (right < w - 1 && !out[row + right + 1] && near(row + right + 1)) right++;
    for (let i = left; i <= right; i++) out[row + i] = 1;
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let i = left; i <= right; i++) {
        const open = !out[nrow + i] && near(nrow + i);
        if (open && !inRun) stack.push(i, ny);
        inRun = open;
      }
    }
  }
  return out;
}

/** A new selection merged with the one already made — shift adds, alt takes away. */
export function combine(base: Bitmap | null, next: Bitmap, mode: Combine): Bitmap {
  if (!base || mode === 'replace') return next;
  const out = new Uint8Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const a = base[i]!;
    const b = next[i]!;
    out[i] = mode === 'add' ? (a | b) : mode === 'subtract' ? (a & (b ^ 1)) : (a & b);
  }
  return out;
}

export function invertBitmap(sel: Bitmap): Bitmap {
  return sel.map((v) => v ^ 1);
}

export function selectedCount(sel: Bitmap): number {
  let n = 0;
  for (let i = 0; i < sel.length; i++) n += sel[i]!;
  return n;
}

type Point = [number, number];

/**
 * Every boundary of the selection as closed polygons on pixel corners.
 *
 * Crack following: each side of a selected pixel that faces an
 * unselected one is an edge, directed clockwise round the pixel, so the
 * selection is always on the right. Chained end to start they close into
 * outer outlines (clockwise) and holes (anticlockwise). Where two
 * selected pixels touch only at a corner, the walk turns right — the
 * tightest turn keeps the two apart instead of pinching them together.
 */
export function outlines(sel: Bitmap, w: number, h: number): Point[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? sel[y * w + x]! : 0);
  const W = w + 1;
  // Outgoing edges per corner: up to two, as direction codes 0 → 1 ↓ 2 ← 3 ↑.
  const out = new Map<number, number[]>();
  const add = (x: number, y: number, dir: number) => {
    const key = y * W + x;
    const list = out.get(key);
    if (list) list.push(dir); else out.set(key, [dir]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sel[y * w + x]) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const loops: Point[][] = [];
  for (const [start, dirs] of out) {
    while (dirs.length) {
      let x = start % W;
      let y = Math.floor(start / W);
      let dir = dirs.pop()!;
      const loop: Point[] = [[x, y]];
      for (;;) {
        x += DX[dir]!;
        y += DY[dir]!;
        const key = y * W + x;
        const here = out.get(key);
        if (!here || here.length === 0) break;
        // Right, straight, left — in that order of preference.
        const pick = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => here.includes(d));
        if (pick === undefined) break;
        here.splice(here.indexOf(pick), 1);
        if (pick !== dir) loop.push([x, y]);
        dir = pick;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Ramer–Douglas–Peucker on a closed polygon: drop the points a straight line already passes within `epsilon` of. */
export function simplify(loop: Point[], epsilon: number): Point[] {
  if (loop.length <= 4 || epsilon <= 0) return loop;
  // Split at the point farthest from the first, so both halves are open polylines.
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i]![0] - loop[0]![0]) ** 2 + (loop[i]![1] - loop[0]![1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = rdp(loop.slice(0, far + 1), epsilon);
  const b = rdp([...loop.slice(far), loop[0]!], epsilon);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  const [x0, y0] = points[0]!;
  const [x1, y1] = points[points.length - 1]!;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const d = Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / len;
    if (d > max) { max = d; index = i; }
  }
  if (max <= epsilon) return [points[0]!, points[points.length - 1]!];
  return [...rdp(points.slice(0, index + 1), epsilon).slice(0, -1), ...rdp(points.slice(index), epsilon)];
}

const MAX_PATH = 60000;

/**
 * The selection as SVG path data in grid units — what `ImageMask.path`
 * stores. Simplified until it fits the document's limit; `null` for an
 * empty selection.
 */
export function selectionPath(sel: Bitmap, w: number, h: number): string | null {
  const loops = outlines(sel, w, h);
  if (!loops.length) return null;
  for (let epsilon = 0.8; ; epsilon *= 1.6) {
    const d = loops
      .map((loop) => simplify(loop, epsilon))
      .filter((loop) => loop.length >= 3)
      .map((loop) => `M${loop.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
      .join('');
    if (d.length <= MAX_PATH || epsilon > 40) return d.length ? d.slice(0, MAX_PATH) : null;
  }
}

/** A marquee as exact path data — no tracing needed for a shape that is already a shape. */
export function rectPath(box: Box): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M${r(box.x)} ${r(box.y)}H${r(box.x + box.w)}V${r(box.y + box.h)}H${r(box.x)}Z`;
}

export function ellipsePath(box: Box): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  const rx = box.w / 2;
  const ry = box.h / 2;
  const cy = box.y + ry;
  return `M${r(box.x)} ${r(cy)}A${r(rx)} ${r(ry)} 0 1 0 ${r(box.x + box.w)} ${r(cy)}A${r(rx)} ${r(ry)} 0 1 0 ${r(box.x)} ${r(cy)}Z`;
}
