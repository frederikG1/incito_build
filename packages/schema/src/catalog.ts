import { z } from 'zod';
import { ImageRef, Offer } from './offer.js';
import { PageTemplate } from './template.js';

/** Where on the page a decoration is pinned. */
export const DECOR_ANCHORS = [
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
] as const;
export type DecorAnchor = (typeof DECOR_ANCHORS)[number];

/**
 * One piece of generated mood artwork.
 *
 * A printed leaflet is not only packshots. SuperBrugsen's own p01 runs a
 * plate of smørrebrød off the top-left corner behind the pålæg offers —
 * artwork that sells nothing and is not in any feed. That is what this
 * is: filler with a subject, tied to an offer so it is never merely
 * decorative wallpaper.
 *
 * It is DOCUMENT data, not brand data, and deliberately so. A chain's
 * identity may not be copied into a catalogue (see `CatalogDocument`),
 * but what this week's page depicts is exactly the sort of thing that
 * belongs to the week rather than to the chain — and it has to survive
 * being saved, reopened and printed on another machine.
 *
 * The image itself is a reference, never bytes: generation is expensive
 * and cached on disk by prompt, so a document that embedded the PNG
 * could not share that cache and would grow by a megabyte a page.
 */
export const PageDecoration = z.object({
  id: z.string().min(1),
  imageUrl: ImageRef,
  /**
   * What it depicts, in the feed's own language — "en håndfuld mandler".
   * Kept so a person can see WHY this image is on the page, and so a
   * re-run can tell "same subject, new drawing" from "new subject".
   */
  subject: z.string().default(''),
  /** The offer it was derived from, when it came from one. */
  offerId: z.string().nullable().default(null),
  anchor: z.enum(DECOR_ANCHORS),
  /**
   * Share of the PAGE's width, so the artwork scales with the sheet the
   * same way everything else does — a thumbnail and A4 are one design.
   */
  scale: z.number().min(0.05).max(0.6).default(0.26),
  /**
   * A few degrees, because a pasted-on element is the one thing on this
   * page that may sit off-square — unlike the price mark, which the
   * chains print level. See the note on `.price`.
   */
  rotate: z.number().min(-30).max(30).default(0),
  /** Held back behind the offers when it would otherwise compete. */
  opacity: z.number().min(0.05).max(1).default(1),
  /**
   * Nudged off its anchor, in PAGE percent.
   *
   * `anchor` puts a picture in one of four corners, which is where a
   * leaflet's atmosphere belongs and is enough for artwork generated to
   * sit behind the offers. It is not enough for a chain's own
   * photograph: a designer placing their own bowl of grapes wants it
   * where the page has room, not where an enum says.
   *
   * Page percent for the same reason `PartOverride` uses it — see the
   * note there. A percentage translate would resolve against the IMAGE,
   * so the same drag would move a small picture further than a large
   * one; against the page, a drag moves what the pointer covered.
   *
   * ±75, which is three quarters of the sheet in either direction.
   *
   * Wide because the point is to place a picture anywhere, and narrow
   * enough that it cannot be pushed somewhere it can never be picked up
   * again: the page clips, so a decoration dragged entirely off it
   * would be gone with no handle left to drag back. Anchored in a
   * corner and moved the full 75, a quarter of it is still on the
   * paper. The ANCHOR remains the coarse control — pick the corner,
   * then nudge — and this is the nudge.
   */
  offsetX: z.number().min(-75).max(75).default(0),
  offsetY: z.number().min(-75).max(75).default(0),
});
export type PageDecoration = z.infer<typeof PageDecoration>;

/**
 * A picture laid under the whole sheet.
 *
 * `ground` paints the page one colour; this paints it a photograph —
 * the autumn field behind a harvest spread, the wrapping paper behind
 * the Christmas pages. It is NOT a fourth decoration: a decoration is
 * pinned to a corner, is sized as a share of the page and is meant to
 * run off one edge, while this covers the sheet edge to edge and never
 * moves. Bending one into the other would give `anchor` and `scale` a
 * meaning they do not have here.
 *
 * Document data for the same reason a decoration is: the chain's
 * identity may not be copied into a catalogue, but what this week's
 * page is printed on top of belongs to the week.
 *
 * A reference, never bytes — see `PageDecoration`. The file is uploaded
 * once and lives under the same `/uploads` tree, which is what the PDF
 * run resolves against.
 */
