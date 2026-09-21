/**
 * Turning a picture of a composition into moves for the real cutouts.
 *
 * `readClusterLayout` gives four numbers per product as fractions of
 * the PICTURE. Nothing on the page is measured in fractions of that
 * picture, and the three steps in between are where a composition that
 * looked right in Gemini came out skewed on the page:
 *
 *  1. The picture is not the cell. Gemini is asked for the cell's
 *     aspect ratio and answers with whatever its model produces —
 *     usually a square. Reading `cy` against the cell's own height
 *     stretches every vertical distance by the ratio between the two,
 *     which is exactly what "skævt" looks like: right across, wrong
 *     down.
 *
 *  2. The composition does not fill its picture. There is white around
 *     it, as the prompt demands, and how much varies per generation.
 *     Mapping the picture onto the cell prints that white as empty
 *     field and the products as too small.
 *
 *  3. A cutout is not its box. Every product in a cluster is an `img`
 *     filling its own track with `object-fit: contain`, so its element
 *     is as wide as the track and the ARTWORK inside it is letterboxed
 *     — a tall bottle in a wide track draws at a third of its box.
 *     Scaling by the box makes the tall ones tiny.
 *
 * So the group is rebuilt rather than traced. Each product is given a
 * box in picture units from the width the model read and the cutout's
 * OWN proportions, the union of those boxes is fitted into the artwork
 * box, and every product is moved to where that fit puts it. What
 * survives is the composition — the relative positions, sizes and
 * overlaps — which is the only thing the picture was ever consulted
 * for.
 *
 * Pure arithmetic in pixels, so it can be tested without a browser.
 * The caller measures the DOM and converts the answer back into the
 * per cent and multipliers a `PackOverride` spends.
 */

/** Where the model says one product sits, in fractions of the picture. */
export interface PlacedProduct {
  /** Which product, counting from 1 as the prompt numbered them. */
  index: number;
  cx: number;
  cy: number;
  /** Its width as a fraction of the picture's width. */
  width: number;
  /**
   * Where it stands, 0–1 down the picture — read, not derived.
   *
   * Optional only because an older reading may not carry one; when it
   * is missing the box falls back to centre plus half a height, which
   * is what everything did before and which is exactly as good as the
   * width estimate is. See the note in `readClusterLayout`.
   */
  bottom?: number;
  rotate: number;
}

