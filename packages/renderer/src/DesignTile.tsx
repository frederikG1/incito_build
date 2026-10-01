import type { CSSProperties, ReactNode } from 'react';
import { packOverride, packStack, partOverride, type DesignLayer, type DesignParagraph, type Offer, type OfferDesign, type PlacementOverrides, type TilePart } from '@incitio/schema';
import { incitoVars, renderLiquid } from './liquid.js';

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

function paragraphStyle(p: DesignParagraph, layer: DesignLayer, text: string, box: { w: number; h: number }, others = 0, side = 1): CSSProperties {
  const color = p.text_color_level === 'primary' && layer.primary_color ? layer.primary_color
    : p.text_color_level === 'secondary' && layer.secondary_color ? layer.secondary_color
      : p.text_color ?? undefined;
  /*
   * `text_max_size` is a ceiling the text shrinks under to fit its box —
   * a price of 109,95 in a disc drawn for 19,-. One line of it must fit
   * the box's width, and it may not be taller than the box.
   */
  const lines = Math.max(1, p.text_max_lines ?? 1);
  let size = p.text_size ?? p.text_max_size ?? 12;
  if (p.text_max_size) {
    const chars = Math.max(2, Math.ceil(text.length / lines));
    // Box sizes are in cell widths; sizes are in the cell's shorter side (`side` of its width).
    const byWidth = (box.w / side * DESIGN_REFERENCE_PX * 0.86) / (0.66 * chars);
    // Sharing its box with other lines — "1 stk." over the price — it may take only part of the height.
    const share = others > 0 ? 0.62 : 0.9;
    const byHeight = (box.h / side * DESIGN_REFERENCE_PX * share) / (lines * (p.text_line_height ?? 1.15));
    size = Math.min(p.text_max_size, byWidth, byHeight);
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
    fontWeight: p.text_weight === 'bold' ? 700 : p.text_weight === 'normal' ? 400 : heading ? 700 : 400,
    fontFamily: heading ? 'var(--heading-font)' : 'var(--body-font)',
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
  const layers = [...design.layers].reverse().filter(visible).map((layer) => fitted(layer, aspect));

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
      return (
        <div className="dtile__pack" style={moved('media') ?? undefined}>
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
            return (
              <img
                key={`${url}-${index}`}
                src={url}
                alt={index === 0 ? offer.name : ''}
                draggable={false}
                data-part="media"
                data-pack={index}
                style={{
                  zIndex: packStack(pack.length, index, item?.depth ?? 0),
                  ...(shifted ? {
                    translate: `${(item.offsetX / (cell?.w || 1)).toFixed(3)}cqw ${(item.offsetY / (cell?.h || 1)).toFixed(3)}cqh`,
                    scale: String(item.scale),
                    rotate: `${item.rotate}deg`,
                  } : {}),
                }}
              />
            );
          })}
        </div>
      );
    }
    if (layer.type === 'offer_bg_image' && vars['__photoAsBackground'] && offer.imageUrl) {
      return <img className="dtile__cover" src={offer.imageUrl} alt={offer.name} draggable={false} />;
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
          style={{ ...paragraphStyle(p, layer, text, box, said.length - 1, Math.min(1, 1 / aspect)), ...(part ? moved(part) : null) }}
          {...(part ? { 'data-part': part, 'data-text': String(vars[part === 'name' ? 'offerName' : 'offerDescription'] ?? '') } : {})}
        >
          {text}
        </div>
      );
    });
  };

  return (
    <div
      className={`dtile${selected ? ' is-selected' : ''}`}
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
