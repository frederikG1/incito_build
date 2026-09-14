/**
 * The image prompt.
 *
 * Built here rather than by the model that chose the subject, because
 * everything except the subject is a constant of this pipeline and must
 * not drift: the cut-out step downstream keys the background out by
 * flood-filling from the edges, so "one subject, isolated, on a plain
 * white field, nothing touching the border" is not a stylistic
 * preference — it is the contract that makes the cut-out possible.
 *
 * `chooseSubjects` therefore returns a bare motif ("a loose handful of
 * whole almonds") and every word of craft is added here.
 */

export interface PromptOptions {
  /** The chain, for the register the artwork is drawn in. */
  brandName?: string;
  /**
   * The editor's own words, added to every image on top of the craft
   * below — "skudt ovenfra", "mørk baggrund, efterår", "akvarel".
   *
   * Placed after the craft and BEFORE the contract on purpose: the
   * contract gets the last word, so a direction that happens to
   * contradict it ("on a wooden table") does not silently take the
   * white field away from the cut-out step. It can still lose that
   * argument with the model — which is exactly what `decorate`'s
   * `kept > 0.97` guard catches and reports, rather than printing a
   * photograph with corners.
   */
  style?: string;
}

const CONTRACT = [
  'Isolated on a pure white background (#FFFFFF), edge to edge.',
  'The subject is centred and fully inside the frame, with clear white',
  'margin on all four sides — nothing touches or crosses the border.',
  'No shadow cast onto the background, no vignette, no gradient, no',
  'backdrop, no surface or table under the subject.',
  'No text, no labels, no packaging, no logos, no hands, no people.',
  'A single subject only.',
].join(' ');

const CRAFT = [
  'Editorial food photography for a printed supermarket leaflet:',
  'soft diffused daylight from the upper left, natural saturated colour,',
  'sharp focus throughout, shot slightly from above.',
].join(' ');

/**
 * How much of the editor's direction survives into the prompt.
 *
 * A cap, not a courtesy: the contract is what keeps the artwork usable,
 * and three paragraphs of pasted direction ahead of it simply drowns it
 * out. 300 characters is more than any of the directions this field was
 * built for and far less than a wall of text.
 */
export const STYLE_LIMIT = 300;

/** The editor's words, trimmed to one clause that ends in a full stop. */
export function normaliseStyle(style: string): string {
  const text = style.trim().replace(/\s+/g, ' ').slice(0, STYLE_LIMIT).trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The prompt for one motif. */
export function imagePrompt(motif: string, options: PromptOptions = {}): string {
  const style = normaliseStyle(options.style ?? '');
  return [
    `${motif.trim().replace(/\.$/, '')}.`,
    CRAFT,
    style,
    CONTRACT,
    options.brandName
      ? `Styled for ${options.brandName}, a Danish supermarket. Nordic, fresh, unfussy.`
      : '',
    'Square image.',
  ].filter(Boolean).join(' ');
}
