import type { PageItem, ReferencePage, Rect } from './extract.js';

/**
 * The grid under a published page, derived from its own boxes.
 *
 * This is the half of "read the reference" that never needed a model.
 * `match` asks one to look at a picture and report "the smallest column
 * count every offer edge lines up with"; the edges are numbers in the
 * file, and lining numbers up with a lattice is arithmetic. What is
 * left for a model afterwards is the half it is actually good at: what
 * the blocks MEAN — which one is the lead offer, which is a masthead,
 * which is a footer nobody prints again.
 *
 * Two steps, and they are kept apart on purpose:
 *
 *   `blocks`  cuts the page into the regions its own white space
 *             separates. Geometry only, no names.
 *   `lattice` finds the coarsest column and row count those regions
 *             agree on, and writes it as `grid-template-areas`.
 *
 * The first is a fact about ink. The second is a choice among the
 * lattices that fit, and it has a tolerance — which is why it reports
 * how well it fits rather than only what it chose.
 */

export interface GridOptions {
  /**
   * The narrowest run of white that counts as a COLUMN boundary, as a
   * share of the sheet.
   *
   * Below this, the word space inside a headline is a column and a page
   * comes back with forty of them. On a 539pt sheet 1.2% is 6.5pt —
   * wider than any word space, narrower than the alley between two
   * offers.
   */
  minGutterX: number;
  /**
   * The same for a ROW, and it has to be smaller.
   *
   * A leaflet sets a product name a millimetre above its own fine print
   * and puts two millimetres between one offer and the next, so a
   * single threshold either welds the rows together or tears every
   * paragraph into lines. The floor here is the small one; what keeps
   * paragraphs whole is `leading` below.
   */
  minGutterY: number;
  /**
   * A gap this many times the region's own type height is a row
   * boundary.
   *
   * Which means the reader measures in the page's own units instead of
   * in a number somebody tuned: 10pt fine print leads at about 12pt, so
   * 1.8 clears the leading and still catches a 2mm gap between offers.
   * A page set in 24pt gets a proportionally larger answer, which is
   * what makes this work on a poster and on a six-up grid alike.
   */
  leading: number;
  /** How far a block edge may sit off a lattice line, as a share. */
  tolerance: number;
  /** The most columns or rows to consider. Grocery pages sit on 2-6. */
  maxTracks: number;
  /**
   * Artwork bigger than this share of the sheet is GROUND, not a block.
   *
   * A full-bleed photograph behind the whole page is the one thing that
   * defeats a white-space cut: it covers every gutter on the sheet, so
   * nothing separates from anything and the page comes back as one
   * block. It is also not an offer. Excluded from the cut and kept in
   * the page, where the ground and density measurements want it.
   */
  groundArea: number;
  /** Blocks smaller than this share of the sheet are specks, not offers. */
  minBlockArea: number;
  /**
   * The widest alley `weld` will bridge, as a share of the sheet.
   *
   * A price standing above its own name is separated by the product
   * between them — a few centimetres at most. Wider than this and the
   * two are simply different offers with a photograph between them,
   * which is most of a leaflet.
   *
   * Wider across than down, because what sits in the two alleys is not
   * the same thing: under a price is the top of a packshot, beside it
   * is the whole packshot. Safe to be generous sideways only because a
   * sideways weld also demands that one of the two blocks be a bare
   * number — see `weld`.
   */
  weldGap: number;
  weldGapX: number;
  /** The most artwork a region may claim, as a multiple of its own area. */
  claimArea: number;
  /** The share of block edges that must land on a lattice for it to count. */
  agreement: number;
  /** Wider than this share of the sheet is a band, never an offer. */
  bandWidth: number;
  /** The widest gutter to try when fitting a lattice, as a share. */
  maxGutter: number;
}

export const GRID_DEFAULTS: GridOptions = {
  minGutterX: 0.012,
  minGutterY: 0.005,
  leading: 1.8,
  tolerance: 0.035,
  maxTracks: 6,
  groundArea: 0.35,
  minBlockArea: 0.004,
  weldGap: 0.12,
  weldGapX: 0.16,
  claimArea: 2.5,
  agreement: 0.8,
  bandWidth: 0.95,
  maxGutter: 0.12,
};

