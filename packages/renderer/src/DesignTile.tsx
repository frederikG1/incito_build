import { PriceMark, pricePieces, setsPrice } from './price-mark.js';
import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { adjustment } from './adjust.js';
import { packOverride, packStack, partOverride, type DesignLayer, type DesignParagraph, type Offer, type OfferDesign, type PlacementOverrides, type TilePart } from '@incitio/schema';
import { incitoVars, renderLiquid } from './liquid.js';
import { packStyle } from './OfferTile.js';

/**
 * One offer drawn in one of the chain's offer designs.
 *
 * Every box comes from the design: layer by layer, at the fractions of
 * the cell the design states, first layer on top — the way incito draws
 * it. The offer only fills them. The picture is fitted INTO its box and
 * never moves another; a design without an image box draws no picture.
 *
 * Sizes in the CMS are pixels at the width a designer saw the cell at.
 * They are drawn as a share of the cell's width instead (`cqw`), so a
 * design reads the same in a thumbnail and on A4.
 */

/** The cell width, in CMS pixels, that the chain's designs are drawn for. */
export const DESIGN_REFERENCE_PX = 240;

/*
 * Against the cell's SHORTER side: in a square cell that is its width, as
 * the CMS draws it; in the wide cell a lone last offer spans, the words
 * keep the size of their neighbours instead of growing with the row.
 */
const cq = (px: number) => `${(px / DESIGN_REFERENCE_PX) * 100}cqmin`;
const pxValue = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const match = /^(-?[\d.]+)(px)?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
};
const cssLength = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string' && value.trim().endsWith('%')) return value.trim();
  const px = pxValue(value);
  return px === null ? undefined : cq(px);
};
const boxShorthand = (value: string | number | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return cq(value);
  return value.trim().split(/\s+/).map((part) => cssLength(part) ?? '0').join(' ');
};

const FLEX: Record<string, string> = { center: 'center', 'flex-end': 'flex-end', 'flex-start': 'flex-start' };

export interface DesignTileProps {
  design: OfferDesign;
  offer: Offer;
  /** Width over height of the cell. */
  aspect: number;
  overrides?: PlacementOverrides;
  /** The cell's size as fractions of the page — the editor's part offsets are page percentages. */
  cell?: { w: number; h: number };
  selected?: boolean;
  onSelect?: (offerId: string) => void;
  /** Why this design — for the title tooltip. */
  because?: string;
}

/** Whether a typed layer has anything to show for this offer. */
function shows(layer: DesignLayer, offer: Offer, vars: Record<string, unknown>): boolean {
  if (layer.is_hidden) return false;
  const has = (key: string) => vars[key] !== null && vars[key] !== undefined && vars[key] !== '';
  switch (layer.type) {
    case undefined: return true;
    case 'offer_image': return Boolean(offer.imageUrl);
    // The offer's own background image. Our feeds have none — a photograph
    // is the offer's image and goes in the image box — so this layer only
    // shows the design's artwork, or a photo when the design has no image box.
    case 'offer_bg_image': return Boolean(layer.bg_image_url?.signed) || Boolean(vars['__photoAsBackground']);
    case 'offer_text': return true;
    case 'offer_price': return has('offerPrice') || has('offerFromPrice');
    case 'offer_savings': return has('offerSavings') || has('offerCommentLabel3');
    case 'offer_membership_price':
    case 'offer_membership_savings':
    case 'offer_membership_relative_savings': return has('offerMembershipPrice');
    case 'offer_relative_savings': return has('offerRelativeSavings');
    case 'offer_logos': return offer.labels.some((label) => label.image);
    case 'offer_custom_label_1': return has('offerCustomLabel1');
    case 'offer_custom_label_2': return has('offerCustomLabel2');
    case 'offer_custom_label_3': return has('offerCustomLabel3');
    case 'offer_comment_label_1': return has('offerCommentLabel1');
    case 'offer_comment_label_2': return has('offerCommentLabel2');
    case 'offer_comment_label_3': return has('offerCommentLabel3');
    default: return false;
  }
}

