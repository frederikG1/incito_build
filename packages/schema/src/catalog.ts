import { z } from 'zod';
import { Offer } from './offer.js';

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
export const PlacementOverrides = z.object({
  pinned: z.boolean().default(false),
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
});
export type PlacementOverrides = z.infer<typeof PlacementOverrides>;

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
  );
}

export const Placement = z.object({
  offerId: z.string().min(1),
  /** A slot id in the page's template. */
  slotId: z.string().min(1),
  overrides: PlacementOverrides.default({}),
});
export type Placement = z.infer<typeof Placement>;

export const CatalogPage = z.object({
  id: z.string().min(1),
  /** Must name a template belonging to the catalog's own brand. */
  templateId: z.string().min(1),
  /** Section heading, written by the curator, editable by hand. */
  title: z.string().default(''),
  subtitle: z.string().default(''),
  placements: z.array(Placement),
  /** Why the curator grouped these offers. Shown in the editor, not printed. */
  rationale: z.string().default(''),
});
export type CatalogPage = z.infer<typeof CatalogPage>;

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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CatalogDocument = z.infer<typeof CatalogDocument>;