/** One region the page's own white space separates from the others. */
export interface Block {
  rect: Rect;
  /** What is inside it, which is what a caller names it from. */
  images: number;
  paths: number;
  texts: number;
  /** The largest type in the block, in points — a headline reads bigger. */
  maxTextSize: number;
  /** Its words, in reading order, so a caller can match an offer to it. */
  text: string;
}

export interface GridReading {
  columns: number;
  rows: number;
  /** Exactly what `grid-template-areas` takes — one string per row. */
  areas: string[];
  slots: { id: string; rect: Rect; block: Block }[];
  /** The alley between two tracks, as a share of the sheet. */
  gutter: { x: number; y: number };
  /**
   * The worst distance from a block edge to the lattice line it was
   * snapped to, as a share of the sheet.
   *
   * The honest half of the answer. A page whose offers sit on a clean
   * four-column grid comes back at a few thousandths; one that came
   * back at the tolerance was FITTED, not read, and a caller deciding
   * whether to keep the template gets to see which it was.
   */
  fit: number;
}

const area = (r: Rect) => r.w * r.h;

/** Is this box the sheet's own field rather than something on it? */
function isGround(item: PageItem, options: GridOptions): boolean {
  return area(item.rect) >= options.groundArea;
}

/**
 * Where the ink is along one axis, in bins.
 *
 * Mass rather than presence: a bin holding a hairline rule and a bin
 * holding a packshot are not the same evidence, and a binary profile
 * lets one stray 0.3pt frame close a gutter that is plainly open.
 */
function profile(rects: Rect[], axis: 'x' | 'y', from: number, to: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  const span = to - from;
  if (span <= 0) return out;

  for (const r of rects) {
    const start = axis === 'x' ? r.x : r.y;
    const size = axis === 'x' ? r.w : r.h;
    const weight = axis === 'x' ? r.h : r.w;
    const a = Math.max(0, Math.floor(((start - from) / span) * bins));
    const b = Math.min(bins - 1, Math.ceil(((start + size - from) / span) * bins) - 1);
    for (let i = a; i <= b; i += 1) out[i] = (out[i] ?? 0) + weight;
  }
  return out;
}

/**
 * The bands of ink along one axis, separated by runs of white.
 *
 * Returns the ink, not the gutters: a band is where something is, and
 * the caller recurses into it.
 */
function bands(
  rects: Rect[], axis: 'x' | 'y', from: number, to: number, gutter: number,
): [number, number][] {
  const bins = 400;
  const mass = profile(rects, axis, from, to, bins);
  const span = to - from;
  const gutterBins = Math.max(1, Math.round((gutter / span) * bins));
  // A bin is white when what crosses it is thinner than a rule: 0.4% of
  // the sheet is a third of a millimetre at A4.
  const empty = mass.map((m) => m < 0.004);

  const out: [number, number][] = [];
  let start: number | null = null;
  let run = 0;

  for (let i = 0; i < bins; i += 1) {
    if (empty[i]) {
      run += 1;
      if (start !== null && run >= gutterBins) {
        out.push([from + (start / bins) * span, from + ((i - run + 1) / bins) * span]);
        start = null;
      }
    } else {
      run = 0;
      if (start === null) start = i;
    }
  }
  if (start !== null) out.push([from + (start / bins) * span, to]);
  return out;
}

/**
 * Cut a region until its white space stops separating anything.
 *
 * The XY cut, which is the oldest trick in document layout and the
 * right one here: a leaflet is built by dividing a sheet, so reading it
 * back is dividing it the same way. Alternating axes, because a row of
 * offers and a column of offers are the same structure turned ninety
 * degrees, and a cut that only ever looks one way finds one of them.
 */
