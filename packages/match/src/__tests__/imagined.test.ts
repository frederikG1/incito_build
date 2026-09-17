import { describe, expect, it } from 'vitest';
import { DEFAULT_CELLS, layoutPrompt } from '../imagined.js';

/**
 * The prompt is the whole of this feature that can be tested without
 * billing: everything after it is `matchPage`, which has its own tests,
 * and the drawing in between costs money on every image model Gemini
 * offers. So what is pinned here is the part that decides whether the
 * drawing comes back readable — and every assertion below stands for a
 * way it came back unreadable while this was being written.
 */
describe('the prompt an image model is given for a layout', () => {
  it('asks for the number of cells it was told, not a vague "a few"', () => {
    expect(layoutPrompt({ cells: 4 })).toContain('exactly 4 product cells');
    expect(layoutPrompt()).toContain(`exactly ${DEFAULT_CELLS} product cells`);
  });

  /*
   * A drawing with invented Danish product names gives the casting step
   * something to match the feed against that does not exist in it — and
   * it dutifully matches it, then the validation throws the offer away
   * and the cell prints empty.
   */
  it('forbids lettering, which is what makes the drawing castable', () => {
    expect(layoutPrompt()).toContain('NO lettering');
  });

  it('draws on the chain\'s own ground when it is given one', () => {
    expect(layoutPrompt({ ground: '#fff1b8' })).toContain('flat #fff1b8 background');
    expect(layoutPrompt()).toContain('one flat pale background colour');
  });

  /*
   * The editor's words are added to the standing prompt, never instead
   * of it — the same bargain `--style` makes in `@incitio/decor`. What
   * follows them is the part that keeps the drawing readable, so it has
   * the last word.
   */
  it('folds the editor\'s own words in without letting them replace the craft', () => {
    const prompt = layoutPrompt({ note: 'én stor vare øverst' });
    expect(prompt).toContain('én stor vare øverst');
    expect(prompt.indexOf('én stor vare øverst')).toBeLessThan(prompt.indexOf('NO lettering'));
    expect(prompt).toContain('exactly 6 product cells');
  });
});