function paragraphStyle(p: DesignParagraph, layer: DesignLayer, text: string, box: { w: number; h: number }, others = 0, side = 1, grow = 1): CSSProperties {
  const color = p.text_color_level === 'primary' && layer.primary_color ? layer.primary_color
    : p.text_color_level === 'secondary' && layer.secondary_color ? layer.secondary_color
      : p.text_color ?? undefined;
  /*
   * `text_max_size` is a ceiling the text shrinks under to fit its box —
   * a price of 109,95 in a disc drawn for 19,-. One line of it must fit
   * the box's width, and it may not be taller than the box.
   */
  const lines = Math.max(1, p.text_max_lines ?? 1);
  // A layer `reshape` made larger carries its words larger with it.
  let size = (p.text_size ?? p.text_max_size ?? 12) * grow;
  // A raised ",-" or øre takes less width than it would as text: count it at its own size.
  const pieces = p.incito_price?.minor === 'raised' ? pricePieces(text) : null;
  const length = pieces
    ? text.length - (pieces.separator.length + pieces.minor.length) * (1 - (p.incito_price!.minorSize ?? 50) / 100)
    : text.length;
  if (p.text_max_size) {
    const chars = Math.max(2, Math.ceil(length / lines));
    // Box sizes are in cell widths; sizes are in the cell's shorter side (`side` of its width).
    const byWidth = (box.w / side * DESIGN_REFERENCE_PX * 0.86) / (0.66 * chars);
    // Sharing its box with other lines — "1 stk." over the price — it may take only part of the height.
    const share = others > 0 ? 0.62 : 0.9;
    const byHeight = (box.h / side * DESIGN_REFERENCE_PX * share) / (lines * (p.text_line_height ?? 1.15));
    size = Math.min(p.text_max_size * grow, byWidth, byHeight);
  }
  /*
   * One word — a figure like "560,70" — cannot wrap into its box, only
   * spill out of it. The CMS gives the saving a fixed size drawn for
   * "Spar 20,-", and a saving of 560,70 kr. at that size broke across
   * the disc's edge. A fixed size is a ceiling for a single word too.
   */
  const oneWord = !/\s/.test(text.trim());
  if (!p.text_max_size && oneWord) {
    const chars = Math.max(2, text.trim().length);
    size = Math.min(size, (box.w / side * DESIGN_REFERENCE_PX * 0.86) / (0.66 * chars));
  }
  const heading = (p.text_level ?? 'body').startsWith('h');
  return {
    fontSize: cq(size),
    lineHeight: p.text_line_height ?? 1.15,
    color,
    textAlign: (p.text_align as CSSProperties['textAlign']) ?? 'left',
    fontWeight: p.incito_price?.weight ?? (p.text_weight === 'bold' ? 700 : p.text_weight === 'normal' ? 400 : heading ? 700 : 400),
    fontFamily: p.incito_price?.font ?? (heading ? 'var(--heading-font)' : 'var(--body-font)'),
    textTransform: (p.text_transform as CSSProperties['textTransform']) ?? undefined,
    letterSpacing: p.text_letter_spacing ? cq(p.text_letter_spacing) : undefined,
    /*
     * No width of its own: as wide as its words, placed by the layer's
     * `flex_align_items` — how the CMS centres "45,-" on its disc. A full
     * width made the paragraph's own `text_align: right` push it off-centre.
     */
    ...(cssLength(p.width) ? { width: cssLength(p.width) } : { maxWidth: '100%' }),
    ...(oneWord ? { whiteSpace: 'nowrap' as const } : {}),
    margin: boxShorthand(p.margin),
    padding: boxShorthand(p.padding ?? null),
    ...(p.text_max_lines ? {
      display: '-webkit-box', WebkitLineClamp: p.text_max_lines, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
    } : {}),
  };
}