function cut(
  items: PageItem[], bounds: Rect, axis: 'x' | 'y', depth: number, options: GridOptions,
): Rect[] {
  if (depth <= 0 || items.length <= 1) return [bounds];

  const rects = items.map((i) => i.rect);
  const from = axis === 'x' ? bounds.x : bounds.y;
  const to = axis === 'x' ? bounds.x + bounds.w : bounds.y + bounds.h;
  const gutter = axis === 'x'
    ? options.minGutterX
    : Math.max(options.minGutterY, median(items.map((i) => i.rect.h)) * options.leading);
  const found = bands(rects, axis, from, to, gutter);
  const next = axis === 'x' ? 'y' : 'x';

  // Nothing separated on this axis: try the other one, and stop when
  // neither of them does.
  if (found.length <= 1) {
    return depth > 0 && found.length === 1
      ? cut(items, bounds, next, depth - 1, options)
      : [bounds];
  }

  return found.flatMap(([a, b]) => {
    const region: Rect = axis === 'x'
      ? { x: a, y: bounds.y, w: b - a, h: bounds.h }
      : { x: bounds.x, y: a, w: bounds.w, h: b - a };
    const inside = items.filter((i) => overlaps(i.rect, region));
    return cut(inside, tighten(inside.map((i) => i.rect), region), next, depth - 1, options);
  });
}

/**
 * Is this block's whole text a price?
 *
 * "10,-", "49,-", "15 95" — a number, its øre, and the chains' own
 * kroner mark, and nothing else. A block of words is not a price no
 * matter how large it is set.
 */
function isPrice(text: string): boolean {
  const bare = text.replace(/[\s.,\-–—]/g, '');
  return bare.length > 0 && bare.length <= 6 && /^\d+$/.test(bare);
}