/** One product as it stands on the page right now, in page pixels. */
export interface MeasuredProduct {
  /** Centre of the drawn artwork. */
  cx: number;
  cy: number;
  /** Width of the ARTWORK as drawn — letterboxing already taken off. */
  width: number;
  /** Everything currently turning it, the arrangement's own share included. */
  rotate: number;
  /** The cutout's own proportions, width over height. */
  aspect: number;
  /**
   * How far the product sits from the middle of its own picture, in
   * page pixels at the size it is drawn now.
   *
   * Needed because the two corrections do not commute: the page scales
   * a cutout about the PICTURE's centre, and a product that is not in
   * the middle of its picture therefore slides as it grows. Without
   * this the move is right and then the resize walks away from it.
   */
  driftX: number;
  driftY: number;
  /** The corrections already on it, which the answer is relative to. */
  already: { offsetX: number; offsetY: number; scale: number; rotate: number };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What one product's correction comes out as. */
export interface PackPatch {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotate: number;
}

/**
 * Where the picture itself lands, as fractions of the artwork box.
 *
 * The same mapping the products got, applied to the whole frame, so a
 * ghost of the composition drawn in this rectangle sits exactly on top
 * of the cutouts it was read from. That is the point: a person can SEE
 * whether the tile matches the picture instead of taking its word.
 */
export interface GhostFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClusterPlan {
  /** One correction per product, keyed by its place in the pack. */
  patches: Map<number, PackPatch>;
  /** Where to draw the picture so it lies on what was rebuilt from it. */
  frame: GhostFrame | null;
  /** What is wrong with the arrangement — see `reviewCluster`. */
  complaints: Complaint[];
}


/** A product's target box in picture units, as `planCluster` builds it. */
interface Want {
  index: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * How far apart two bottoms may be and still be the same shelf, as a
 * share of the tallest product.
 *
 * Small on purpose. At a tenth the cascade of a row of tubs would be
 * flattened into a line; at a fiftieth nothing would ever snap. Six per
 * cent is about a centimetre on A4 — under it nobody sees a step, over
 * it everybody does.
 */
export const BASELINE_WITHIN = 0.06;

/**
 * Put the products that are nearly on one line exactly on it.
 *
 * Mutates, because it is one step of building the same array and
 * copying it twice says nothing. Exported for the test, which is the
 * only way to see that a cascade survives it.
 */
export function snapToBaseline(wants: Want[], within = BASELINE_WITHIN): void {
  if (wants.length < 2) return;
  const tallest = Math.max(...wants.map((want) => want.height));
  if (tallest <= 0) return;

  /*
   * The shelf is the BIGGEST group of bottoms that sit within reach of
   * each other — not the group nearest the floor.
   *
   * Nearest-the-floor was the first version and it is wrong in the one
   * case this exists for: a row of three with one read a shade low.
   * Measured from the lowest, the two that agree with each other fall
   * outside the reach of the stray, so the pair is discarded and the
   * odd one out becomes the line. The biggest group cannot do that —
   * it is by definition the products that agree.
   */
  const reach = tallest * within + 1e-9;
  const order = wants
    .map((want, at) => ({ at, bottom: want.cy + want.height / 2 }))
    .sort((a, b) => a.bottom - b.bottom);

  let from = 0;
  let count = 0;
  for (let low = 0; low < order.length; low += 1) {
    let high = low;
    while (high + 1 < order.length && order[high + 1]!.bottom - order[low]!.bottom <= reach) {
      high += 1;
    }
    // `>` and not `>=`: ties keep the LOWEST group, which is the row
    // standing at the front of a composition with two rows in it.
    if (high - low + 1 > count) {
      count = high - low + 1;
      from = low;
    }
  }
  if (count < 2) return;

  const shelf = order.slice(from, from + count);
  const line = shelf.reduce((all, entry) => all + entry.bottom, 0) / shelf.length;
  for (const entry of shelf) {
    const want = wants[entry.at]!;
    want.cy = line - want.height / 2;
  }
}

/** Something about the finished arrangement worth saying out loud. */
export interface Complaint {
  /** Which product, counting from 0 as the pack does. `null` for the group. */
  index: number | null;
  said: string;
}

/**
 * What is wrong with the arrangement, as words.
 *
 * The point of this is not to correct anything — a composition an
 * editor asked for is theirs — but to say so. "Automatic" is only worth
 * having if the thing can tell you when it has produced a page you
 * would not print, and every check here is one somebody would otherwise
 * have to catch by eye on a proof.
 */
export function reviewCluster(
  wants: Want[],
  /** What each product's pack says it holds, in grams or millilitres. */
  sizes: (number | null)[] = [],
): Complaint[] {
  const complaints: Complaint[] = [];
  if (wants.length < 2) return complaints;

  const heights = [...wants.map((want) => want.height)].sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)]!;

  for (const want of wants) {
    // A product drawn twice the height of the middle one is either the
    // hero or a mistake, and past that it is a mistake.
    if (median > 0 && want.height > median * 2.2) {
      complaints.push({
        index: want.index,
        said: `står ${(want.height / median).toFixed(1)}× højere end de andre`,
      });
    }

    // Overlap, measured on the boxes the page will actually draw.
    for (const other of wants) {
      if (other.index <= want.index) continue;
      const over = overlap(want, other);
      const smaller = Math.min(want.width * want.height, other.width * other.height);
      if (smaller > 0 && over / smaller > 0.15) {
        complaints.push({
          index: want.index,
          said: `dækker ${Math.round((over / smaller) * 100)} % af vare ${other.index + 1}`,
        });
      }
    }
  }

