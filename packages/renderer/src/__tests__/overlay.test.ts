import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Who paints above whom inside one tile.
 *
 * This is a test about two stylesheets that are deliberately kept apart
 * — the renderer's, which prints, and the editor's chrome, which must
 * never reach a PDF — and it exists because the coupling between them
 * is real, invisible and silent when it breaks.
 *
 * What broke: the bleed work lifted `.tile__info` to `z-index: 20` and
 * the price mark to 30 so words and prices print above a packshot that
 * leaves its cell. Both are right. But the editor's `.handle` sat at
 * 10, so it went under them — and a press on a headline or a price
 * landed on the page's own markup instead of on the overlay. Nothing
 * looked wrong: the tile still selected, the panel still listed every
 * box, ⌫ still took one off the page. Only picking a box up and
 * double-clicking it stopped working, and only for the boxes that had
 * been raised. The artwork has no z-index, so panning the picture went
 * on working, which made it look like anything but a stacking bug.
 *
 * Nothing in either file can state this rule to the other, so it is
 * stated here instead. A new layer in the renderer fails this test
 * rather than quietly taking the pointer away from the editor.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** Every `z-index: N` a stylesheet declares. */
function layers(css: string): number[] {
  return [...css.matchAll(/^\s*z-index:\s*(-?\d+)\s*;/gm)].map((m) => Number(m[1]));
}

describe('tile stacking', () => {
  const page = layers(read('../styles.css'));
  const highest = Math.max(...page);

  const lifted = /const LIFTED = (\d+);/.exec(read('../OfferTile.tsx'));
  const handle = /\.handle\s*\{[^}]*?z-index:\s*(\d+)\s*;/s
    .exec(read('../../../../apps/studio/src/app.css'));

  it('the page declares the layers this test is about', () => {
    // A guard on the guard: if the renderer ever stops using z-index,
    // the comparisons below would pass vacuously and say nothing.
    expect(page.length).toBeGreaterThan(0);
  });

  /*
   * A box someone has moved carries an INLINE z-index, which beats
   * whatever the stylesheet gave it. Below the stylesheet's own highest
   * layer that is not a lift but a drop: the price mark went from 30 to
   * 6 and disappeared behind the words it was being dragged onto.
   */
  it('a moved box is lifted above every layer the page draws', () => {
    expect(lifted, 'OfferTile must declare LIFTED').not.toBeNull();
    expect(Number(lifted![1])).toBeGreaterThan(highest);
  });

  it('the editor overlay sits above even a moved box', () => {
    expect(handle, '.handle must declare a z-index').not.toBeNull();
    expect(Number(handle![1])).toBeGreaterThan(Number(lifted![1]));
  });
});