/** The middle value, which a stray headline cannot drag about. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function overlaps(r: Rect, region: Rect): boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx >= region.x && cx <= region.x + region.w
    && cy >= region.y && cy <= region.y + region.h;
}

/** Shrink a region onto what is actually in it. */
function tighten(rects: Rect[], fallback: Rect): Rect {
  if (rects.length === 0) return fallback;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * How much of the narrower span two boxes share on one axis.
 */
function share(a: Rect, b: Rect, axis: 'x' | 'y'): number {
  const [a0, a1] = axis === 'x' ? [a.x, a.x + a.w] : [a.y, a.y + a.h];
  const [b0, b1] = axis === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h];
  const over = Math.min(a1, b1) - Math.max(a0, b0);
  return over <= 0 ? 0 : over / Math.min(a1 - a0, b1 - b0);
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Put back together what only the words were divided into.
 *
 * The cut is made on type, and an offer's type comes in two lumps: the
 * number, and everything else. Between them sits the product — a
 * packshot, a flag, a disc — and that artwork is the evidence they
 * belong together. Where two blocks stand in the same column with
 * nothing but ink between them, they are one offer, and where the gap
 * is empty paper they are two.
 *
 * Which is the same judgement the renderer makes at the other end of
 * the pipeline, for the same reason: a price a hand's width from its
 * own name belongs to no offer a reader can see.
 */
function weld(
  regions: { rect: Rect; text: string }[], art: PageItem[], options: GridOptions,
): Rect[] {
  /*
   * Decided once, over the regions as they were cut.
   *
   * The first version welded in a loop and grew the region each time,
   * which let it eat the page: a block joined to its neighbour is
   * wider, a wider block admits wider artwork as evidence, and two
   * rounds later 89% of the front page was one region. Every pair is
   * judged against the geometry the cut produced, and the groups are
   * merged afterwards.
   */
  const group = regions.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));

  /*
   * The alley between two regions, in whichever direction they are
   * neighbours — and `null` when they are neighbours in neither.
   *
   * Both directions, because a leaflet sets the number above the words
   * on one page and beside them on the next: page 1 of the book this
   * was written against stacks "10,-" over "Coop kartofler", page 3
   * stands "10,-" to the right of "Knorr sauce, bouillon". A reader
   * that only looks one way finds half the offers on a book.
   */
  const alley = (a: Rect, b: Rect): [Rect, 'x' | 'y'] | null => {
    for (const axis of ['y', 'x'] as const) {
      const across = axis === 'y' ? 'x' : 'y';
      if (share(a, b, across) < 0.6) continue;
      const size = (r: Rect) => (across === 'x' ? r.w : r.h);
      if (Math.max(size(a), size(b)) > Math.min(size(a), size(b)) * 3) continue;

      const near = axis === 'y' ? (a.y <= b.y ? [a, b] : [b, a]) : (a.x <= b.x ? [a, b] : [b, a]);
      const [first, second] = near as [Rect, Rect];
      const start = axis === 'y' ? first.y + first.h : first.x + first.w;
      const stop = axis === 'y' ? second.y : second.x;
      const room = axis === 'x' ? options.weldGapX : options.weldGap;
      if (stop - start <= 0 || stop - start > room) continue;

      return [
        axis === 'y'
          ? {
            x: Math.max(a.x, b.x),
            y: start,
            w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
            h: stop - start,
          }
          : {
            x: start,
            y: Math.max(a.y, b.y),
            w: stop - start,
            h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
          },
        axis,
      ];
    }
    return null;
  };

  /*
   * For each bare number, the one block of words it belongs to.
   *
   * A price mark prices exactly one offer, and on a page it has
   * neighbours on every side: the front page of the book this was
   * written against sets "49,-" with the bananas to its left and the
   * chicken below it, and welding to both joined two offers into one
   * region. So the partner is chosen once, over the whole page, by the
   * narrowest alley in any direction — and nothing else may claim it.
   */
  const nearest = new Map<number, number>();
  regions.forEach((region, i) => {
    if (!isPrice(region.text)) return;
    let best: { j: number; gap: number } | null = null;
    regions.forEach((other, j) => {
      if (i === j || isPrice(other.text)) return;
      const found = alley(region.rect, other.rect);
      if (!found) return;
      const thickness = found[1] === 'x' ? found[0].w : found[0].h;
      if (!best || thickness < best.gap) best = { j, gap: thickness };
    });
    if (best) nearest.set(i, (best as { j: number }).j);
  });

  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i]!.rect;
      const b = regions[j]!.rect;
      const found = alley(a, b);
      if (!found) continue;
      const [gap, axis] = found;

      /*
       * Side by side, only a bare number may be joined.
       *
       * Two offers standing next to each other look exactly like a
       * price standing next to its own text: both are neighbours in a
       * row with a packshot in the alley between them. Nothing in the
       * geometry separates the two cases — welding on it alone put all
       * four offers along the foot of the front page into one region.
       *
       * What separates them is in the file: a price mark's whole text
       * is a number. That is not a guess about a picture, it is the
       * characters the page was set in, and it is the one semantic fact
       * this package allows itself.
       */
      /*
       * A bare number joins its nearest words and nothing else.
       *
       * Both directions need the rule, for different reasons. Sideways,
       * two offers standing next to each other look exactly like a
       * price standing next to its own text — nothing in the geometry
       * separates the two cases, and welding on it alone put all four
       * offers along the foot of the front page into one region.
       * Downwards, a number already welded to the offer beside it
       * would weld the offer below to that one as well.
       *
       * What separates them is in the file: a price mark's whole text
       * is a number. That is not a guess about a picture, it is the
       * characters the page was set in, and it is the one semantic fact
       * this package allows itself.
       */
      const priced = [i, j].filter((k) => isPrice(regions[k]!.text));
      if (priced.length === 1) {
        const price = priced[0]!;
        if (nearest.get(price) !== (price === i ? j : i)) continue;
      } else if (axis === 'x') {
        // Two lumps of words side by side are two offers, always.
        continue;
      }

      /*
       * Ink in the alley, enough of it to be a product rather than a
       * hairline — and no bigger than the offer it would join.
       *
       * The size test is the one that matters. Without it the
       * photograph running behind four offers bridges every alley on
       * the sheet: a packshot belongs to its offer and is about its
       * size, while a picture three times wider than the words under
       * it is the page's ground.
       */
      const span = Math.max(a.w, b.w) * 1.6;
      const tall = Math.max(a.h, b.h) * 1.6;
      const bridged = art.some((item) => item.rect.w <= span && item.rect.h <= tall
        && share(item.rect, gap, 'x') > 0.4 && share(item.rect, gap, 'y') > 0.4);
      if (bridged) group[find(i)] = find(j);
    }
  }

  const merged = new Map<number, Rect>();
  regions.forEach((region, i) => {
    const key = find(i);
    const had = merged.get(key);
    merged.set(key, had ? union(had, region.rect) : region.rect);
  });
  return [...merged.values()];
}