export const PageBackground = z.object({
  imageUrl: ImageRef,
  /** What the file was called, so the editor can say which picture it is. */
  subject: z.string().default(''),
  /**
   * How it meets the sheet.
   *
   * `cover` crops to fill, which is what a photograph wants; `contain`
   * fits the whole picture, which is what a drawn panel or a printed
   * spread scanned in one piece wants; `tile` repeats it, which is what
   * a pattern wants. Three answers because a background is the one
   * element whose source could be any of those three things.
   */
  fit: z.enum(['cover', 'contain', 'tile']).default('cover'),
  /**
   * Held back so the offers stay readable.
   *
   * Defaults to 1 rather than to something faded: a photograph the
   * editor chose deliberately should arrive as they chose it, and the
   * slider is there for the one that turns out to fight the prices.
   */
  opacity: z.number().min(0.05).max(1).default(1),
  /**
   * Which part of the picture survives the crop, in per cent.
   *
   * Only read for `cover`, where the sheet's aspect and the
   * photograph's rarely agree and something is always cut away. 50/50
   * is the centre, which is right until the thing worth keeping is the
   * sky or the plate at the bottom.
   */
  focusX: z.number().min(0).max(100).default(50),
  focusY: z.number().min(0).max(100).default(50),
});
export type PageBackground = z.infer<typeof PageBackground>;

/**
 * The lines a page prints above its grid.
 *
 * The same idea as `TILE_PARTS`, one level up: a heading and the theme
 * line under it are boxes a person can take hold of, not fixtures of
 * the masthead. Kept as their own list rather than folded into the
 * tile's, because they are addressed by PAGE and not by placement —
 * nothing on a page has to be selected for a heading to be movable.
 */
export const PAGE_PARTS = ['title', 'subtitle'] as const;
export type PagePart = (typeof PAGE_PARTS)[number];

/** What each line is called to the person moving it. */
export const PAGE_PART_NAMES: Record<PagePart, string> = {
  title: 'Overskrift',
  subtitle: 'Stemningslinje',
};

/**
 * One heading's hand-made corrections.
 *
 * `PartOverride` with a longer reach and no `text`, and both
 * differences are the point. The words live in `CatalogPage.title` and
 * `.subtitle` — they were editable before this existed and two homes
 * for one string is how an edit goes missing, which is the same rule
 * the tile's headline follows. And the reach is the PAGE rather than a
 * cell: a heading is not fenced into a grid track, and a chain that
 * prints its section name down the side of the sheet or across the
 * bottom is printing something an editor here has to be able to do.
 *
 * Offsets are page percent, spent as `cqw`/`cqh` — see `PartOverride`
 * for why that and not a percentage of the element.
 */
export const PageTextOverride = z.object({
  offsetX: z.number().min(-100).max(100).default(0),
  offsetY: z.number().min(-100).max(100).default(0),
  scale: z.number().min(0.3).max(4).default(1),
  /** Taken off the page. The line is still listed, so it can come back. */
  hidden: z.boolean().default(false),
});
export type PageTextOverride = z.infer<typeof PageTextOverride>;

/** A heading nobody has touched. */
export const PAGE_TEXT_DEFAULTS: PageTextOverride = Object.freeze(PageTextOverride.parse({}));

/** How far a heading may be moved, and in what increments. */
export function pageTextLimits(): {
  reach: number; step: number; coarse: number; minScale: number; maxScale: number;
} {
  return { reach: 100, step: 0.25, coarse: 1, minScale: 0.3, maxScale: 4 };
}

/**
 * The boxes a tile is made of.
 *
 * Every one of them is drawn by `OfferTile` and every one of them can be
 * taken hold of in the editor — the artwork stopped being the only
 * movable thing the moment someone wanted the kilo price somewhere else.
 * The order is the order they are drawn in, which is also the order the
 * inspector lists them.
 */