  /*
   * And the one check the picture cannot make: whether the sizes are
   * the sizes. A 1000 ml bottle drawn smaller than a 200 g tub is the
   * error that makes a cluster look wrong before anybody can say why —
   * and it is the one an image model makes, because it is arranging
   * pictures and not shopping.
   */
  for (const want of wants) {
    const mine = sizes[want.index];
    if (!mine) continue;
    for (const other of wants) {
      const theirs = sizes[other.index];
      if (!theirs || other.index === want.index) continue;
      const area = want.width * want.height;
      const theirArea = other.width * other.height;
      if (mine > theirs * 2 && area < theirArea) {
        complaints.push({
          index: want.index,
          said: `er ${(mine / theirs).toFixed(1)}× så stor som vare ${
            other.index + 1} men tegnes mindre`,
        });
      }
    }
  }

  return complaints;
}

/** Where two target boxes cover each other, in picture units squared. */
function overlap(a: Want, b: Want): number {
  const wide = Math.min(a.cx + a.width / 2, b.cx + b.width / 2)
    - Math.max(a.cx - a.width / 2, b.cx - b.width / 2);
  const tall = Math.min(a.cy + a.height / 2, b.cy + b.height / 2)
    - Math.max(a.cy - a.height / 2, b.cy - b.height / 2);
  return wide > 0 && tall > 0 ? wide * tall : 0;
}