function layerBackground(layer: DesignLayer): CSSProperties {
  const style: CSSProperties = {};
  if (layer.bg_color) style.backgroundColor = layer.bg_color;
  const images: string[] = [];
  if (layer.gradient_color && layer.gradient_color.length > 0) {
    const stops = layer.gradient_color.map((stop) => `${stop.color} ${stop.percent}%`).join(', ');
    images.push(`linear-gradient(${(layer.gradient_color_angle ?? 0) + 180}deg, ${stops})`);
  }
  if (layer.bg_image_url?.signed) images.push(`url("${layer.bg_image_url.signed}")`);
  if (images.length > 0) {
    style.backgroundImage = images.join(', ');
    style.backgroundSize = layer.bg_image_size === 'cover' ? 'cover' : 'contain';
    style.backgroundPosition = 'center';
    style.backgroundRepeat = 'no-repeat';
  }
  const radius = layer.border_radius;
  if (radius !== null && radius !== undefined && radius !== '') style.borderRadius = cssLength(radius);
  return style;
}

/**
 * A box whose artwork is fitted in (`contain`) — the chain's round price
 * disc — drawn as the square the artwork actually fills, centred where
 * the CMS centres it. In a wide cell the box is wide and the disc is not;
 * the price has to stand on the disc.
 */
function fitted(layer: DesignLayer, aspect: number): DesignLayer {
  if (!layer.bg_image_url?.signed || layer.bg_image_size === 'cover' || layer.gradient_color?.length) return layer;
  const w = layer.x2 - layer.x1;
  const h = (layer.y2 - layer.y1) / aspect;
  if (Math.abs(w - h) < 0.01) return layer;
  const side = Math.min(w, h);
  const cx = (layer.x1 + layer.x2) / 2;
  const cy = (layer.y1 + layer.y2) / 2;
  const sideY = side * aspect;
  return { ...layer, x1: cx - side / 2, x2: cx + side / 2, y1: cy - sideY / 2, y2: cy + sideY / 2 };
}

/** How far from square a cell may be before `reshape` lays the design out again. */
export const RESHAPE_FROM = 1.25;
/** The most a price or line of words grows in a tall cell. */
const GROW_MAX = 1.3;

type Span = { a1: number; a2: number; b1: number; b2: number };

/**
 * A design laid out again for a cell well off square.
 *
 * The designs are drawn for cells near square. Stretched as they are
 * into a tall cell, every box grew tall and everything in it stayed the
 * size the width allowed: a small picture and price in the middle,
 * empty paper above and below. Instead:
 *
 * - The picture's band takes the length the cell has over a square, and
 *   every box spanning that band (the backgrounds) stretches with it.
 *   A box above it keeps its place; one on it keeps its place on the
 *   picture; one below moves down with the cell's end.
 * - In a tall cell with room for it, what stood side by side under the
 *   picture — the name beside the price — is stacked: each line gets the
 *   cell's whole width and grows (up to `GROW_MAX`), the price over the
 *   words, the way a tall column in a printed avis reads.
 * - A box tied to another (`parent_id`: a saving on its disc) moves and
 *   grows with it.
 *
 * A wide cell is laid out again but does not grow its words: there the
 * cell's height sets them, as in its row. Returns the layers in the
 * cell's fractions, and how much each one grew.
 */