export const TILE_PARTS = [
  'media', 'price', 'marks', 'brand', 'name',
  'quantity', 'description', 'meta', 'tags',
] as const;
export type TilePart = (typeof TILE_PARTS)[number];

/** What each box is called to the person moving it. */
export const TILE_PART_NAMES: Record<TilePart, string> = {
  media: 'Billede',
  price: 'Pris',
  marks: 'Certifikater',
  brand: 'Mærke',
  name: 'Overskrift',
  quantity: 'Mængde',
  description: 'Underlinje',
  meta: 'Enhedspris',
  tags: 'Mærkater',
};

/**
 * One box's hand-made corrections.
 *
 * Offsets are PAGE-relative — 1 is one percent of the page's width, so
 * the renderer can spend them as `1cqw`/`1cqh` against the page's size
 * container. Normalising them to the box's own size was the first
 * attempt and it is wrong: a percentage translate resolves against the
 * element, so the same drag moved a headline four times as far as the
 * kilo price under it.
 *
 * The artwork is the exception and does not live here — see
 * `partOverride`. Its offsets are frame-relative on purpose, so a nudge
 * survives the tile changing size under it.
 */
export const PartOverride = z.object({
  offsetX: z.number().min(-25).max(25).default(0),
  offsetY: z.number().min(-25).max(25).default(0),
  scale: z.number().min(0.4).max(3).default(1),
  /** Taken off the page. The box is still listed, so it can come back. */
  hidden: z.boolean().default(false),
  /**
   * The editor's own wording for this box.
   *
   * Only for the boxes with no field of their own. The headline and the
   * supporting line keep `displayName`/`description` — they were
   * editable before this existed, they are what the inspector shows,
   * and two homes for one string is how an edit goes missing.
   */
  text: z.string().nullable().default(null),
});
export type PartOverride = z.infer<typeof PartOverride>;

/** A box nobody has touched. */
export const PART_DEFAULTS: PartOverride = Object.freeze(PartOverride.parse({}));

/**
 * Per-placement human corrections.
 *
 * These survive regeneration: the composer treats a placement carrying
 * `pinned` as fixed and lays the rest out around it. That is the
 * mechanism by which an editor's finesse is not thrown away the next
 * time the curator runs.
 */
/**
 * How several products share one cell.
 *
 * The shapes a printed leaflet actually uses when one price covers more
 * than one product, and the only four the stylesheet draws:
 *
 *   row      an overlapping line, the plainest of them
 *   stagger  neighbours ride lower and smaller, one item forward
 *   grid     a block, which is what four or more read as
 *   fan      spread like a hand of cards, for tall upright packs
 *
 * Document data rather than a rendering detail, because it is now a
 * decision somebody — or something — makes about a particular tile.
 * See `PlacementOverrides.arrangement`.
 */
export const TILE_ARRANGEMENTS = ['row', 'stagger', 'grid', 'fan'] as const;
export type TileArrangement = (typeof TILE_ARRANGEMENTS)[number];

/**
 * One product inside a cluster, moved by hand.
 *
 * A tile whose offer covers several products draws them together — a
 * row, a stagger, a block, a fan — and the arrangement decides where
 * each one sits. This is the override on top of that: the same four
 * gestures every other box answers to, applied to one photograph among
 * several.
 *
 * `rotate` exists here and on no other box for the same reason it
 * exists on a decoration: a pasted-on product is the one thing on a
 * printed page that may sit off-square, and a fanned cluster is already
 * doing it by the stylesheet's own hand.
 */
