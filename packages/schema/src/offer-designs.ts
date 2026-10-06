import { z } from 'zod';
import type { Offer } from './offer.js';

/**
 * Offer designs — the chain's own, in the chain's own format.
 *
 * This is Tjek's incito offer design as the CMS holds it (Design
 * templates → Offers → Copy to clipboard), validated and stored as it is.
 * A design is a CELL: fixed boxes, as fractions of the cell, each of one
 * type — the offer's image, its price, its saving, its text, its logos,
 * one of its labels — with Liquid paragraphs saying what is written in
 * it. The positions belong to the design. The offer only fills the
 * boxes; nothing is placed by looking at a photograph.
 *
 * Which design an offer gets is decided before anything is drawn:
 *
 *   1. the TAG — the page's ("Rød, sort, hvid"), or the one a chain rule
 *      names for this offer ("har ikke billede → … Uden billede");
 *   2. the OFFER TYPE — a design with `offer_type` is only for offers of
 *      that type (member price, relative saving …), and wins for them;
 *   3. the PRIORITY — A offers (the page's lead cells) take `a` designs;
 *   4. the TURN — designs left with the same tag are used evenly.
 *
 * Kept in the CMS format on purpose: a design copied out of the CMS works
 * here unchanged, and one edited here can be pasted back.
 */