/**
 * Let each region take the artwork that is plainly its own.
 *
 * The cut is made on words, so a region is a region of TYPE — and an
 * offer's cell is larger than its sentences by exactly the product
 * standing over them. Without this the grid is fitted to where the fine
 * print starts, which is inside the cell rather than at its edge, and
 * no lattice fits: measured on the front page, a hero whose words begin
 * at 63% of the sheet sits in a cell that begins at 55%.
 *
 * A picture is claimed only when one region is clearly nearest — its
 * centre inside that region grown by a third, and nobody else's. A
 * photograph behind four offers is near all of them and belongs to
 * none: it is the page's ground, and it stays out.
 */
function claim(regions: Rect[], art: PageItem[], options: GridOptions): Rect[] {
  const grown = regions.map((r) => ({ ...r }));

  for (const item of art) {
    const cx = item.rect.x + item.rect.w / 2;
    const cy = item.rect.y + item.rect.h / 2;

    const near = regions
      .map((region, index) => ({ index, region }))
      .filter(({ region }) => {
        const mx = region.w * 0.33;
        const my = region.h * 0.33;
        return cx >= region.x - mx && cx <= region.x + region.w + mx
          && cy >= region.y - my && cy <= region.y + region.h + my;
      });

    if (near.length !== 1) continue;
    const { index, region } = near[0]!;
    // A packshot is about the size of its offer. Anything much larger
    // is the field it is printed on, and growing a cell to hold it
    // would swallow the neighbours.
    if (area(item.rect) > area(region) * options.claimArea) continue;
    grown[index] = union(grown[index]!, item.rect);
  }

  return grown;
}

/**
 * The page's regions, by its own white space.
 *
 * Geometry and composition, no names: a block that holds one photograph,
 * a large word and four small ones is probably an offer, and this
 * package does not say so. What it hands over is enough for the stage
 * that can see to say it.
 */
export function blocks(page: ReferencePage, overrides: Partial<GridOptions> = {}): Block[] {
  const options = { ...GRID_DEFAULTS, ...overrides };
  const content = page.items.filter((item) => !isGround(item, options));

  /*
   * The cut is made on the WORDS, and the artwork is attached after.
   *
   * A white-space cut over everything works on a page laid out as a
   * grid of boxes and fails on a leaflet, because a leaflet's artwork
   * is the one thing that deliberately ignores the grid: a photograph
   * of chips runs the width of the sheet behind four offers, packshots
   * overlap their neighbours, and a price disc hangs off the corner it
   * belongs to. Measured on the front page of a real book: not one bin
   * of the page was free of ink, so the cut found a single block
   * containing everything.
   *
   * Type does not do that. Every offer on a leaflet carries a name and
   * a line of fine print, they sit in a column, and the gutters between
   * them are clean — which is also how a person counts the offers on a
   * page. So the words decide how many blocks there are and where they
   * are, and each block then claims the artwork nearest to it.
   */
  const words = content.filter((item) => item.kind === 'text');
  if (words.length === 0) return [];

  const sheet: Rect = { x: 0, y: 0, w: 1, h: 1 };
  const art = content.filter((item) => item.kind !== 'text');
  const regionsOfType = cut(words, tighten(words.map((i) => i.rect), sheet), 'y', 8, options)
    .map((rect) => ({
      rect,
      text: words
        .filter((item) => overlaps(item.rect, rect))
        .map((item) => item.text ?? '')
        .join(' ')
        .trim(),
    }));
  const welded = weld(regionsOfType, art, options)
    .filter((r) => area(r) >= options.minBlockArea);
  const regions = claim(welded, art, options);

  return regions.map((rect) => {
    const inside = content.filter((item) => overlaps(item.rect, rect));
    const texts = inside.filter((i) => i.kind === 'text');
    return {
      rect,
      images: inside.filter((i) => i.kind === 'image').length,
      paths: inside.filter((i) => i.kind === 'path').length,
      texts: texts.length,
      maxTextSize: texts.reduce((most, i) => Math.max(most, i.size ?? 0), 0),
      text: texts
        .slice()
        .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x))
        .map((i) => i.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  });
}

/**
 * The blocks that look like offers, by geometry alone.
 *
 * The one place in this package that guesses at meaning, and it is
 * marked as such: an offer is a lump of type with a big number in it, a
 * masthead is the same shape without the fine print, and geometry
 * cannot tell a chain's slogan from a product name. What it can do is
 * drop the two things that are never an offer — a band running the full
 * width of the sheet, and a region with too little type to be selling
 * anything — and leave a page that is mostly right to the stage that
 * can see. Overrule it rather than tuning it.
 */