export const PackOverride = z.object({
  /** Page percent, like `PartOverride` — see `packLimits`. */
  offsetX: z.number().min(-100).max(100).default(0),
  offsetY: z.number().min(-100).max(100).default(0),
  scale: z.number().min(0.2).max(3).default(1),
  rotate: z.number().min(-45).max(45).default(0),
  /**
   * Forward or back among the products it shares a cell with.
   *
   * Zero leaves the stacking to the stylesheet, which puts the MIDDLE
   * product in front — see `OfferTile` — because a printed group has a
   * front and stacking by document order reads as a pile that fell
   * over. That is a good default and it cannot know the answer: which
   * product belongs in front is a fact about the offer, and once a
   * composition has moved every product, the default has nothing left
   * to go on at all.
   *
   * A step either way rather than an absolute layer, because the
   * question a person asks is "this one in front of that one" and
   * because the range has to stay inside the tile's own stack: the
   * words and the price mark sit above the artwork on purpose, and a
   * product that outran them would print over its own price.
   */
  depth: z.number().int().min(-4).max(4).default(0),
  /** Taken off the page. The others close up around it. */
  hidden: z.boolean().default(false),
});
export type PackOverride = z.infer<typeof PackOverride>;

export const PACK_DEFAULTS: PackOverride = Object.freeze(PackOverride.parse({}));

export const PlacementOverrides = z.object({
  pinned: z.boolean().default(false),
  /**
   * How this tile's products are grouped, when somebody decided.
   *
   * `null` leaves it to the stylesheet, which picks from the offer's own
   * id — stable between renders, varied across a page, and knowing
   * nothing about what the products are. That is the right default and a
   * poor answer for a tile an editor has just assembled by hand: six
   * upright bottles want a fan and six flat trays want a block, and the
   * difference is in the photographs, not in the id.
   */
  arrangement: z.enum(TILE_ARRANGEMENTS).nullable().default(null),
  /** Editor's own wording for the tile, replacing the feed's. */
  displayName: z.string().nullable().default(null),
  /**
   * Editor's own supporting line.
   *
   * `null` keeps the feed's description, and an empty string removes it
   * — a leaflet regularly drops a line the feed wrote for a web shop,
   * and "hide this" has to be expressible as an edit rather than only
   * as a fact about the source.
   */
  description: z.string().nullable().default(null),
  imageScale: z.number().min(0.5).max(2).default(1),
  imageOffsetX: z.number().min(-1).max(1).default(0),
  imageOffsetY: z.number().min(-1).max(1).default(0),
  /*
   * Where every other box has been put, keyed by `TilePart`.
   *
   * Sparse, and it has to be: a document carries one of these per
   * placement, and writing nine untouched boxes onto every tile would
   * quadruple a saved catalogue to say nothing at all. A key that is
   * absent means the box is where the template put it.
   *
   * Keyed by `z.string()` rather than by the enum so that reading it
   * admits `undefined` — a record typed over the enum claims all nine
   * keys are present, which is exactly the lie that would crash on a
   * document saved before this field existed.
   */
  parts: z.record(z.string(), PartOverride).default({}),
  /*
   * Where each product INSIDE a cluster has been put, keyed by its
   * position in the pack — "0", "1", "2".
   *
   * A tile that carries three variants draws three photographs, and
   * until this existed they moved as one box: the arrangement decided
   * where each sat and nothing could touch a single one of them. That
   * is the difference between a cluster a person laid out and a cluster
   * a stylesheet emitted, and it is exactly the half of a printed page
   * that is done by hand.
   *
   * Keyed by INDEX rather than by image URL. The same photograph can
   * legitimately appear twice in a pack, and an offer that swaps one
   * variant for another next week should leave the corrections where
   * they were on the page rather than orphaning them on a URL nobody
   * uses any more.
   *
   * Sparse and defaulted, like `parts` and for the same two reasons.
   */
  pack: z.record(z.string(), PackOverride).default({}),
});
export type PlacementOverrides = z.infer<typeof PlacementOverrides>;

/** One product of a cluster's corrections, with nothing left out. */
export function packOverride(overrides: PlacementOverrides, index: number): PackOverride {
  return overrides.pack[String(index)] ?? PACK_DEFAULTS;
}

/** The placement patch that writes one product of a cluster back. */
export function packPatch(
  overrides: PlacementOverrides,
  index: number,
  patch: Partial<PackOverride>,
): Partial<PlacementOverrides> {
  return {
    pack: {
      ...overrides.pack,
      [String(index)]: { ...packOverride(overrides, index), ...patch },
    },
  };
}