export const LAYER_TYPES = [
  'offer_image', 'offer_bg_image', 'offer_text', 'offer_price', 'offer_savings',
  'offer_membership_price', 'offer_membership_savings', 'offer_membership_relative_savings',
  'offer_relative_savings', 'offer_logos', 'offer_energy_class',
  'offer_custom_label_1', 'offer_custom_label_2', 'offer_custom_label_3',
  'offer_comment_label_1', 'offer_comment_label_2', 'offer_comment_label_3',
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const OFFER_TYPES = [
  'regular_price', 'regular_price_with_savings', 'membership_price', 'membership_price_with_savings',
  'membership_relative_savings', 'relative_savings', 'app_price', 'from_price', 'get_x_for_y',
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

const num = z.number().finite();
const str = z.string().nullable().optional();

/**
 * How a price mark is drawn, past what the CMS can say: the øre and the
 * ",-" raised and smaller beside the kroner, as a printed price mark sets
 * them. Studio-only (`incito_` keys are taken off before a design is
 * copied back to the CMS); absent, the price is plain text, as in the CMS.
 */
export const PriceStyle = z.object({
  /** "inline": 45,- as text. "raised": the part after the kroner smaller and lifted. */
  minor: z.enum(['inline', 'raised']).default('inline'),
  /** The raised part's size, in percent of the kroner. */
  minorSize: z.number().min(20).max(100).default(50),
  /** How far it is lifted, in percent of the kroner's height. */
  minorRaise: z.number().min(0).max(80).default(35),
  /** Between kroner and øre: "," as printed, "." or nothing at all (19⁹⁵). */
  separator: z.enum([',', '.', '']).default(','),
  /** 400, 700, 900 — heavier than the CMS's "bold" when a chain's marks are black. */
  weight: z.number().min(100).max(900).nullable().default(null),
  /** A CSS font family for the price alone; null: the paragraph's own (heading or body). */
  font: z.string().max(120).nullable().default(null),
}).partial();
export type PriceStyle = z.infer<typeof PriceStyle>;

export const DesignParagraph = z.object({
  id: z.string(),
  text_content: z.string().default(''),
  text_level: z.string().optional(),
  text_size: num.nullable().optional(),
  text_max_size: num.nullable().optional(),
  text_max_lines: num.nullable().optional(),
  text_align: str,
  text_color: str,
  text_color_level: str,
  text_weight: str,
  text_transform: str,
  text_line_height: num.nullable().optional(),
  text_letter_spacing: num.nullable().optional(),
  width: str,
  margin: str,
  padding: z.union([z.string(), num]).nullable().optional(),
  is_hidden: z.boolean().optional(),
  incito_price: PriceStyle.optional(),
}).passthrough();
export type DesignParagraph = z.infer<typeof DesignParagraph>;

export const DesignLayer = z.object({
  id: z.union([z.number(), z.string()]),
  parent_id: z.union([z.number(), z.string()]).nullable().optional(),
  name: str,
  /** Absent on a group: a box that holds others, a gradient, a shape. */
  type: z.string().optional(),
  x1: num, y1: num, x2: num, y2: num,
  rotate: num.optional(),
  opacity: num.optional(),
  is_hidden: z.boolean().optional(),
  bg_color: str,
  bg_image_url: z.object({ signed: z.string().optional(), unsigned: z.string().optional() }).nullable().optional(),
  bg_image_size: str,
  bg_image_position: str,
  border_radius: z.union([z.string(), num]).nullable().optional(),
  border_color: str,
  padding: z.union([z.string(), num]).nullable().optional(),
  primary_color: str,
  secondary_color: str,
  gradient_color: z.array(z.object({ color: z.string(), percent: num })).nullable().optional(),
  gradient_color_angle: num.nullable().optional(),
  flexy: str,
  flex_wrap: str,
  flex_align_items: str,
  flex_justify_content: str,
  paragraphs: z.array(DesignParagraph).default([]),
}).passthrough();
export type DesignLayer = z.infer<typeof DesignLayer>;

export const OfferDesign = z.object({
  id: z.string().min(1),
  /** The design's name and its group: designs with the same tag take turns. */
  tag: z.string().min(1),
  type: z.literal('offer').default('offer'),
  /** "a": used for A offers — a page's lead. "b" or absent: the rest. */
  offer_priority: z.enum(['a', 'b']).nullable().optional(),
  /** Only used for offers of this type. */
  offer_type: z.enum(OFFER_TYPES).nullable().optional(),
  /** First is on top, as the CMS lists them. */
  layers: z.array(DesignLayer),
}).passthrough();
export type OfferDesign = z.infer<typeof OfferDesign>;

export const OfferDesigns = z.array(OfferDesign).max(400);

/**
 * Read what the CMS puts on the clipboard — `incito_designs:[…]` — or a
 * bare array, or `{ incito_designs: [...] }`. Section designs in the same
 * export are skipped: a page is laid out by the chain's grid here.
 */
export function readIncitoDesigns(text: string): { designs: OfferDesign[]; skipped: number } {
  const trimmed = text.trim();
  const json = trimmed.startsWith('incito_designs:') ? trimmed.slice('incito_designs:'.length) : trimmed;
  const parsed: unknown = JSON.parse(json);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { incito_designs?: unknown[] })?.incito_designs ?? [];
  const designs: OfferDesign[] = [];
  let skipped = 0;
  for (const entry of list) {
    if ((entry as { type?: string })?.type !== 'offer') { skipped += 1; continue; }
    const design = OfferDesign.safeParse(entry);
    if (design.success) designs.push(design.data);
    else skipped += 1;
  }
  return { designs, skipped };
}

/**
 * A chain's shipped design file (`data/designs/<brand>-cms.json`): the
 * CMS export plus the tag pages start in and the rules it starts with.
 */
export function readDesignExport(text: string): { designs: OfferDesign[]; tag: string | null; rules: unknown[] } {
  const { designs } = readIncitoDesigns(text);
  const meta = JSON.parse(text.trim().startsWith('incito_designs:') ? '{}' : text) as { defaultTag?: string; defaultRules?: unknown[] };
  return {
    designs,
    tag: meta.defaultTag ?? designs[0]?.tag ?? null,
    rules: Array.isArray(meta.defaultRules) ? meta.defaultRules : [],
  };
}

/** The tags a set of designs offers, in first-seen order. */
export function designTags(designs: readonly OfferDesign[]): string[] {
  return [...new Set(designs.map((d) => d.tag))];
}

/* --------------------------------------------------------- the offer */

/** What kind of price an offer is, in the CMS's own words. */
export function offerTypesOf(offer: Offer): Set<OfferType> {
  const types = new Set<OfferType>();
  const saving = (offer.savings ?? 0) > 0 || (offer.prePrice !== null && offer.prePrice > offer.price);
  const relative = (offer.savingsPercent ?? 0) > 0;
  if (offer.memberPrice !== null) {
    types.add('membership_price');
    if (saving || offer.memberPrice < offer.price) types.add('membership_price_with_savings');
    if (relative || offer.memberPrice < offer.price) types.add('membership_relative_savings');
  } else {
    types.add('regular_price');
    if (saving) types.add('regular_price_with_savings');
    if (relative) types.add('relative_savings');
  }
  if (offer.priceFrom) types.add('from_price');
  // "2 for 30", "Køb 3 betal for 2" — Wolt draws these in their own design.
  if (offer.labels.some((label) => label.kind === 'multibuy')) types.add('get_x_for_y');
  return types;
}

export interface DesignChoice {
  design: OfferDesign;
  /** Why this one — shown when somebody asks "why does it look like this?". */
  because: string;
}

/**
 * The design for one offer in one cell. Pure and total: given designs,
 * a tag, the offer, whether it is an A offer and its turn among offers
 * of the same tag, it always answers the same — or null when the tag has
 * no design at all.
 */
export function chooseDesign(
  designs: readonly OfferDesign[],
  tag: string,
  offer: Offer,
  options: { a: boolean; turn: number },
): DesignChoice | null {
  const pool = designs.filter((d) => d.tag === tag);
  if (pool.length === 0) return null;
  const types = offerTypesOf(offer);
  const typed = pool.filter((d) => d.offer_type && types.has(d.offer_type));
  const untyped = pool.filter((d) => !d.offer_type);
  const byType = typed.length > 0 ? typed : untyped.length > 0 ? untyped : pool;
  const wanted = options.a ? 'a' : 'b';
  const prioritised = byType.filter((d) => (d.offer_priority ?? 'b') === wanted);
  const candidates = prioritised.length > 0 ? prioritised : byType;
  const design = candidates[((options.turn % candidates.length) + candidates.length) % candidates.length]!;
  const why = [
    `«${tag}»`,
    typed.length > 0 ? `for ${design.offer_type}` : '',
    prioritised.length > 0 ? (options.a ? 'A-vare' : 'B-vare') : '',
    candidates.length > 1 ? `${(options.turn % candidates.length) + 1} af ${candidates.length} på skift` : '',
  ].filter(Boolean).join(' · ');
  return { design, because: why };
}

/* ------------------------------------------------------ offer grid */

/**
 * Layouts shaped like incito's Offer Grid.
 *
 * In the CMS a section holds a grid box and a maximum count; the cells
 * are worked out from the box: as many columns as make the cells closest
 * to square, rows as needed, and a short last row spread across the
 * width ("a lone last offer spans the row"). SuperBrugsen's "Stærk pris"
 * is one such grid of up to six under the heading. The `lead` variants
 * put one A offer in a grid of its own on top, as the chain's hero
 * sections do. The offer designs are drawn for cells near square, so
 * these are the cells they look right in.
 *
 * Expressed as ordinary CSS-grid templates, so everything that already
 * works on a page — the heading, margins, swapping, the layout picker —
 * works on these too.
 */
export const OFFER_GRID_PREFIX = 'cms/';

/** Content box of a portrait A4 page under the heading, width over height. */
const CONTENT_ASPECT = 0.83;
const LETTERS = 'abcdefghijklmnop';

function columnsFor(count: number): number {
  let best = 1;
  let score = Infinity;
  for (let columns = 1; columns <= Math.min(count, 4); columns += 1) {
    const rows = Math.ceil(count / columns);
    const aspect = CONTENT_ASPECT * (rows / columns);
    // Slightly wide beats slightly tall: the price disc and the words sit side by side.
    const off = Math.abs(Math.log(aspect / 1.08));
    if (off < score - 1e-9) { score = off; best = columns; }
  }
  return best;
}

/** Rows of grid-area names for `count` cells named from `names`, a short last row spanning. */
function gridRows(names: string[]): string[][] {
  const count = names.length;
  const columns = columnsFor(count);
  const rows = Math.ceil(count / columns);
  const last = count - columns * (rows - 1);
  // Sub-columns every row divides evenly: a multiple of both the full and the last row.
  const width = last === columns ? columns : columns * last;
  const out: string[][] = [];
  let at = 0;
  for (let row = 0; row < rows; row += 1) {
    const inRow = row === rows - 1 ? last : columns;
    const span = width / inRow;
    const line: string[] = [];
    for (let cell = 0; cell < inRow; cell += 1) for (let s = 0; s < span; s += 1) line.push(names[at + cell]!);
    at += inRow;
    out.push(line);
  }
  return out;
}

function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}

