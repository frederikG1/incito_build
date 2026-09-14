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

/** The prompt for one motif. */
export function imagePrompt(motif: string, options: PromptOptions = {}): string {
  return [
    `${motif.trim().replace(/\.$/, '')}.`,
    CRAFT,
    CONTRACT,
    options.brandName
      ? `Styled for ${options.brandName}, a Danish supermarket. Nordic, fresh, unfussy.`
      : '',
    'Square image.',
  ].filter(Boolean).join(' ');
}