/**
 * How far one product of a cluster may be moved.
 *
 * Page percent, like every box but the artwork — see `partLimits` — so
 * a drag moves what the pointer covered rather than a distance that
 * depends on how big the photograph happens to be.
 *
 * The reach was 20, on the reasoning that a variant dragged a third of
 * the way across the sheet has left the offer it is part of. That is
 * true of a DRAG and false of a composition. Two things break it:
 *
 *  - A full-width lead tile is most of the sheet, so standing three
 *    products up across it moves the outer ones some forty per cent.
 *  - The stylesheet lays the products out in the pack's own order and
 *    an image model composes them in whatever order it likes. A
 *    composition that puts product three on the left and product one on
 *    the right is a perfectly good composition, and rebuilding it means
 *    the two SWAP ENDS — the full width of the cell, near sixty per
 *    cent of the sheet.
 *
 * Cut to 20, or to 45, those corrections stopped half way and the
 * products piled up in the middle: read correctly, applied correctly,
 * and silently halved by a limit meant for a slip of the hand. The
 * sheet is the only boundary that is true here, so that is the
 * number. A slip of the hand is still bounded — by the slider and the
 * drag, which is where a hand's reach belongs.
 */
export function packLimits(): {
  reach: number; step: number; coarse: number; minScale: number; maxScale: number;
  turn: number; depth: number;
} {
  return { reach: 100, step: 0.25, coarse: 1, minScale: 0.2, maxScale: 3, turn: 45, depth: 4 };
}

/**
 * Which product of a cluster paints over which, as one number.
 *
 * Three bands, so the editor's word always wins and the stylesheet
 * still has an opinion when nobody has said anything:
 *
 *   sent back    0–3   under every product the stylesheet placed
 *   the default  5–12  the MIDDLE product in front, a printed group's
 *                      own shape — stacking by document order reads as
 *                      a pile that fell over
 *   brought fore 13–16 over everything, in the order they were asked for
 *
 * All of it under the words and the price mark, which print above the
 * artwork on purpose — see `.tile__info`.
 *
 * Here rather than in the stylesheet or the tile because two places
 * need the same answer: the tile draws it, and the panel's "forrest"
 * has to know what it is beating.
 */
export function packStack(count: number, index: number, depth: number): number {
  if (depth > 0) return 12 + Math.min(depth, 4);
  if (depth < 0) return 4 + Math.max(depth, -4);
  return 4 + count - Math.abs(index - (count - 1) / 2) * 2;
}

/**
 * How many cutouts one photograph can hold.
 *
 * Two is the fewest that is a group at all. Eight is the schema's own
 * ceiling on a pack — see `Offer.imagePack` — and past it the rule this
 * prompt insists on, that every label stays readable, stops being
 * possible in one frame.
 */
export const MIN_CLUSTER = 2;
export const MAX_CLUSTER = 8;

/**
 * The varegrupper a would-be cluster spans.
 *
 * One photograph is one family of products. Six bottles of sodavand
 * compose into a group a leaflet would print; a box of detergent, a bag
 * of frozen croquettes and a loaf of rye do not — a printed page stands
 * those side by side, because they are three offers that happen to
 * share a price, not one shelf.
 *
 * The prompt cannot rescue that. It is handed a list and told to
 * arrange it, so the more unrelated things on the list the more it has
 * to invent a scene that does not exist: sizes with nothing to compare
 * against, a hero among products that are not each other's neighbours.
 * What comes back looks exactly like what it is.
 *
 * So the question is asked BEFORE anything is paid for, and it is asked
 * of the feed's own categories rather than of a model. Unnamed
 * categories are not counted: a feed that says nothing cannot be used
 * to refuse, and the count is the fallback there.
 */
export function clusterFamilies(products: { category?: string | null }[]): string[] {
  return [...new Set(
    products.map((product) => (product.category ?? '').trim()).filter(Boolean),
  )];
}

/**
 * Why these products are not one photograph — or `null` when they are.
 *
 * A sentence rather than a boolean, because every caller has to be able
 * to say WHY it skipped a tile. A person who is told "three varegrupper"
 * knows what to do about it; one who is told "skipped" does not.
 */