export interface PlanInput {
  /** The artwork box the cluster lives in, in page pixels. */
  media: Box;
  /** The page, because offsets are spent as a per cent of it. */
  page: { width: number; height: number };
  /** The uploaded picture's own proportions, width over height. */
  picture: number;
  /** What the model read. */
  placed: PlacedProduct[];
  /** What is on the page, indexed from 0. `null` for one not found. */
  measured: (MeasuredProduct | null)[];
  /**
   * What each pack says it holds, in grams or millilitres — see
   * `readPackSize`. Used only to complain, never to place: the feed is
   * right about what is in the bag and says nothing about how a
   * photograph of it should be cropped.
   */
  sizes?: (number | null)[];
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * How far a product may be moved and how far resized.
 *
 * The schema's own limits — see `PackOverride` — repeated here rather
 * than imported so this file stays arithmetic. A correction that would
 * go past them is clamped rather than dropped: a product that lands
 * short is one a person can drag the rest of the way, and one that
 * refuses to move is a button that did nothing.
 *
 * The offset has to cover the widest move a COMPOSITION can ask for,
 * not the widest a hand would make. The stylesheet lays a pack out in
 * its own order and an image model composes it in whatever order it
 * likes, so rebuilding a composition routinely means two products
 * swapping ends of the cell — near sixty per cent of the sheet on a
 * full-width tile. Every ceiling below that stopped them half way and
 * piled them up in the middle, which is precisely what "it ignored my
 * picture" looked like.
 */
export const PACK_LIMITS = { offset: 100, minScale: 0.2, maxScale: 3, rotate: 45 } as const;

/**
 * The composition, rebuilt where the products actually are.
 *
 * Returns one patch per product the model found AND the page could
 * measure, keyed by its 0-based position in the cluster.
 */
export function planCluster(input: PlanInput): ClusterPlan {
  const { media, page, placed, measured } = input;
  const patches = new Map<number, PackPatch>();
  if (media.width <= 0 || media.height <= 0 || page.width <= 0 || page.height <= 0) {
    return { patches, frame: null, complaints: [] };
  }

  /*
   * Picture units: as wide as the picture is over its own height, one
   * tall. Any unit does, as long as `cx` and `cy` are read in the
   * picture's own proportions and not in the cell's.
   */
  const pictureWidth = input.picture > 0 ? input.picture : 1;

  const wants: Want[] = [];
  for (const product of placed) {
    const index = product.index - 1;
    const now = measured[index];
    if (!now || now.width <= 0 || now.aspect <= 0) continue;
    const width = product.width * pictureWidth;
    if (width <= 0) continue;
    // Height from the CUTOUT's proportions, not from the model: the
    // artwork is what will be drawn, so its own shape decides how tall
    // the box it needs is.
    const height = width / now.aspect;
    /*
     * Hung from the bottom edge when the reading gives one.
     *
     * The centre and the bottom cannot both be honoured — the height
     * between them is derived from the width, and the width is the one
     * number this reading is genuinely uncertain about. Standing on the
     * page is the thing a person sees, so the bottom wins and the
     * centre follows from it.
     */
    const cy = product.bottom === undefined
      ? product.cy
      : product.bottom - height / 2;
    wants.push({ index, cx: product.cx * pictureWidth, cy, width, height });
  }
  if (wants.length === 0) return { patches, frame: null, complaints: [] };

  /*
   * One line to stand on.
   *
   * A printed leaflet stands its products on an invisible shelf, and
   * the composition is asked for exactly that — but an image model
   * lands them a per cent or two apart, and the reading adds its own
   * per cent. Two per cent of a cell is four pixels on paper and it
   * reads as sloppiness: the group looks like it is floating rather
   * than standing.
   *
   * So near-equal bottoms are made equal. NEAR-equal, and only those: a
   * cascade of tubs and a hero lifted forward are shapes a leaflet
   * actually prints, and flattening them would throw away the
   * arrangement rather than tidy it.
   */
  snapToBaseline(wants);

  /*
   * The group's own extent, which is what gets fitted — not the
   * picture's, so the white the prompt asked for around the
   * composition does not print as empty cell.
   */
  const left = Math.min(...wants.map((want) => want.cx - want.width / 2));
  const right = Math.max(...wants.map((want) => want.cx + want.width / 2));
  const top = Math.min(...wants.map((want) => want.cy - want.height / 2));
  const bottom = Math.max(...wants.map((want) => want.cy + want.height / 2));
  const groupWidth = Math.max(right - left, 1e-6);
  const groupHeight = Math.max(bottom - top, 1e-6);

  // One factor for both directions. Two would fit the cell more tightly
  // and would print a squashed bottle, which is the thing this whole
  // file exists to stop.
  const fit = Math.min(media.width / groupWidth, media.height / groupHeight);
  const originX = media.left + media.width / 2 - ((left + right) / 2) * fit;
  const originY = media.top + media.height / 2 - ((top + bottom) / 2) * fit;

  for (const want of wants) {
    const now = measured[want.index]!;
    const wantX = originX + want.cx * fit;
    const wantY = originY + want.cy * fit;
    const wantWidth = want.width * fit;
    const spin = placed.find((product) => product.index - 1 === want.index)?.rotate ?? 0;

    // How much bigger the product is about to be drawn, which is also
    // how much further its own off-centre drift will carry it.
    const grows = wantWidth / now.width;

    patches.set(want.index, {
      /*
       * Corrections, not absolutes. What was measured is the product
       * WITH its current overrides on it, so the move is added to what
       * is already there and running the same picture twice converges
       * instead of compounding.
       */
      offsetX: clamp(
        now.already.offsetX
        + ((wantX - now.cx + now.driftX * (1 - grows)) / page.width) * 100,
        -PACK_LIMITS.offset, PACK_LIMITS.offset,
      ),
      offsetY: clamp(
        now.already.offsetY
        + ((wantY - now.cy + now.driftY * (1 - grows)) / page.height) * 100,
        -PACK_LIMITS.offset, PACK_LIMITS.offset,
      ),
      scale: clamp(
        now.already.scale * grows,
        PACK_LIMITS.minScale, PACK_LIMITS.maxScale,
      ),
      /*
       * The arrangement turns some of its items by itself — a fan puts
       * six degrees on each outer one — and the model reads the total.
       * Writing the total back would add the stylesheet's share a
       * second time, so what is written is the difference.
       */
      rotate: clamp(
        now.already.rotate + (spin - now.rotate),
        -PACK_LIMITS.rotate, PACK_LIMITS.rotate,
      ),
    });
  }

  /*
   * The picture's own rectangle under the same mapping — in fractions
   * of the artwork box, so it survives the page being drawn at any
   * size, from a thumbnail to A4.
   */
  const frame: GhostFrame = {
    left: (originX - media.left) / media.width,
    top: (originY - media.top) / media.height,
    width: (pictureWidth * fit) / media.width,
    height: fit / media.height,
  };

  return { patches, frame, complaints: reviewCluster(wants, input.sizes ?? []) };
}
