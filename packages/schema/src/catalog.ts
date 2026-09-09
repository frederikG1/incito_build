import { z } from 'zod';

export const Theme = z.object({
  name: z.string().default('default'),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c8102e'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffd200'),
  pageBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1a1a1a'),
  headingFont: z.string().default("'Inter', system-ui, sans-serif"),
  bodyFont: z.string().default("'Inter', system-ui, sans-serif"),
  logoUrl: z.string().nullable().default(null),
});
export type Theme = z.infer<typeof Theme>;

/**
 * Per-placement human corrections. These survive regeneration: the
 * solver treats a placement carrying overrides as pinned unless the
 * editor explicitly releases it. That is the mechanism by which "human
 * finesse" is not thrown away the next time the AI runs.
 */
export const PlacementOverrides = z.object({
  /** Human moved or resized this tile; the solver must not touch it. */
  pinned: z.boolean().default(false),
  displayName: z.string().nullable().default(null),
  imageScale: z.number().min(0.5).max(2).default(1),
  imageOffsetX: z.number().min(-1).max(1).default(0),
  imageOffsetY: z.number().min(-1).max(1).default(0),
});
export type PlacementOverrides = z.infer<typeof PlacementOverrides>;

export const Placement = z.object({
  offerId: z.string().min(1),
  slotId: z.string().min(1),
  overrides: PlacementOverrides.default({}),
});
export type Placement = z.infer<typeof Placement>;

export const CatalogPage = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  /** Section heading; written by the planner, editable by hand. */
  title: z.string().default(''),
  subtitle: z.string().default(''),
  placements: z.array(Placement),
});
export type CatalogPage = z.infer<typeof CatalogPage>;

/**
 * The single source of truth. Generation produces it, the renderer draws
 * it, the editor mutates it, SQLite stores it. Nothing else is persisted.
 */
export const CatalogDocument = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  retailerId: z.string().min(1),
  theme: Theme,
  /** Page aspect ratio, width / height. 0.707 is portrait A4. */
  pageAspect: z.number().positive().default(0.707),
  pages: z.array(CatalogPage),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CatalogDocument = z.infer<typeof CatalogDocument>;
