import { z } from 'zod';

/**
 * Slot roles carry editorial meaning, not just size. The solver matches
 * offer importance to role, then role to geometry — keeping the two
 * mappings separate is what lets a mined template from one retailer be
 * reused for another.
 */
export const SlotRole = z.enum(['hero', 'standard', 'filler']);
export type SlotRole = z.infer<typeof SlotRole>;

/**
 * A placeable region, addressed in grid cells (not pixels) so a template
 * mined from an A4 print page renders correctly at any web page size.
 */
export const TemplateSlot = z.object({
  id: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  role: SlotRole,
  /**
   * Image aspect this slot was designed around. The solver penalises
   * placements that deviate; it does not forbid them.
   */
  preferredAspect: z.number().positive().default(1),
  /** Roughly how many characters of product name fit before clipping. */
  textCapacity: z.number().int().positive().default(48),
  /**
   * Slot ids this one may be promoted into when a human enlarges a tile.
   * Empty means the tile is not resizable within this template.
   */
  promotesTo: z.array(z.string()).default([]),
});
export type TemplateSlot = z.infer<typeof TemplateSlot>;

export const PageTemplate = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  grid: z.object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    /** Gutter as a fraction of one cell's width. */
    gutter: z.number().min(0).max(0.5).default(0.04),
  }),
  slots: z.array(TemplateSlot).min(1),
  /** Where this template came from — mined page, or hand-authored. */
  provenance: z.object({
    source: z.enum(['mined', 'authored']),
    catalogId: z.string().default(''),
    pageNumber: z.number().int().nonnegative().default(0),
  }),
});
export type PageTemplate = z.infer<typeof PageTemplate>;

export const TemplateLibrary = z.object({
  version: z.string().default('0.1.0'),
  templates: z.array(PageTemplate),
});
export type TemplateLibrary = z.infer<typeof TemplateLibrary>;