export function offerBlocks(found: Block[], overrides: Partial<GridOptions> = {}): Block[] {
  const options = { ...GRID_DEFAULTS, ...overrides };
  const sizes = found.map((b) => b.maxTextSize).filter((n) => n > 0).sort((a, b) => a - b);
  const middle = sizes[Math.floor(sizes.length / 2)] ?? 0;

  return found.filter((block) => {
    // A full-width band is a masthead, a validity line or a footer. No
    // leaflet prints one offer across the whole sheet and calls the
    // page done.
    if (block.rect.w > options.bandWidth) return false;
    if (block.texts < 3) return false;
    // Something in it is set large — the price, or the name of the
    // thing being sold. A block of nothing but fine print is a legal
    // line, not an offer.
    return block.maxTextSize >= middle * 0.9;
  });
}

/** Where one block sits on a lattice, in whole cells. */
interface Span { c0: number; c1: number; r0: number; r1: number }

/**
 * The lines of an n-track lattice with a gutter between the tracks.
 *
 * Two lines per track, not one: a grid's cells have a start and an end,
 * and the alley between them is what a leaflet calls a gutter. Modelled
 * rather than absorbed into the tolerance, because it is a real
 * measurement the page can be asked for — and because a tolerance wide
 * enough to swallow a 4% gutter is also wide enough to accept a lattice
 * the page is not on. Measured on a clean two-up page, every edge sat
 * 4.1% from the nearest line of a gapless lattice, which is to say the
 * gutter, and the reading came back "no grid".
 */
function lines(from: number, to: number, tracks: number, gap: number): number[] {
  const cell = ((to - from) - (tracks - 1) * gap) / tracks;
  if (cell <= 0) return [];
  const out: number[] = [];
  for (let k = 0; k < tracks; k += 1) {
    const start = from + k * (cell + gap);
    out.push(start, start + cell);
  }
  return out;
}

/** How far each edge sits from the nearest line of this lattice. */
function misfits(
  edges: number[], from: number, to: number, tracks: number, gap: number,
): number[] {
  const at = lines(from, to, tracks, gap);
  if (at.length === 0) return edges.map(() => Infinity);
  return edges.map((edge) => at.reduce((best, line) => Math.min(best, Math.abs(edge - line)), Infinity));
}

const worst = (values: number[]) => values.reduce((most, v) => Math.max(most, v), 0);

interface Fit { tracks: number; gap: number; agree: number; worst: number }

/**
 * The coarsest lattice most of these edges agree on, or `null`.
 *
 * MOST, not all, and the exception is the whole reason this repo has a
 * `bleedPercent` field: a leaflet's lead artwork deliberately runs past
 * its own cell, so one edge of the biggest offer on the page lands
 * wherever the photograph ended. Measured on a real front page, nine of
 * ten edges sat within half a percent of a four-column lattice and the
 * tenth — the hero's bleeding packshot — sat eight and a half percent
 * out. Fitting to the worst edge rejects the grid the page is plainly
 * on; fitting to the agreement finds it and leaves the overrun to be
 * reported as what it is.
 *
 * The gutter is searched rather than assumed. A chain sets one gutter
 * for a book and every page uses it, but this package is not told which
 * chain it is reading, so the width that best explains the edges is the
 * width that is reported.
 */
function fitTracks(
  edges: number[], from: number, to: number, options: GridOptions,
): Fit | null {
  for (let tracks = 1; tracks <= options.maxTracks; tracks += 1) {
    let best: Fit | null = null;
    for (let gap = 0; gap <= options.maxGutter + 1e-9; gap += 0.005) {
      const off = misfits(edges, from, to, tracks, gap);
      const agree = off.filter((d) => d <= options.tolerance).length / off.length;
      const miss = worst(off);
      // Most edges explained first, then explained best. Stopping at the
      // first gutter that clears the tolerance reports a gutter that is
      // merely good enough, and the gutter is one of the measurements
      // this whole package exists to take.
      if (!best || agree > best.agree || (agree === best.agree && miss < best.worst)) {
        best = { tracks, gap, agree, worst: miss };
      }
    }
    if (best && best.agree >= options.agreement) return best;
  }
  return null;
}

