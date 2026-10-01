import { describe, expect, it } from 'vitest';
import { addRows, measureRoom, stretch, type Box } from '../fill.js';

/*
 * SuperBrugsen W38, the vegetable page: a Madskole banner over the top
 * quarter, four products in two rows under it, and a third of the sheet
 * empty at the foot.
 */
const banner: Box = { x: 0.03, y: 0.01, w: 0.94, h: 0.26 };
const cells: Box[] = [
  { x: 0.03, y: 0.27, w: 0.46, h: 0.19 }, { x: 0.51, y: 0.27, w: 0.46, h: 0.19 },
  { x: 0.03, y: 0.47, w: 0.46, h: 0.19 }, { x: 0.51, y: 0.47, w: 0.46, h: 0.19 },
];
const logo: Box = { x: 0.05, y: 0.3, w: 0.06, h: 0.05 };

describe('the room a page leaves', () => {
  it('is the band under the products, to the side margin — a logo on a tile is not in the way', () => {
    const room = measureRoom(cells, [banner, logo])!;
    expect(room.from).toBeCloseTo(0.66);
    expect(room.to).toBeCloseTo(0.97);
    expect(room.free).toBeCloseTo(0.31);
    expect(room.rows).toBe(1);
    expect(room.perRow).toBe(2);
  });

  it('stops at a footer line under the products', () => {
    const footer: Box = { x: 0.1, y: 0.9, w: 0.8, h: 0.03 };
    const room = measureRoom(cells, [banner, footer])!;
    expect(room.to).toBeCloseTo(0.89);
  });

  it('stretched: the same arrangement, down to the foot', () => {
    const grown = stretch(cells, 0.97);
    expect(grown[0]!.y).toBeCloseTo(0.27);
    expect(grown[3]!.y + grown[3]!.h).toBeCloseTo(0.97);
    expect(grown[0]!.h).toBeGreaterThan(cells[0]!.h * 1.7);
  });

  it('more rows: two cells more, and every cell ends inside the page', () => {
    const { cells: moved, added } = addRows(cells, 0.97, 1);
    expect(added).toHaveLength(2);
    expect(added[0]!.x).toBeCloseTo(0.03);
    expect(added[1]!.x).toBeCloseTo(0.51);
    expect(Math.max(...[...moved, ...added].map((c) => c.y + c.h))).toBeCloseTo(0.97);
    // The new row stands under the old ones, not over them.
    expect(added[0]!.y).toBeGreaterThan(moved[2]!.y + moved[2]!.h);
  });
});