export function notOnePhotograph(
  products: { name: string; category?: string | null }[],
): string | null {
  if (products.length < MIN_CLUSTER) return 'for få varer til en opstilling';
  if (products.length > MAX_CLUSTER) {
    return `${products.length} varer er flere end ét fotografi kan holde`;
  }
  const families = clusterFamilies(products);
  if (families.length > 1) {
    return `${products.length} varer i ${families.length} varegrupper `
      + `(${families.join(', ')}) — det er flere tilbud, ikke én opstilling`;
  }
  return null;
}

/** Whether one product of a cluster has been moved, resized or turned. */
export function packTouched(overrides: PlacementOverrides, index: number): boolean {
  const item = packOverride(overrides, index);
  return item.offsetX !== 0 || item.offsetY !== 0
    || item.scale !== 1 || item.rotate !== 0 || item.depth !== 0 || item.hidden;
}

/**
 * One box's corrections, the artwork included.
 *
 * The artwork's are kept in `imageScale`/`imageOffset*` rather than in
 * `parts.media`, because those three fields predate this record, are
 * what the inspector's sliders bind to, and are in every catalogue
 * already saved. Rather than migrate them or maintain two homes for one
 * number, the artwork is read and written through this adapter and the
 * rest of the editor never learns that it is special.
 */
export function partOverride(
  overrides: PlacementOverrides, part: TilePart,
): PartOverride {
  if (part === 'media') {
    return {
      offsetX: overrides.imageOffsetX,
      offsetY: overrides.imageOffsetY,
      scale: overrides.imageScale,
      hidden: false,
      text: null,
    };
  }
  return overrides.parts[part] ?? PART_DEFAULTS;
}

/** The placement patch that writes one box's corrections back. */
export function partPatch(
  overrides: PlacementOverrides,
  part: TilePart,
  patch: Partial<PartOverride>,
): Partial<PlacementOverrides> {
  if (part === 'media') {
    return {
      ...(patch.offsetX !== undefined ? { imageOffsetX: patch.offsetX } : {}),
      ...(patch.offsetY !== undefined ? { imageOffsetY: patch.offsetY } : {}),
      ...(patch.scale !== undefined ? { imageScale: patch.scale } : {}),
    };
  }
  return {
    parts: { ...overrides.parts, [part]: { ...partOverride(overrides, part), ...patch } },
  };
}

/**
 * How far a box may be moved, and in what increments.
 *
 * The artwork answers in a different currency from everything else —
 * its offsets are fractions of its own frame, the rest are percentages
 * of the page — so the two need different reaches and different key
 * steps. Kept here, beside the bounds the schema enforces, because a
 * clamp in the editor that disagrees with the schema's `min`/`max` is a
 * drag that silently stops writing.
 */
export function partLimits(part: TilePart): {
  reach: number; step: number; coarse: number; minScale: number; maxScale: number;
} {
  return part === 'media'
    ? { reach: 1, step: 0.01, coarse: 0.05, minScale: 0.5, maxScale: 2 }
    : { reach: 25, step: 0.25, coarse: 1, minScale: 0.4, maxScale: 3 };
}

/** Whether a box has been moved, resized, hidden or rewritten. */
export function partTouched(overrides: PlacementOverrides, part: TilePart): boolean {
  const p = partOverride(overrides, part);
  return p.offsetX !== 0 || p.offsetY !== 0 || p.scale !== 1 || p.hidden || p.text !== null;
}

/** Whether anything on the tile has been moved out of its template position. */
export function tileArranged(overrides: PlacementOverrides): boolean {
  return Object.values(overrides.parts).some(
    (p) => p.offsetX !== 0 || p.offsetY !== 0 || p.scale !== 1,
  ) || Object.values(overrides.pack).some(
    (p) => p.offsetX !== 0 || p.offsetY !== 0 || p.scale !== 1 || p.rotate !== 0,
  );
}

export const Placement = z.object({
  offerId: z.string().min(1),
  /** A slot id in the page's template. */
  slotId: z.string().min(1),
  overrides: PlacementOverrides.default({}),
});
export type Placement = z.infer<typeof Placement>;

