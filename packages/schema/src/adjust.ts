import { z } from 'zod';

/**
 * How a photograph is developed on the page — tone, colour, sharpness,
 * shape, mask and blend — as numbers, never as new pixels.
 *
 * The feed's link stays the picture. Everything here is drawn by the
 * renderer as an SVG filter and CSS (`@incitio/renderer` `adjustment`),
 * so the studio, the PDF and next week's re-render all read the same
 * parameters and nothing is ever baked in: "Nulstil" is deleting the key.
 *
 * Every field is optional and absent means untouched, for the reason
 * `PlacementOverrides.parts` is sparse — a document carries one of these
 * per photograph, and twenty zeros on every tile say nothing.
 */

/** A point on a curve, input → output, both 0–1. */
export const CurvePoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type CurvePoint = z.infer<typeof CurvePoint>;

/** A tone curve through these points, endpoints included. Two or more, sorted by input. */
const Curve = z.array(CurvePoint).min(2).max(16);

export const ImageCurves = z.object({
  rgb: Curve.optional(),
  r: Curve.optional(),
  g: Curve.optional(),
  b: Curve.optional(),
});
export type ImageCurves = z.infer<typeof ImageCurves>;

/** Levels: what counts as black and white coming in, the midtone, and the range going out. */
export const ImageLevels = z.object({
  black: z.number().min(0).max(1).default(0),
  white: z.number().min(0).max(1).default(1),
  /** Midtone gamma; above 1 lightens. */
  gamma: z.number().min(0.1).max(9.99).default(1),
  outBlack: z.number().min(0).max(1).default(0),
  outWhite: z.number().min(0).max(1).default(1),
});
export type ImageLevels = z.infer<typeof ImageLevels>;

/**
 * What of the photograph shows, drawn as a shape over it.
 *
 * Coordinates are in a pixel grid laid over the WHOLE photograph —
 * `w`×`h`, the size the studio analysed it at — so the mask has the
 * photograph's own proportions and lands on it however the frame fits
 * the picture (`object-fit: contain` or `cover`). A marquee is four
 * points; a magic-wand selection is its traced outline. A path, not a
 * bitmap: it is a few hundred characters in the document, it scales
 * to print without stairs, and the feather is applied when it is
 * drawn, so it can be changed afterwards.
 */
export const ImageMask = z.object({
  w: z.number().int().min(1).max(4096),
  h: z.number().int().min(1).max(4096),
  /** SVG path data in the grid, even-odd filled; inside is what shows. */
  path: z.string().min(1).max(60000),
  /** Soft edge, as a share of the photograph's longer side. */
  feather: z.number().min(0).max(0.2).default(0),
  /** Show what is OUTSIDE the outline instead. */
  invert: z.boolean().default(false),
});
export type ImageMask = z.infer<typeof ImageMask>;

/** A crop, as shares of the photograph: what remains is drawn as if it were the whole picture. */
export const ImageCrop = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.02).max(1),
  h: z.number().min(0.02).max(1),
});
export type ImageCrop = z.infer<typeof ImageCrop>;

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const ImageAdjust = z.object({
  /** Stops of light, in linear light like a camera's: +1 is twice as bright. */
  exposure: z.number().min(-3).max(3).optional(),
  /** Midtones up or down; black and white stay put. −1…1. */
  brightness: z.number().min(-1).max(1).optional(),
  /** Spread from the middle grey. −1 is flat grey, 1 is near-posterised. */
  contrast: z.number().min(-1).max(1).optional(),
  levels: ImageLevels.optional(),
  curves: ImageCurves.optional(),
  /** Degrees round the colour wheel. */
  hue: z.number().min(-180).max(180).optional(),
  /** −1 is grey, 1 is twice the colour. */
  saturation: z.number().min(-1).max(1).optional(),
  /** Towards black (−1) or white (1), after the colour. */
  lightness: z.number().min(-1).max(1).optional(),
  /** Unsharp amount on the 3×3 neighbourhood. */
  sharpen: z.number().min(0).max(3).optional(),
  /** Gaussian blur, as a share of the photograph's width. */
  blur: z.number().min(0).max(0.05).optional(),
  /** Only the outlines, dark on white — Photoshop's "Find Edges". */
  edges: z.boolean().optional(),
  /** How the photograph mixes with what is under it on the page. */
  blend: z.enum(BLEND_MODES).optional(),
  /** Degrees of shear. */
  skewX: z.number().min(-45).max(45).optional(),
  skewY: z.number().min(-45).max(45).optional(),
  crop: ImageCrop.optional(),
  mask: ImageMask.optional(),
});
export type ImageAdjust = z.infer<typeof ImageAdjust>;

/** The keys that change colour and tone — the ones a histogram can show. */
export const TONAL_KEYS = ['exposure', 'brightness', 'contrast', 'levels', 'curves', 'hue', 'saturation', 'lightness'] as const;

/**
 * The adjustment with every no-op dropped, or `undefined` when nothing
 * is left — so a slider pulled back to zero leaves no key behind.
 */
export function tidyAdjust(adjust: ImageAdjust | undefined): ImageAdjust | undefined {
  if (!adjust) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(adjust)) {
    if (value === undefined || value === 0 || value === false || value === 'normal') continue;
    if (key === 'levels') {
      const l = value as ImageLevels;
      if (l.black === 0 && l.white === 1 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 1) continue;
    }
    if (key === 'curves') {
      const c = Object.fromEntries(Object.entries(value as ImageCurves).filter(([, points]) => (
        points && !(points.length === 2 && points[0]![0] === 0 && points[0]![1] === 0 && points[1]![0] === 1 && points[1]![1] === 1)
      )));
      if (Object.keys(c).length === 0) continue;
      out[key] = c;
      continue;
    }
    if (key === 'crop') {
      const c = value as ImageCrop;
      if (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1) continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length ? (out as ImageAdjust) : undefined;
}

/** Whether a photograph has been developed at all. */
export function adjustTouched(adjust: ImageAdjust | undefined): boolean {
  return tidyAdjust(adjust) !== undefined;
}