export function offerGridTemplates(min = 2, max = 8): PageTemplateLike[] {
  const templates: PageTemplateLike[] = [];
  for (let count = min; count <= max; count += 1) {
    const names = [...LETTERS.slice(0, count)];
    const rows = gridRows(names);
    templates.push({
      id: `${OFFER_GRID_PREFIX}grid-${count}`,
      name: `Tilbudsgitter · ${count}`,
      areas: rows.map((row) => row.join(' ')),
      slots: names.map((id) => ({ id, role: count <= 2 ? 'hero' as const : 'standard' as const, bleed: 1 })),
    });
  }
  for (let count = Math.max(3, min); count <= max; count += 1) {
    const rest = gridRows([...LETTERS.slice(0, count - 1)]);
    const width = lcm(rest[0]!.length, 1);
    const leadRows = Math.max(1, Math.round(rest.length * 0.7));
    const areas = [
      ...Array.from({ length: leadRows }, () => Array.from({ length: width }, () => 'hero').join(' ')),
      ...rest.map((row) => row.join(' ')),
    ];
    templates.push({
      id: `${OFFER_GRID_PREFIX}lead-${count}`,
      name: `A-vare øverst og ${count - 1} under`,
      areas,
      slots: [
        { id: 'hero', role: 'hero' as const, bleed: 1 },
        ...[...LETTERS.slice(0, count - 1)].map((id) => ({ id, role: 'standard' as const, bleed: 1 })),
      ],
    });
  }
  return templates;
}