/**
 * What a page IS.
 *
 * `offers` is the ordinary page this whole repo is about: a grid, a
 * template, products in cells. `image` is one picture filling the sheet
 * — the Røde Kors spread, the membership ad, the recipe page — which a
 * printed avis is full of and which has no grid, no offers and nothing
 * to cast.
 *
 * A kind rather than a convention, because every stage has to be able
 * to ask. The composer must not lay out a page that holds no offers,
 * the editor must not offer a layout picker for one, and `benched`
 * must not report the products of a page that has none. All three
 * would otherwise have to infer it from an empty `placements` array,
 * which is also what a page whose offers were all taken off looks
 * like.
 */
export const PAGE_KINDS = ['offers', 'image'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const CatalogPage = z.object({
  id: z.string().min(1),
  /**
   * An ordinary page, or a whole-sheet picture.
   *
   * Defaulted, so every catalogue saved before ads existed still parses
   * as what it is.
   */
  kind: z.enum(PAGE_KINDS).default('offers'),
  /**
   * Must name a template belonging to the catalog's own brand.
   *
   * Empty on an `image` page, which has no grid to name: the sheet is
   * the picture. Kept as a plain string rather than made nullable so
   * the field has one type everywhere it is read.
   */
  templateId: z.string().default(''),
  /** Section heading, written by the curator, editable by hand. */
  title: z.string().default(''),
  subtitle: z.string().default(''),
  placements: z.array(Placement),
  /** Why the curator grouped these offers. Shown in the editor, not printed. */
  rationale: z.string().default(''),
  /**
   * This page's own field, overriding the chain's rotation.
   *
   * Set only when the page was rebuilt from a reference whose ground was
   * MEASURED — see `sampleGround` in `@incitio/match`. It is not a theme
   * and it is not editorial licence: `pageGround` still decides the
   * colour of every ordinary page, and a chain's identity is still the
   * one thing a document may not carry a copy of. What it carries here
   * is a fact about a printed page somebody handed us, and without it a
   * page rebuilt from a teal spread comes back sand.
   */
  ground: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  /**
   * Generated mood artwork, drawn behind the offers.
   *
   * Capped at three because this is seasoning: a page that is mostly
   * filler has stopped being a leaflet. Defaulted to empty, so every
   * catalogue saved before this existed still parses.
   */
  decorations: z.array(PageDecoration).max(3).default([]),
  /**
   * The chain's own picture under the whole sheet, when there is one.
   *
   * Nullable and defaulted, so every catalogue saved before this
   * existed still parses. One per page: a second background is not a
   * background, it is the first one hidden.
   */
  background: PageBackground.nullable().default(null),
  /*
   * Where the heading and the theme line have been put, keyed by
   * `PagePart`.
   *
   * Sparse, like a placement's `parts` and for the same reason: almost
   * every page leaves both lines where the masthead puts them, and
   * writing two untouched records onto every page would say nothing at
   * a cost. A key that is absent means the line is where the
   * stylesheet put it.
   *
   * Keyed by `z.string()` so that reading it admits `undefined` — a
   * record typed over the enum claims both keys are present, which is
   * the lie that would crash on a catalogue saved before this existed.
   */
  texts: z.record(z.string(), PageTextOverride).default({}),
});
export type CatalogPage = z.infer<typeof CatalogPage>;

/** A page that is one picture rather than a grid of offers. */
export function isImagePage(page: CatalogPage): boolean {
  return page.kind === 'image';
}

/** Where one of a page's lines has been put. */
export function pageTextOverride(page: CatalogPage, part: PagePart): PageTextOverride {
  return page.texts[part] ?? PAGE_TEXT_DEFAULTS;
}

/** The page patch that writes one line's corrections back. */
export function pageTextPatch(
  page: CatalogPage, part: PagePart, patch: Partial<PageTextOverride>,
): Pick<CatalogPage, 'texts'> {
  return { texts: { ...page.texts, [part]: { ...pageTextOverride(page, part), ...patch } } };
}

/** Whether a line has been moved, resized or taken off the page. */
export function pageTextTouched(page: CatalogPage, part: PagePart): boolean {
  const t = pageTextOverride(page, part);
  return t.offsetX !== 0 || t.offsetY !== 0 || t.scale !== 1 || t.hidden;
}

/**
 * Whether either line has been moved out of the masthead's own strip.
 *
 * The masthead clips — see `.page__masthead`, where that guard stops a
 * three-word section name from pushing the offers off the sheet. A
 * heading someone has deliberately dragged has to escape it, and this
 * is what tells the renderer which of the two is happening. Scale
 * counts: a heading set at 2× is as far outside the strip as one
 * dragged there.
 */
export function pageTextsFreed(page: CatalogPage): boolean {
  return PAGE_PARTS.some((part) => {
    const t = pageTextOverride(page, part);
    return t.offsetX !== 0 || t.offsetY !== 0 || t.scale !== 1;
  });
}

/**
 * The single source of truth. Composition produces it, the renderer draws
 * it, the editor mutates it, SQLite stores it. Nothing else is persisted.
 *
 * It carries a `brandId`, never a copy of the brand's colours: a document
 * that embedded its own theme could drift from the chain's identity, and
 * could be re-pointed at another chain's look by editing one field.
 */
export const CatalogDocument = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(2),
  name: z.string().min(1),
  brandId: z.string().min(1),
  pages: z.array(CatalogPage),
  /**
   * The offers this catalog prints, snapshotted at build time.
   *
   * Embedded rather than referenced because a feed is this week's file:
   * it is replaced on Monday, and a catalog that could only be re-rendered
   * while its source feed still existed would not be reproducible. A
   * placement's `offerId` indexes into this list.
   */
  offers: z.array(Offer).default([]),
  /**
   * Layouts this document brought with it, on top of the chain's own.
   *
   * A template read off one reference page — see `npm run match` — is
   * not part of the chain's vocabulary: nobody drew it, it describes one
   * printed page, and adding it to the brand would offer it in the
   * layout picker of every unrelated page forever. But a document whose
   * layout lived only in the memory of the process that generated it
   * could not be saved, reopened or printed, so it travels here.
   *
   * Resolved BEFORE the brand's own set, and only ever within this
   * document. Isolation is unaffected: these come out of the same
   * request that built the page, never out of another tenant's brand.
   */
  templates: z.array(PageTemplate).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CatalogDocument = z.infer<typeof CatalogDocument>;

/**
 * Several one-page documents as one catalogue.
 *
 * Rebuilding from references is one call per reference — one page comes
 * back at a time, because that is the only way the studio can report
 * progress and keep the pages it already has when the fourth one fails.
 * This is what turns those replies into the single document the editor,
 * the store and the printer understand.
 *
 * It lives here rather than in `@incitio/match` because both callers
 * need it and only one of them is allowed near Playwright: the studio
 * merges in the browser as each page lands, the CLI merges in Node when
 * the loop is done. One definition, so "four references" cannot mean
 * two different catalogues depending on where you asked.
 *
 * Page ids are reassigned. Every rebuilt page calls itself `page-1`, and
 * duplicate ids would make the editor move, rename and re-template the
 * wrong sheet. Offers and layouts are keyed by id and the first of each
 * wins, which also makes this safe to re-run on a growing list.
 */
export function mergeCatalogDocuments(
  parts: CatalogDocument[],
  options: { id?: string; name?: string } = {},
): CatalogDocument {
  const first = parts[0];
  if (!first) throw new Error('mergeCatalogDocuments: intet at samle');

  const offers = new Map<string, Offer>();
  const templates = new Map<string, PageTemplate>();
  const pages: CatalogPage[] = [];

  for (const part of parts) {
    for (const offer of part.offers) if (!offers.has(offer.id)) offers.set(offer.id, offer);
    for (const t of part.templates) if (!templates.has(t.id)) templates.set(t.id, t);
    for (const page of part.pages) pages.push({ ...page, id: `page-${pages.length + 1}` });
  }

  return {
    ...first,
    id: options.id ?? first.id,
    name: options.name ?? first.name,
    pages,
    offers: [...offers.values()],
    templates: [...templates.values()],
    updatedAt: new Date().toISOString(),
  };
}
