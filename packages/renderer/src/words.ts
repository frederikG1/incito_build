import type { MeasuredRect } from '@incitio/schema';

/** Breathing room between the last letter and the price mark, in shares of the cell. */
const GAP = 0.015;

/**
 * The text column of a measured tile, with the price mark taken out of it.
 *
 * A tile read off a publication carries two boxes: where the words
 * were printed and where the price mark was. They overlap — on
 * SuperBrugsen's pages the words box runs the height of the tile and
 * the mark sits in its bottom-right corner — because the printed name
 * happened to be short enough to stop before the mark. This week's
 * name is not the printed one, so the column is narrowed to end where
 * the mark begins, the way the designer would have set it.
 *
 * Only sideways, and only when the mark stands at one side of the
 * column: a mark over the middle is a design where the words go above
 * it, and cutting the column in half there would be worse than the
 * overlap. Never narrower than half the measured column, for the same
 * reason.
 */
export function wordsBesidePrice(words: MeasuredRect, price: MeasuredRect | undefined): MeasuredRect {
  if (!price) return words;
  const across = Math.min(words.x + words.w, price.x + price.w) - Math.max(words.x, price.x);
  const down = Math.min(words.y + words.h, price.y + price.h) - Math.max(words.y, price.y);
  if (across <= 0 || down <= 0) return words;

  const onRight = price.x + price.w / 2 > words.x + words.w / 2;
  if (onRight) {
    const w = price.x - GAP - words.x;
    return w >= words.w / 2 ? { ...words, w } : words;
  }
  const x = price.x + price.w + GAP;
  const w = words.x + words.w - x;
  return w >= words.w / 2 ? { ...words, x, w } : words;
}
