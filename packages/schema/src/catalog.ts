import { z } from 'zod';
import { Offer } from './offer.js';

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
  imageScale: z.number().min(0.5).max(2).default(1),
  imageOffsetX: z.number().min(-1).max(1).default(0),
  imageOffsetY: z.number().min(-1).max(1).default(0),
});
export type PlacementOverrides = z.infer<typeof PlacementOverrides>;

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
