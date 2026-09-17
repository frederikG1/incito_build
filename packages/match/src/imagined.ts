/**
 * A page laid out by an image model, filled with real products.
 *
 * The same job as `matchPage` and the same machinery — only the
 * reference is drawn instead of scanned. An image model is asked for a
 * page LAYOUT, that drawing is read the way a photographed page is
 * read, and this week's offers are cast into the cells it turned out to
 * have.
 *
 * The drawing is never printed. It is scaffolding: it decides where the
 * cells are and how big each one is, and then it is thrown away. What
 * lands on the sheet is the chain's own stylesheet drawing the chain's
 * own tiles — which is what keeps a generated page a page of this
 * chain's leaflet rather than a picture of a leaflet. It is handed back
 * so the editor can see what was read, exactly as a scanned reference
 * is, and for no other reason.
 *
 * Two models, two jobs, and they are not interchangeable:
 *   Gemini  draws the layout          (what shape the page is)
 *   Claude  reads it and casts        (which offer goes where)
 * The second half is `matchPage` unchanged — the same structured output,
 * the same validation, the same refusal to let a model invent an offer.
 */
import { DEFAULT_IMAGE_MODEL, generateImage, type GeminiOptions } from '@incitio/decor';
import { matchPage, MatchError, type MatchOptions, type MatchResult } from './index.js';

/**
 * How many cells to ask for when nobody says.
 *
 * Six is the modal grocery page in every chain this repo has measured,
 * and an image model given no number draws whatever it likes — usually
 * a magazine spread with three enormous photographs.
 */
export const DEFAULT_CELLS = 6;

export interface LayoutPrompt {
  /** How many product cells the page should hold. */
  cells?: number;
  /** The sheet's colour, so the drawing is on the chain's own ground. */
  ground?: string;
  /** The editor's own words, added to the standing prompt, never instead of it. */
  note?: string;
}

/**
 * The prompt the image model is given.
 *
 * Exported and pure so the studio can show it: the editor's own words
 * go in the middle, and what surrounds them is the part that makes the
 * drawing readable as a grid rather than pretty. Two things the standing
 * prompt insists on, both learned the hard way from the scanned path:
 *
 *   - NO TEXT. A drawing with invented Danish product names gives the
 *     casting step something to match against that does not exist in the
 *     feed, and it dutifully matches it.
 *   - Cells that meet. A wireframe with generous white margins between
 *     every box reads as a page of six separate pages: `lattice` and the
 *     model both want the alleys to look like alleys.
 */
export function layoutPrompt(options: LayoutPrompt = {}): string {
  const cells = options.cells ?? DEFAULT_CELLS;
  return [
    'A wireframe for ONE page of a printed supermarket leaflet, A4 portrait, seen flat on.',
    `The page is divided into exactly ${cells} product cells on a clear rectangular grid.`,
    'One cell is markedly larger than the rest and leads the page; the others may vary in size.',
    'Inside every cell: a plain grey rounded rectangle where the product photograph goes,'
    + ' a circle or rounded badge where the price is stamped, and two or three flat grey bars'
    + ' where the product name and the fine print are set.',
    'The cells are separated by narrow, even alleys and together fill the sheet, leaving a'
    + ' shallow band across the top for the section headline.',
    options.ground
      ? `The sheet is a flat ${options.ground} background, the same colour to every edge.`
      : 'The sheet is one flat pale background colour to every edge.',
    ...(options.note ? [options.note] : []),
    'NO lettering of any kind, no logos, no photographs, no real products, no people —'
    + ' grey placeholder shapes only. Sharp edges, no perspective, no shadow, no paper texture.',
  ].join(' ');
}

export interface ImagineOptions extends Omit<MatchOptions, 'file' | 'pageNumber'> {
  /** Which chain the page is for. */
  brandId: string;
  /** The whole prompt, replacing the standing one. For a CLI that already built it. */
  prompt?: string;
  /** The parts the standing prompt is built from, when `prompt` is absent. */
  layout?: LayoutPrompt;
  /** Passed to the image model — key, model id, timeout. */
  gemini?: GeminiOptions;
}

export interface ImagineResult extends MatchResult {
  /** Exactly what the image model was asked for, shown back to the editor. */
  prompt: string;
  /** Which model drew it. */
  imageModel: string;
  /** How long the drawing alone took. */
  drawnInMs: number;
}

/**
 * Draw a layout, then fill it.
 *
 * The drawing is handed to `matchPage` as `file`, which is the whole
 * trick: everything that already knows how to rebuild a photographed
 * page — measuring the ground, casting the offers, validating the grid,
 * refusing an invented offer id — works on a drawn one without knowing
 * the difference.
 */
export async function imaginePage(options: ImagineOptions): Promise<ImagineResult> {
  const prompt = options.prompt ?? layoutPrompt(options.layout ?? {});

  const started = Date.now();
  const drawing = await generateImage(prompt, options.gemini ?? {});
  const drawnInMs = Date.now() - started;

  /*
   * The image model may answer with something that is not a PNG or a
   * JPEG — a WebP, on some models. The vision step accepts a fixed set
   * of media types, so an unexpected one has to fail here, where the
   * prompt that caused it is still in hand.
   */
  if (!/^image\/(png|jpeg|webp|gif)$/.test(drawing.mimeType)) {
    throw new MatchError(`billedmodellen svarede med ${drawing.mimeType}, som ikke kan læses`);
  }

  const { brandId, prompt: _prompt, layout: _layout, gemini, ...match } = options;
  const result = await matchPage(brandId, { ...match, file: drawing.bytes });

  return {
    ...result,
    prompt,
    imageModel: gemini?.model ?? DEFAULT_IMAGE_MODEL,
    drawnInMs,
  };
}