/** The shape `PageTemplate` parses from — kept structural so this file needs no template import. */
export interface PageTemplateLike {
  id: string;
  name: string;
  areas: string[];
  slots: { id: string; role: 'hero' | 'feature' | 'standard' | 'compact'; bleed: number }[];
}

/**
 * A chain with offer designs, with the offer-grid layouts it needs —
 * first, so a new page prefers them — and its own kept for the pages
 * already laid out on them.
 */
export function withOfferGrids<B extends { offerDesigns: OfferDesign[]; templates: unknown[] }>(brand: B): B {
  if (brand.offerDesigns.length === 0) return brand;
  const have = new Set((brand.templates as { id: string }[]).map((t) => t.id));
  const grids = offerGridTemplates().filter((t) => !have.has(t.id));
  return { ...brand, templates: [...grids, ...brand.templates] };
}

/* ------------------------------------------- cells for offer designs */

export interface CellRect { x: number; y: number; w: number; h: number }

/**
 * Boxes measured off a printed page, made into cells an offer design can
 * be drawn in.
 *
 * A printed page's boxes overlap — a hero measured 105 % of the page wide,
 * a lead running into the row under it, artwork bleeding past the edge.
 * The chain's own tiles were drawn for that; an offer design is not: it
 * fills its cell edge to edge, so an overlap puts one offer's picture on
 * another's words. Here every box is kept inside the paper's margin, kept
 * clear of the page's own artwork (the masthead), and two boxes that
 * overlap are split at the middle of their overlap, a gutter apart.
 * Boxes are sheet fractions, as `TemplateSlot.rect`; `aspect` is the
 * sheet's width over height, so a gutter is the same in both directions.
 */
