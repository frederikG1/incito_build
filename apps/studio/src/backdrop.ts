import type { PageBackground } from '@incitio/schema';

/**
 * What to do with a picture somebody just dropped under a page.
 *
 * Every upload used to land the same way — fill the sheet, crop to
 * fit, full strength, centred — which is a guess, and it was wrong for
 * the commonest case there is: a square graphic off the internet. On
 * an A4 sheet `cover` scales a 1:1 picture to the page's height and
 * takes 29 % off each side, so the thing the person chose it for is
 * the part that gets cut, and at full strength the prices end up
 * printed on a flat colour field.
 *
 * So the file is measured and the four settings follow from it. Not
 * silently: `why` is said back in the studio, and every one of them is
 * still a control the editor can move afterwards.
 */

/** What can be read off a picture without knowing anything about pages. */
export interface Backdrop {
  width: number;
  height: number;
  /** 0..1, averaged over a sampled grid. */
  saturation: number;
  /** 0..1, averaged the same way. 0 is black. */
  luminance: number;
  /**
   * How many different colours are in it, as a share of the pixels
   * sampled.
   *
   * Reported, not acted on. It was meant to tell a photograph from a
   * graphic and it does not: measured on the two pictures this was
   * built against, a red key visual came out at 0.037 and an aerial
   * photograph of a beach at 0.063 — a flat photograph is as flat as
   * a flat design. Kept because it is the honest number to look at
   * first the day a rule about the two is needed, and because a
   * measurement that was wrong for one purpose is not thereby wrong.
   */
  variety: number;
  /**
   * Where the interesting part of the picture is, 0..100 each way.
   *
   * The centroid of contrast: every sampled pixel is weighted by how
   * far it sits from the picture's own average brightness, so a white
   * logo on a red field pulls towards the logo and an even field of
   * sand pulls nowhere and lands in the middle. It is what `cover`
   * crops around — and a crop around the middle of a picture whose
   * subject is not in the middle is the whole complaint.
   */
  focusX: number;
  focusY: number;
}

export type Fit = PageBackground['fit'];

/** Under this on both sides, a picture is a swatch rather than a scene. */
export const SWATCH = 300;

/**
 * Past this, a picture is a colour field and the prices need it turned
 * down. Measured against the pictures this was built for: a chain's red
 * key visual sits at 0.83, an aerial photograph of a beach at 0.08.
 */
export const LOUD = 0.35;

/** Under this it is a dark picture, and price type will not read over it. */
export const DARK = 0.45;

/** How far down a loud picture goes, so a price can be read over it. */
export const QUIET = 0.3;

export interface Chosen {
  fit: Fit;
  opacity: number;
  focusX: number;
  focusY: number;
  /** Why, in Danish, for the line the studio says back. */
  why: string;
}

/**
 * The four settings, read off the picture and the sheet it goes under.
 *
 * A backdrop FILLS the sheet. That is what the word means, and it is
 * the thing this got wrong first time round: a picture whose shape
 * disagreed with the page was letterboxed so all of it would show,
 * which puts bands of the chain's ground above and below a photograph
 * and reads as a page somebody broke.
 *
 * Cropping is not the problem — a backdrop is not a picture anybody
 * studies. So the question is never WHETHER to crop but WHERE, and
 * that is `focusX`/`focusY`: a blind 50/50 before, the picture's own
 * centre of contrast now.
 *
 * `contain` stays in the dropdown. It is the right answer perhaps one
 * time in twenty — a designed panel that has to be seen whole — and
 * that is the sort of judgement to leave to the person rather than to
 * guess on their behalf.
 *
 * Pure, so the decision can be argued with in a test rather than by
 * uploading things and squinting.
 */
