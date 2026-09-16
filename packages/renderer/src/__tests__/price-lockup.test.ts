import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The price mark and the words it prices are one block.
 *
 * The mark is a child of `.tile__info`: on a wide cell it is that
 * block's right-hand column and the two end on one line, on a narrow
 * one it stands on the block's top edge and leans over the artwork.
 * Either way the pairing is structural — there is no measurement
 * keeping the two in step and no cell for a layout to forget.
 *
 * It was not always. Pinned to the artwork box at 6% of its height, the
 * distance from a number to its own sentence was whatever the picture
 * above happened to be tall: measured across one rebuilt page, 61px on
 * one tile and 231px on the next, and the loose ones read as prices
 * belonging to no offer at all. This test is here so that cannot come
 * back quietly — every part of it is a line that was wrong once.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const tile = read('../OfferTile.tsx');
const css = read('../styles.css')
  // Comments out first: this stylesheet explains itself at length, and
  // a paragraph above a rule is part of its selector to a regex that
  // does not know better.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of the rule written for exactly this selector.
 *
 * Exactly, not "ends with": `.price` and `.slot[data-room='wide']
 * .price` are two different rules saying different things, and a
 * suffix match reads the wrong one — which it did, and the test passed
 * on a file that said the opposite of what it asserted.
 */
function rule(selector: string): string {
  const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head!.split(',').some((one) => one.trim() === selector))
    .map(([, , body]) => body!);
  return bodies.join('\n');
}

describe('price lockup', () => {
  it('draws the mark inside the text block', () => {
    const block = tile.indexOf('className="tile__info"');
    const mark = tile.indexOf('className={`price price--');
    const tags = tile.indexOf('className="tile__tags"');
    expect(block, 'the text block must exist').toBeGreaterThan(-1);
    expect(mark, 'the mark must be rendered after the block opens').toBeGreaterThan(block);
    expect(mark, 'the mark must be rendered before the block closes').toBeLessThan(tags);
  });

  it('keeps the sentences in a box of their own', () => {
    // The mark spans the block beside the words; without this wrapper
    // it had to span a row count nobody knows in advance, and
    // `1 / -1` does not reach implicit rows — it resolved to the first
    // line alone and stood level with the product name.
    expect(tile).toContain('className="tile__words"');
    expect(rule('.tile__info')).toMatch(/grid-template-columns/);
    expect(rule('.price')).toMatch(/grid-column:\s*2/);
  });

  it('clips the sentences, never the block', () => {
    // The clip is the guard against a long product name pushing its
    // last line out of the tile, and it used to sit on the block. The
    // mark lives there now and leans out of it by design — on a narrow
    // cell over the artwork, on a wide one a few pixels above the words
    // — so a box that cuts everything leaving it cut the mark too.
    expect(rule('.tile__words')).toMatch(/overflow:\s*hidden/);
    expect(rule('.tile__info')).not.toMatch(/overflow:\s*hidden/);
  });

  it('states both arrangements', () => {
    // Wide: in the flow, in column two, ending on the block's last
    // line. Tight: out of the flow, standing on its top edge. Which one
    // a cell gets is `slotRoom`, answered from the template.
    expect(rule('.price')).toMatch(/align-self:\s*end/);
    expect(rule(".slot[data-room='tight'] .price")).toMatch(/position:\s*absolute/);
  });

  it('caps the mark against the cell it stands in, beside the words', () => {
    // A role's mark is set in `cqh` against the PAGE, so it is the same
    // number of pixels in a half-page hero and in a narrow column.
    // Sharing a line with a sentence, every pixel it takes is one the
    // product name does not get — and it took 48% of a nemlig hero,
    // setting "Vindheks - Calocephalus" as "Vind- heks -…".
    expect(rule(".slot[data-room='wide'] .price")).toMatch(/font-size:\s*min\(/);
    expect(rule(".slot[data-room='wide'] .price")).toContain('--cell-w');
  });
});
