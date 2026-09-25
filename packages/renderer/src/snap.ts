/**
 * Lining things up while they are being dragged.
 *
 * Without this the editor is a set of free-floating boxes and every
 * placement is done by eye: two products in a cluster end up a pixel
 * and a half apart, a headline sits almost on the margin, and the page
 * reads as slightly wrong in a way nobody can point at. A printed page
 * is full of exact relationships — baselines, shared centres, equal
 * margins — and none of them survives being estimated.
 *
 * So a drag looks for those relationships as it goes. When the thing in
 * hand comes within a few pixels of lining up with something else, it
 * takes the exact value instead of the approximate one, and a line is
 * drawn to say WHY it stopped there. Alt suspends it, which is the
 * escape hatch every tool of this kind has, because the one time
 * somebody wants 3px off centre they want it badly.
 *
 * Pure geometry in pixels, in whatever frame the caller measured in.
 * It knows nothing about offsets, percentages or the document — the
 * caller converts the correction back into its own units. That is what
 * makes it the same function for a product in a cluster, a box in a
 * tile and a headline on a sheet.
 */

/** A rectangle as the browser hands it over, in the overlay's own frame. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A line the editor draws to say what the thing in hand lined up with. */
export interface Guide {
  axis: 'x' | 'y';
  /** Where the line sits, on its own axis. */
  at: number;
  /** How far it runs on the other axis — the union of the two boxes. */
  from: number;
  to: number;
}

export interface Snapped {
  /** The correction, in pixels, on top of the drag the pointer asked for. */
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * How close is close enough, in pixels on screen.
 *
 * Measured on screen rather than on the sheet on purpose: this is about
 * what a hand can hold still, not about what the page means. Six is
 * about a millimetre of pointer travel and is small enough that a
 * deliberate 2mm offset is still reachable without holding alt.
 */
export const SNAP_WITHIN = 6;

const right = (rect: Rect) => rect.left + rect.width;
const bottom = (rect: Rect) => rect.top + rect.height;
const midX = (rect: Rect) => rect.left + rect.width / 2;
const midY = (rect: Rect) => rect.top + rect.height / 2;

/** Move a rectangle without touching the original. */
export function shifted(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, left: rect.left + dx, top: rect.top + dy };
}

interface Candidate {
  /** How far the moving edge has to travel to land on the target's. */
  delta: number;
  /** Where the line ends up, for the guide. */
  at: number;
  against: Rect;
}

/**
 * The best of the three alignments on one axis.
 *
 * Leading edge to leading edge, centre to centre, trailing to trailing —
 * and also leading-to-trailing, which is what makes two products sit
 * flush against each other rather than merely aligned. The smallest
 * correction wins, so a box that is near two things at once takes the
 * nearer.
 */
function nearest(
  moving: [number, number, number],
  targets: Rect[],
  edges: (rect: Rect) => [number, number, number],
  within: number,
): Candidate | null {
  let best: Candidate | null = null;
  for (const target of targets) {
    const theirs = edges(target);
    for (const mine of moving) {
      for (const line of theirs) {
        const delta = line - mine;
        if (Math.abs(delta) > within) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, at: line, against: target };
        }
      }
    }
  }
  return best;
}

/**
 * Where a drag should actually land.
 *
 * `moving` is the rectangle as the pointer would leave it; `targets`
 * are the things it may line up with. The answer is the correction to
 * add, per axis and independently — a box can take a vertical
 * alignment without a horizontal one, which is most of what happens.
 */
export function snap(
  moving: Rect,
  targets: Rect[],
  within: number = SNAP_WITHIN,
): Snapped {
  if (targets.length === 0) return { dx: 0, dy: 0, guides: [] };

  const acrossOf = (rect: Rect): [number, number, number] =>
    [rect.left, midX(rect), right(rect)];
  const downOf = (rect: Rect): [number, number, number] =>
    [rect.top, midY(rect), bottom(rect)];

  const across = nearest(acrossOf(moving), targets, acrossOf, within);
  const down = nearest(downOf(moving), targets, downOf, within);

  const guides: Guide[] = [];
  const landed = shifted(moving, across?.delta ?? 0, down?.delta ?? 0);

  /*
   * The guide spans both boxes, which is what makes it readable: a line
   * drawn only over the thing in hand says "this edge", and a line
   * drawn from it to what it met says "these two edges are the same".
   */
  if (across) {
    guides.push({
      axis: 'x',
      at: across.at,
      from: Math.min(landed.top, across.against.top),
      to: Math.max(bottom(landed), bottom(across.against)),
    });
  }
  if (down) {
    guides.push({
      axis: 'y',
      at: down.at,
      from: Math.min(landed.left, across?.against.left ?? down.against.left),
      to: Math.max(right(landed), right(down.against)),
    });
  }

  return { dx: across?.delta ?? 0, dy: down?.delta ?? 0, guides };
}

/**
 * The rectangles a dragged thing may line up with, measured now.
 *
 * Measured at the START of a drag and not again: they do not move while
 * one of their neighbours is being dragged, and re-reading the DOM on
 * every pointer move is how a drag starts to stutter.
 */
export function targetsFrom(
  root: Element,
  selector: string,
  except: Element | null,
  frame: DOMRect,
): Rect[] {
  return [...root.querySelectorAll(selector)]
    .filter((element) => element !== except && !element.contains(except as Node))
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 1 && box.height > 1)
    .map((box) => ({
      left: box.left - frame.left,
      top: box.top - frame.top,
      width: box.width,
      height: box.height,
    }));
}