const NAMES = 'abcdefghijklmnopqrstuvwxyz';

/**
 * The grid these blocks sit on, written as `grid-template-areas`.
 *
 * The coarsest one that fits, which is the same rule the prompt gives a
 * model and the same one a person reading the page applies: a four-up
 * page is four columns, not twenty-four, even though twenty-four also
 * "fits" every edge. Coarsest first, and the first that clears the
 * tolerance wins.
 *
 * The span is the CONTENT's own bounds rather than the sheet's, so a
 * page's margins are not counted as part of a column. A leaflet's
 * margin is not a track; it is the paper the tracks are printed on.
 */
export function lattice(
  rects: Rect[], overrides: Partial<GridOptions> = {},
): Omit<GridReading, 'slots'> & { spans: Span[] } | null {
  const options = { ...GRID_DEFAULTS, ...overrides };
  if (rects.length === 0) return null;

  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y0 = Math.min(...rects.map((r) => r.y));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));

  const across = fitTracks(rects.flatMap((r) => [r.x, r.x + r.w]), x0, x1, options);
  const down = fitTracks(rects.flatMap((r) => [r.y, r.y + r.h]), y0, y1, options);
  if (!across || !down) return null;

  const columns = across.tracks;
  const rows = down.tracks;
  // The track a coordinate falls in, gutter included — the gutter
  // belongs to the track before it, which is where a block's own edge
  // sits when its artwork runs a little wide.
  const track = (value: number, from: number, to: number, fit: Fit) => {
    const cell = ((to - from) - (fit.tracks - 1) * fit.gap) / fit.tracks;
    return Math.round((value - from) / (cell + fit.gap));
  };
  const spans = rects.map((r) => ({
    c0: track(r.x, x0, x1, across),
    c1: Math.max(track(r.x, x0, x1, across) + 1, track(r.x + r.w, x0, x1, across)),
    r0: track(r.y, y0, y1, down),
    r1: Math.max(track(r.y, y0, y1, down) + 1, track(r.y + r.h, y0, y1, down)),
  }));

  // '.' is a cell no block claimed, which `grid-template-areas` already
  // has a spelling for and every stage downstream already understands.
  const cells: string[][] = Array.from({ length: rows }, () => new Array<string>(columns).fill('.'));
  spans.forEach((span, index) => {
    const id = NAMES[index % NAMES.length]!;
    for (let r = Math.max(0, span.r0); r < Math.min(rows, span.r1); r += 1) {
      for (let c = Math.max(0, span.c0); c < Math.min(columns, span.c1); c += 1) {
        cells[r]![c] = id;
      }
    }
  });

  return {
    columns,
    rows,
    areas: cells.map((row) => row.join(' ')),
    fit: Math.max(across.worst, down.worst),
    gutter: { x: across.gap, y: down.gap },
    spans,
  };
}

/**
 * A page's blocks and the grid they sit on, in one call.
 *
 * The blocks are handed back with the grid so a caller can throw the
 * ones that are not offers away and ask for the lattice again — which
 * is the normal case, because a masthead and a footer sit on a page
 * without sitting in its grid.
 */
export function gridOf(
  page: ReferencePage, overrides: Partial<GridOptions> = {},
): GridReading & { blocks: Block[] } | null {
  const found = blocks(page, overrides);
  /*
   * The grid is fitted to the OFFERS, not to everything on the sheet.
   *
   * A masthead sits on a page without sitting in its grid, and a footer
   * band spans every column there is: fitted alongside the offers they
   * drag the lattice off every line the page is actually on, and a
   * front page that is plainly four-up comes back as "no grid".
   */
  const offers = offerBlocks(found, overrides);
  const fitted = lattice(offers.map((b) => b.rect), overrides);
  if (!fitted) return null;

  return {
    columns: fitted.columns,
    rows: fitted.rows,
    areas: fitted.areas,
    gutter: fitted.gutter,
    fit: fitted.fit,
    blocks: found,
    slots: offers.map((block, index) => ({
      id: NAMES[index % NAMES.length]!,
      rect: block.rect,
      block,
    })),
  };
}