export function chooseBackdrop(image: Backdrop, pageAspect: number): Chosen {
  const loud = image.saturation >= LOUD;
  const dark = image.luminance <= DARK;
  const opacity = loud || dark ? QUIET : 1;
  const dimmed = opacity < 1 ? `, dæmpet fordi det er ${loud ? 'mættet' : 'mørkt'}` : '';

  /*
   * A swatch is a pattern: repeated it covers any sheet at its own
   * size, and stretched it is a blurred rectangle.
   */
  if (image.width <= SWATCH && image.height <= SWATCH) {
    return {
      fit: 'tile',
      opacity,
      focusX: 50,
      focusY: 50,
      why: `lille felt (${image.width}×${image.height}) — gentaget som mønster${dimmed}`,
    };
  }

  const aspect = image.height > 0 ? image.width / image.height : 1;
  const focusX = Math.round(image.focusX);
  const focusY = Math.round(image.focusY);
  // Only the axis actually cropped is worth naming: a landscape
  // picture on a portrait sheet loses its sides and nothing off the
  // top, and saying otherwise sends somebody to the wrong slider.
  const cut = aspect > pageAspect ? 'siderne' : 'top og bund';
  const moved = Math.abs(focusX - 50) > 8 || Math.abs(focusY - 50) > 8;

  return {
    fit: 'cover',
    opacity,
    focusX,
    focusY,
    why: `fylder arket, beskåret i ${cut}`
      + (moved ? ` om motivet (${focusX}/${focusY})` : '')
      + dimmed,
  };
}

/**
 * The picture, measured in the browser.
 *
 * Read off the FILE rather than off the uploaded URL: it is already in
 * memory, it needs no round trip, and a blob is same-origin so the
 * canvas will hand back its pixels. Sampled at 32×32 — the questions
 * are "how saturated" and "how dark", and neither needs a megapixel.
 *
 * Every failure answers "a plain picture at the sheet's own shape",
 * which is what the studio did for every upload before this existed.
 * A backdrop that cannot be measured is not a reason to refuse it.
 */
export async function measureBackdrop(file: File): Promise<Backdrop | null> {
  try {
    const bitmap = await createImageBitmap(file);
    // Read before closing: a closed bitmap reports nothing.
    const width = bitmap.width;
    const height = bitmap.height;
    const side = 32;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const paper = canvas.getContext('2d', { willReadFrequently: true });
    if (!paper) return null;
    paper.drawImage(bitmap, 0, 0, side, side);
    const { data } = paper.getImageData(0, 0, side, side);

    let saturation = 0;
    let luminance = 0;
    let counted = 0;
    // Quantised to 4 bits a channel: two shades of the same sand are
    // one colour, which is the question being asked.
    const colours = new Set<number>();
    /*
     * Kept so contrast can be weighed in a second pass.
     *
     * The centre of contrast needs the picture's average brightness,
     * and the average is not known until every pixel has been seen —
     * so the brightnesses are held rather than the image decoded
     * twice. A thousand numbers.
     */
    const bright: number[] = [];
    for (let at = 0; at < data.length; at += 4) {
      // A transparent pixel is not a colour; a PNG with a cut-out
      // subject is mostly transparent and would read as pale grey.
      if (data[at + 3]! < 16) continue;
      const r = data[at]! / 255;
      const g = data[at + 1]! / 255;
      const b = data[at + 2]! / 255;
      const high = Math.max(r, g, b);
      const low = Math.min(r, g, b);
      saturation += high === 0 ? 0 : (high - low) / high;
      luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colours.add(
        ((data[at]! >> 4) << 8) | ((data[at + 1]! >> 4) << 4) | (data[at + 2]! >> 4),
      );
      bright.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      counted += 1;
    }
    bitmap.close();
    if (counted === 0) return null;

    /*
     * Where the contrast is, as a centre of gravity.
     *
     * Each pixel pulls with how far it is from the picture's own mean
     * brightness — a white logo on a red field pulls hard, an even
     * field of sand pulls evenly and cancels out — and the result is
     * where a crop should be centred. Falls back to the middle when
     * nothing pulls, which is the honest answer for a plain gradient.
     *
     * Pulled only partway, and clamped: this is a hint read off 1024
     * samples, not a subject detector, and a backdrop yanked hard to
     * one edge is a worse mistake than one left in the middle.
     */
    const mean = bright.reduce((all, value) => all + value, 0) / bright.length;
    let weight = 0;
    let atX = 0;
    let atY = 0;
    bright.forEach((value, index) => {
      const pull = Math.abs(value - mean);
      weight += pull;
      atX += pull * ((index % side) + 0.5) / side;
      atY += pull * (Math.floor(index / side) + 0.5) / side;
    });
    const pulled = (share: number) => {
      const towards = 50 + (share * 100 - 50) * 0.7;
      return Math.max(20, Math.min(80, towards));
    };

    return {
      width,
      height,
      saturation: saturation / counted,
      luminance: luminance / counted,
      variety: colours.size / counted,
      focusX: weight > 0 ? pulled(atX / weight) : 50,
      focusY: weight > 0 ? pulled(atY / weight) : 50,
    };
  } catch {
    return null;
  }
}