export function designCells(
  rects: Record<string, CellRect>,
  obstacles: CellRect[] = [],
  aspect = 0.707,
  { margin = 0.03, gutter = 0.014 } = {},
): Record<string, CellRect> {
  const gy = gutter * aspect;
  const my = margin * aspect;
  const box = Object.fromEntries(Object.entries(rects).map(([id, r]) => {
    const x1 = Math.max(margin, r.x);
    const x2 = Math.min(1 - margin, r.x + r.w);
    const y1 = Math.max(my, r.y);
    const y2 = Math.min(1 - my, r.y + r.h);
    return [id, { x1, x2, y1, y2 }];
  })) as Record<string, { x1: number; x2: number; y1: number; y2: number }>;

  /*
   * Clear of the page's artwork, by giving up whichever edge costs the
   * cell least: the top under a masthead, a side beside a picture that
   * runs down the page. Always pushing down squashed a lead beside a
   * tall picture to a sliver. A cell that would keep under 60 % of
   * itself stays as it is and the artwork stands behind it.
   */
  for (const cell of Object.values(box)) {
    for (const o of obstacles) {
      const ox1 = Math.max(cell.x1, o.x);
      const ox2 = Math.min(cell.x2, o.x + o.w);
      const oy1 = Math.max(cell.y1, o.y);
      const oy2 = Math.min(cell.y2, o.y + o.h);
      if (ox2 <= ox1 || oy2 <= oy1) continue;
      const w = cell.x2 - cell.x1;
      const h = cell.y2 - cell.y1;
      const trims: { keep: number; apply: () => void }[] = [];
      if (o.y <= cell.y1 + h / 2) trims.push({ keep: (cell.y2 - (oy2 + gy)) / h, apply: () => { cell.y1 = oy2 + gy; } });
      if (o.x <= cell.x1 + w / 2) trims.push({ keep: (cell.x2 - (ox2 + gutter)) / w, apply: () => { cell.x1 = ox2 + gutter; } });
      if (o.x + o.w >= cell.x2 - w / 2) trims.push({ keep: ((ox1 - gutter) - cell.x1) / w, apply: () => { cell.x2 = ox1 - gutter; } });
      const best = trims.sort((p, q) => q.keep - p.keep)[0];
      if (best && best.keep >= 0.6) best.apply();
    }
  }

  const ids = Object.keys(box);
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = box[ids[i]!]!;
        const b = box[ids[j]!]!;
        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        // Apart by at least a gutter in either direction: nothing to do.
        if (ox <= -gutter || oy <= -gy) continue;
        // Split along the direction they overlap least — stacked boxes in y, neighbours in x.
        if (oy * (1 / aspect) <= ox) {
          const [top, low] = a.y1 <= b.y1 ? [a, b] : [b, a];
          const mid = (Math.max(top.y1, low.y1) + Math.min(top.y2, low.y2)) / 2;
          top.y2 = Math.min(top.y2, mid - gy / 2);
          low.y1 = Math.max(low.y1, mid + gy / 2);
        } else {
          const [left, right] = a.x1 <= b.x1 ? [a, b] : [b, a];
          const mid = (Math.max(left.x1, right.x1) + Math.min(left.x2, right.x2)) / 2;
          left.x2 = Math.min(left.x2, mid - gutter / 2);
          right.x1 = Math.max(right.x1, mid + gutter / 2);
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(box).map(([id, c]) => [id, {
    x: c.x1, y: c.y1, w: Math.max(0.05, c.x2 - c.x1), h: Math.max(0.05, c.y2 - c.y1),
  }]));
}

/** A design as the CMS takes it back: the studio's own `incito_` keys off every paragraph. */
export function forCms(designs: readonly OfferDesign[]): OfferDesign[] {
  return designs.map((design) => ({
    ...design,
    layers: design.layers.map((layer) => ({
      ...layer,
      paragraphs: layer.paragraphs.map((p) => Object.fromEntries(Object.entries(p).filter(([key]) => !key.startsWith('incito_'))) as DesignParagraph),
    })),
  }));
}