export function reshape(layers: DesignLayer[], aspect: number): { layers: DesignLayer[]; grow: Map<string, number> } {
  const grow = new Map<string, number>();
  const tall = aspect < 1 / RESHAPE_FROM;
  const wide = aspect > RESHAPE_FROM;
  const image = layers.find((layer) => layer.type === 'offer_image');
  if ((!tall && !wide) || !image) return { layers, grow };
  // `a` runs along the cell's long side, `b` across it; both in units of the short side.
  const [a1, a2, b1, b2] = tall ? (['y1', 'y2', 'x1', 'x2'] as const) : (['x1', 'x2', 'y1', 'y2'] as const);
  const span = (layer: DesignLayer): Span => ({ a1: layer[a1], a2: layer[a2], b1: layer[b1], b2: layer[b2] });
  const long = tall ? 1 / aspect : aspect;
  const s1 = image[a1];
  const s2 = Math.max(image[a2], s1 + 0.05);
  const ids = new Set(layers.map((layer) => String(layer.id)));
  const parentOf = (layer: DesignLayer) =>
    layer.parent_id !== null && layer.parent_id !== undefined && ids.has(String(layer.parent_id)) ? String(layer.parent_id) : null;
  const spans = (layer: DesignLayer) => layer === image || (layer[a1] <= s1 + 1e-6 && layer[a2] >= s2 - 1e-6);
  const centre = (box: Span) => (box.a1 + box.a2) / 2;
  const own = layers.filter((layer) => parentOf(layer) === null);
  const placed = new Map<string, Span>();

  /* Under the picture: stacked in a tall cell when the length allows it
     without the picture getting smaller than in a square. */
  const foot = own.filter((layer) => !spans(layer) && centre(span(layer)) >= s2)
    .sort((x, y) => x[a1] - y[a1] || x[b1] - y[b1]);
  // How far the words and price reached up over the picture's edge — kept.
  const tuck = foot.length > 0 ? Math.max(0, s2 - Math.min(...foot.map((layer) => layer[a1]))) : 0;
  let end = s2 + (long - 1);
  if (tall && foot.length > 1) {
    for (const g of [GROW_MAX, 1]) {
      const height = foot.reduce((sum, layer) => sum + (layer[a2] - layer[a1]) * g, 0);
      const start = long - height;
      if (start + tuck - s1 < s2 - s1) continue;
      let cursor = start;
      for (const layer of foot) {
        const box = span(layer);
        const h = (box.a2 - box.a1) * g;
        const artwork = Boolean(layer.bg_image_url?.signed);
        // Words take the whole width; a disc grows about its centre and stays inside the cell.
        const half = ((box.b2 - box.b1) * g) / 2;
        const c = Math.min(Math.max((box.b1 + box.b2) / 2, half), 1 - half);
        placed.set(String(layer.id), {
          a1: cursor, a2: cursor + h,
          b1: artwork ? c - half : Math.min(0, box.b1), b2: artwork ? c + half : Math.max(1, box.b2),
        });
        if (g !== 1) grow.set(String(layer.id), g);
        cursor += h;
      }
      end = start + tuck;
      break;
    }
  }
  const along = (v: number) => (v <= s1 ? v
    : v <= s2 ? s1 + ((v - s1) * (end - s1)) / (s2 - s1)
      : v <= 1 ? end + ((v - s2) * (long - end)) / Math.max(1e-6, 1 - s2)
        : v + long - 1);
  for (const layer of own) {
    const id = String(layer.id);
    if (placed.has(id)) continue;
    const box = span(layer);
    if (spans(layer)) { placed.set(id, { ...box, a1: along(box.a1), a2: along(box.a2) }); continue; }
    // Kept its size, its centre carried to where that point of the design now stands.
    const shift = along(centre(box)) - centre(box);
    placed.set(id, { ...box, a1: box.a1 + shift, a2: box.a2 + shift });
  }
  // A tied box follows its own: the same move and growth, from the same corner.
  const follow = (layer: DesignLayer, seen = new Set<string>()): Span => {
    const id = String(layer.id);
    const done = placed.get(id);
    if (done) return done;
    const parentId = parentOf(layer);
    const parent = parentId ? layers.find((l) => String(l.id) === parentId) : undefined;
    if (!parent || seen.has(id)) return span(layer);
    seen.add(id);
    const from = span(parent);
    const to = follow(parent, seen);
    const ka = (to.a2 - to.a1) / Math.max(1e-6, from.a2 - from.a1);
    const kb = (to.b2 - to.b1) / Math.max(1e-6, from.b2 - from.b1);
    const box = span(layer);
    const result = {
      a1: to.a1 + (box.a1 - from.a1) * ka, a2: to.a1 + (box.a2 - from.a1) * ka,
      b1: to.b1 + (box.b1 - from.b1) * kb, b2: to.b1 + (box.b2 - from.b1) * kb,
    };
    placed.set(id, result);
    const g = grow.get(parentId!);
    if (g) grow.set(id, g);
    return result;
  };
  const out = layers.map((layer) => {
    const box = follow(layer);
    return { ...layer, [a1]: box.a1 / long, [a2]: box.a2 / long, [b1]: box.b1, [b2]: box.b2 };
  });
  return { layers: out, grow };
}

