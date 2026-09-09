import { z } from 'zod';

/**
 * What the ML sidecar reports back about one product image. This is the
 * only channel by which image analysis reaches the layout engine — the
 * engine never opens an image itself.
 */
export const ImageProfile = z.object({
  offerId: z.string().min(1),
  /** Hash of the source URL; the cache key shared with the Python sidecar. */
  sourceHash: z.string().min(1),

  /**
   * cutout   — subject isolated on transparent/uniform ground, crops freely
   * packshot — product photographed on white, safe but has a visible edge
   * lifestyle— scene photography, needs a large slot or it reads as mush
   */
  kind: z.enum(['cutout', 'packshot', 'lifestyle', 'unknown']),
  hasAlpha: z.boolean(),

  /** Tight subject box in normalised 0..1 image coordinates. */
  subjectBBox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
  /** width / height of the source image. */
  aspect: z.number().positive(),
  dominantColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),

  /** 0..1 — resolution and subject clarity. Gates the biggest slots. */
  qualityScore: z.number().min(0).max(1),
  /** True when the profile came from heuristics, not the trained model. */
  provisional: z.boolean().default(true),
});
export type ImageProfile = z.infer<typeof ImageProfile>;
