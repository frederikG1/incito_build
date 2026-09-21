import { describe, expect, it } from 'vitest';
import { LAYOUT_SYSTEM, validateLayout } from '../layout.js';

/**
 * What the model is allowed to come back with when it measures its own
 * composition.
 *
 * This is where a bad reading becomes a product in the wrong place, and
 * the numbers are the only thing standing between the two: an index
 * naming no product, the same one read twice, a width of zero that
 * would make a packshot disappear off the page.
 */
describe('a composition, measured', () => {
  it('keeps a clean reading, in the products\' own order', () => {
    const said = validateLayout(3, {
      products: [
        { index: 3, cx: 0.8, cy: 0.5, width: 0.3, rotate: 0 },
        { index: 1, cx: 0.2, cy: 0.5, width: 0.4, rotate: -4 },
      ],
    });
    expect(said.products.map((p) => p.index)).toEqual([1, 3]);
    // No `bottom` in the answer: it falls back to a fifth of the
    // picture under the centre, which is a guess and says so by being
    // exactly that — see `validateLayout`.
    expect(said.products[0]).toEqual({
      index: 1, cx: 0.2, cy: 0.5, width: 0.4, bottom: 0.7, rotate: -4,
    });
  });

  /* Named, not counted: they are left where they were and the editor
     has to be able to say which ones did not move. */
  it('says which products it could not find', () => {
    expect(validateLayout(3, { products: [{ index: 2, cx: 0.5, cy: 0.5, width: 0.3 }] }).missing)
      .toEqual([1, 3]);
  });

  it('ignores an index that names no product', () => {
    const said = validateLayout(2, {
      products: [
        { index: 9, cx: 0.5, cy: 0.5, width: 0.3, rotate: 0 },
        { index: 0, cx: 0.5, cy: 0.5, width: 0.3, rotate: 0 },
        { index: 1, cx: 0.5, cy: 0.5, width: 0.3, rotate: 0 },
      ],
    });
    expect(said.products.map((p) => p.index)).toEqual([1]);
  });

  it('takes the first reading of a product and drops a second', () => {
    const said = validateLayout(2, {
      products: [
        { index: 1, cx: 0.2, cy: 0.5, width: 0.3, rotate: 0 },
        { index: 1, cx: 0.9, cy: 0.5, width: 0.3, rotate: 0 },
      ],
    });
    expect(said.products).toHaveLength(1);
    expect(said.products[0]!.cx).toBe(0.2);
  });

  /*
   * A width of zero makes a packshot vanish and a width of three makes
   * one product the whole page. Both are readings, not layouts.
   */
  it('will not read a product into nothing or into everything', () => {
    const said = validateLayout(2, {
      products: [
        { index: 1, cx: -3, cy: 9, width: 0, rotate: 200 },
        { index: 2, cx: 0.5, cy: 0.5, width: 40, rotate: 0 },
      ],
    });
    // The bottom cannot sit above the centre it belongs to, whatever
    // the answer said — a product standing on its own head is a misread.
    expect(said.products[0]).toEqual({
      index: 1, cx: 0, cy: 1, width: 0.02, bottom: 1.2, rotate: 45,
    });
    expect(said.products[1]!.width).toBe(1.5);
  });

  it('falls back rather than writing NaN onto a page', () => {
    const said = validateLayout(1, { products: [{ index: 1, cx: 'left', width: null }] });
    expect(said.products[0]).toEqual({
      index: 1, cx: 0.5, cy: 0.5, width: 0.3, bottom: 0.7, rotate: 0,
    });
  });

  it('survives an answer that is not an answer', () => {
    expect(validateLayout(2, null)).toEqual({ products: [], missing: [1, 2] });
    expect(validateLayout(2, { products: 'none' }).missing).toEqual([1, 2]);
  });
});

describe('the prompt that measures it', () => {
  /*
   * The instruction that makes the numbers usable: a product half
   * hidden behind another still has to be reported WHOLE, or rebuilding
   * the composition from the cutouts shrinks whatever was overlapped.
   */
  it('asks for the whole product, not the visible part', () => {
    expect(LAYOUT_SYSTEM).toContain('report where the\nWHOLE pack would be');
  });

  it('asks it to leave out what it cannot find rather than guess', () => {
    expect(LAYOUT_SYSTEM).toContain('leave it out of the list rather than guessing');
  });

  it('asks for numbers and nothing else', () => {
    expect(LAYOUT_SYSTEM).toContain('Report numbers only');
  });
});