/*
 * The editor's names for what a layer draws — see `TILE_PARTS`. Without
 * them the studio finds nothing under the pointer in a designed tile:
 * no part to pick, no words to double-click and rewrite.
 */
const LAYER_PART: Record<string, string> = {
  offer_image: 'media',
  offer_price: 'price',
  offer_savings: 'price',
  offer_relative_savings: 'price',
  offer_membership_price: 'price',
  offer_membership_savings: 'price',
  offer_membership_relative_savings: 'price',
  offer_logos: 'marks',
};

/** A paragraph that prints the offer's name or description is that part; its full, untruncated words go in `data-text`. */
function paragraphPart(liquid: string): 'name' | 'description' | null {
  if (/\{\{\s*offerName\b/.test(liquid)) return 'name';
  if (/\{\{\s*offerDescription\b/.test(liquid)) return 'description';
  return null;
}

/**
 * Columns for a block of `count` products in a box `ratio` wide per unit
 * of height: whichever count gives each (roughly square) product the
 * most room. Six in a wide band is three by two, in a tall one two by
 * three — a fixed column count spends one dimension and wastes the other.
 */
export function packColumns(count: number, ratio: number): number {
  let best = { cols: 1, size: 0, gaps: count };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const size = Math.min(ratio / cols, 1 / rows);
    const gaps = cols * rows - count;
    /* A tie goes to the fuller block (5+1 is a row with a straggler),
       then the wider one: 3+2 reads as a group, 2+2+1 as a list. */
    const tie = Math.abs(size - best.size) < 1e-9;
    if (size > best.size + 1e-9 || (tie && gaps <= best.gaps)) best = { cols, size, gaps };
  }
  return best.cols;
}

export function DesignTile({ design, offer, aspect, overrides, cell, selected, onSelect, because }: DesignTileProps) {
  /*
   * Where the editor moved, sized or took off a part — the same record
   * the chain's own tiles read (`partOverride`). The artwork pans inside
   * its box, in fifths of it, as `OfferTile`'s does; every other part is
   * offset in page percent, turned into this tile's own container units.
   */
  const moved = (part: TilePart): CSSProperties | null => {
    if (!overrides) return null;
    const o = partOverride(overrides, part);
    if (o.offsetX === 0 && o.offsetY === 0 && o.scale === 1) return null;
    if (part === 'media') {
      return { transform: `translate(${o.offsetX * 20}%, ${o.offsetY * 20}%) scale(${o.scale})` };
    }
    const w = cell?.w || 1;
    const h = cell?.h || 1;
    return {
      transform: `translate(${(o.offsetX / w).toFixed(3)}cqw, ${(o.offsetY / h).toFixed(3)}cqh) scale(${o.scale})`,
      transformOrigin: part === 'price' ? 'center' : 'left top',
    };
  };
  const hidden = (part: string | null | undefined): boolean =>
    Boolean(part && overrides && part !== 'media' && partOverride(overrides, part as TilePart).hidden);
  const vars = incitoVars(offer, {
    name: overrides?.displayName ?? null,
    description: overrides?.description ?? null,
  });
  const byId = new Map(design.layers.map((layer) => [String(layer.id), layer]));
  const hasImageBox = design.layers.some((layer) => layer.type === 'offer_image' && !layer.is_hidden);
  vars['__photoAsBackground'] = !hasImageBox && offer.imageKind === 'lifestyle' && Boolean(offer.imageUrl);
  /*
   * A parent groups its children; it does not decide for them. The price
   * sits under the saving in several of SuperBrugsen's designs, and an
   * offer with no saving still has a price. Only a parent switched off in
   * the design takes its children with it.
   */
  const switchedOff = (layer: DesignLayer, seen = new Set<string>()): boolean => {
    if (layer.is_hidden) return true;
    // CMS exports can link parents in a ring (a copied layer whose parent is its own child).
    if (seen.has(String(layer.id))) return false;
    seen.add(String(layer.id));
    const parent = layer.parent_id !== null && layer.parent_id !== undefined ? byId.get(String(layer.parent_id)) : undefined;
    return parent ? switchedOff(parent, seen) : false;
  };
  const visible = (layer: DesignLayer): boolean => !switchedOff(layer) && shows(layer, offer, vars);

  // First in the list is on top, as the CMS lists them.
  const layersBefore = [...design.layers].reverse().filter(visible);
  const shaped = reshape(layersBefore, aspect);
  const layers = shaped.layers.map((layer) => fitted(layer, aspect));

  const content = (layer: DesignLayer): ReactNode => {
    const raw = { w: layer.x2 - layer.x1, h: (layer.y2 - layer.y1) / aspect };
    /*
     * A box whose artwork is fitted in (`contain`) — the price disc — is
     * only as wide as the artwork: the chain's discs are round, so in a
     * wide box the words must fit the disc's width, not the box's.
     */
    const box = layer.bg_image_url?.signed && layer.bg_image_size !== 'cover'
      ? { w: Math.min(raw.w, raw.h), h: Math.min(raw.w, raw.h) }
      : raw;
    if (layer.type === 'offer_image' && offer.imageUrl) {
      const pack = offer.imagePack.length > 1 ? offer.imagePack : [offer.imageUrl];
      /*
       * The same arrangements `OfferTile` varies between — row, stagger,
       * block, fan — drawn from the offer's id, or the one written onto
       * the placement. Always a row made every cluster on a CMS page
       * stand in the same queue.
       */
      const shape = pack.length > 1 ? overrides?.arrangement ?? packStyle(offer.id, pack.length, 'standard') : 'row';
      const cols = shape === 'grid' ? packColumns(pack.length, raw.w / raw.h) : pack.length;
      const rows = Math.ceil(pack.length / cols);
      // As on `OfferTile`: one photograph takes the whole adjustment, a cluster's wrapper all but crop and mask.
      const whole = adjustment(pack.length > 1 && overrides?.adjust
        ? { ...overrides.adjust, crop: undefined, mask: undefined }
        : pack.length > 1 ? overrides?.adjust : undefined);
      return (
        <div
          className={`dtile__pack dtile__pack--${shape}`}
          data-count={pack.length}
          style={{ ...whole.style, ...(moved('media') ?? {}), '--cols': cols, '--rows': rows } as CSSProperties}
        >
          {whole.defs}
          {pack.map((url, index) => {
            /*
             * Each product addressable and movable, as on `OfferTile`:
             * `data-pack` is what "Stil varerne pænt op" measures and
             * what a drag hit-tests, and the corrections are page
             * percent — turned into this tile's own units by the cell's
             * share of the page, as `moved` does for the other parts.
             */
            const item = overrides ? packOverride(overrides, index) : null;
            if (item?.hidden) return null;
            const shifted = item && (item.offsetX !== 0 || item.offsetY !== 0 || item.scale !== 1 || item.rotate !== 0);
            const own = adjustment(pack.length === 1 ? overrides?.adjust : item?.adjust);
            return (
              <Fragment key={`${url}-${index}`}>
              <img
                {...own.attrs}
                key={`${url}-${index}`}
                src={url}
                alt={index === 0 ? offer.name : ''}
                draggable={false}
                data-part="media"
                data-pack={index}
                style={{
                  ...own.style,
                  ...(own.skew ? { transform: own.skew } : {}),
                  // In a block the front row covers the one behind it.
                  zIndex: shape === 'grid' && !item?.depth
                    ? 4 + Math.floor(index / cols)
                    : packStack(pack.length, index, item?.depth ?? 0),
                  ...(shape === 'grid' ? { '--row': Math.floor(index / cols), '--odd': (index % cols) % 2 } : {}),
                  ...(shifted ? {
                    translate: `${(item.offsetX / (cell?.w || 1)).toFixed(3)}cqw ${(item.offsetY / (cell?.h || 1)).toFixed(3)}cqh`,
                    scale: String(item.scale),
                    rotate: `${item.rotate}deg`,
                  } : {}),
                }}
              />
              {own.defs}
              </Fragment>
            );
          })}
        </div>
      );
    }
    if (layer.type === 'offer_bg_image' && vars['__photoAsBackground'] && offer.imageUrl) {
      const own = adjustment(overrides?.adjust);
      return (
        <>
          <img className="dtile__cover" src={offer.imageUrl} alt={offer.name} draggable={false} {...own.attrs} style={own.skew ? { ...own.style, transform: own.skew } : own.style} />
          {own.defs}
        </>
      );
    }
    if (layer.type === 'offer_logos') {
      return offer.labels.filter((label) => label.image).slice(0, 4).map((label) => (
        <img key={label.text} className="dtile__logo" src={label.image!} alt={label.text} title={label.text} draggable={false} />
      ));
    }
    const said = layer.paragraphs
      .filter((p) => !p.is_hidden)
      .map((p) => ({ p, text: renderLiquid(p.text_content, vars) }))
      .filter((entry) => entry.text !== '');
    return said.map(({ p, text }) => {
      const part = paragraphPart(p.text_content);
      if (hidden(part)) return null;
      return (
        <div
          key={p.id}
          className="dtile__p"
          style={{ ...paragraphStyle(p, layer, text, box, said.length - 1, Math.min(1, 1 / aspect), shaped.grow.get(String(layer.id)) ?? 1), ...(part ? moved(part) : null) }}
          {...(part ? { 'data-part': part, 'data-text': String(vars[part === 'name' ? 'offerName' : 'offerDescription'] ?? '') } : {})}
        >
          {setsPrice(p.incito_price) ? <PriceMark text={text} style={p.incito_price!} /> : text}
        </div>
      );
    });
  };

  return (
    <div
      className={`dtile${selected ? ' is-selected' : ''}${shaped.layers !== layersBefore && aspect < 1 ? ' dtile--tall' : ''}`}
      data-offer-id={offer.id}
      data-design-id={design.id}
      title={because ? `${design.tag} — ${because}` : design.tag}
      onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(offer.id); } : undefined}
    >
      {layers.filter((layer) => !hidden(LAYER_PART[layer.type ?? ''])).map((layer) => {
        const part = LAYER_PART[layer.type ?? ''] as TilePart | undefined;
        // A moved line may leave its box; the box must not crop it.
        const lets = layer.paragraphs.some((p) => {
          const own = paragraphPart(p.text_content);
          return own !== null && moved(own) !== null;
        });
        return (
        <div
          key={String(layer.id)}
          className={`dtile__layer dtile__layer--${(layer.type ?? 'group').replace('offer_', '')}`}
          {...(LAYER_PART[layer.type ?? ''] ? { 'data-part': LAYER_PART[layer.type ?? ''] } : {})}
          style={{
            left: `${layer.x1 * 100}%`,
            top: `${layer.y1 * 100}%`,
            width: `${(layer.x2 - layer.x1) * 100}%`,
            height: `${(layer.y2 - layer.y1) * 100}%`,
            // `safe`: text that does not fit overflows at the bottom, so the name at the top is never the part cut.
            justifyContent: `safe ${FLEX[layer.flex_justify_content ?? ''] ?? 'flex-start'}`,
            alignItems: FLEX[layer.flex_align_items ?? ''] ?? 'stretch',
            padding: boxShorthand(layer.padding ?? null),
            opacity: layer.opacity !== undefined ? layer.opacity / 100 : undefined,
            transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
            ...layerBackground(layer),
            ...(lets ? { overflow: 'visible' } : {}),
            ...(part && part !== 'media' ? moved(part) : null),
          }}
        >
          {content(layer)}
        </div>
        );
      })}
    </div>
  );
}
