import { describe, expect, it } from 'vitest';
import {
  clipRect, coverage, inkGrid, largestEmptyCells, largestEmptyRect, rectArea, unionArea,
  type Rect,
} from '../measure.js';

const box = (left: number, top: number, right: number, bottom: number): Rect =>
  ({ left, top, right, bottom });

const PAGE = box(0, 0, 100, 100);

describe('unionArea', () => {
  it('is nothing for nothing', () => {
    expect(unionArea([])).toBe(0);
  });

  it('adds up boxes that do not touch', () => {
    expect(unionArea([box(0, 0, 10, 10), box(20, 20, 30, 30)])).toBe(200);
  });

  /*
   * The reason this is a union and not a sum: a price mark sits ON its
   * product by design, so summing would report the tiles that overlap
   * most as the fullest ones.
   */
  it('counts an overlap once', () => {
    expect(unionArea([box(0, 0, 10, 10), box(5, 5, 15, 15)])).toBe(175);
  });

  it('counts a box inside another box once', () => {
    expect(unionArea([box(0, 0, 10, 10), box(2, 2, 4, 4)])).toBe(100);
  });

  it('is unchanged by repeating a box', () => {
    const one = box(3, 7, 19, 23);
    expect(unionArea([one, one, one])).toBe(rectArea(one));
  });

  it('ignores a box with no area', () => {
    expect(unionArea([box(0, 0, 10, 10), box(5, 5, 5, 40)])).toBe(100);
  });

  it('merges a row of boxes that share edges', () => {
    expect(unionArea([box(0, 0, 10, 10), box(10, 0, 20, 10), box(20, 0, 30, 10)])).toBe(300);
  });
});

describe('clipRect', () => {
  it('cuts a box down to the one it sits in', () => {
    expect(clipRect(box(-10, -10, 50, 50), PAGE)).toEqual(box(0, 0, 50, 50));
  });

  it('gives an empty box when they do not meet', () => {
    expect(rectArea(clipRect(box(200, 200, 300, 300), PAGE))).toBe(0);
  });
});

describe('coverage', () => {
  it('is 1 for a box that is entirely filled', () => {
    expect(coverage(PAGE, [PAGE])).toBe(1);
  });

  it('never exceeds 1, however far the artwork overruns', () => {
    // Artwork is allowed out of its cell — see `--fill` in styles.css —
    // so the parts handed in regularly reach past the slot.
    expect(coverage(PAGE, [box(-50, -50, 150, 150)])).toBe(1);
  });

  it('measures the part that is actually inside', () => {
    expect(coverage(PAGE, [box(50, 0, 150, 100)])).toBeCloseTo(0.5);
  });

  it('is 0 for an empty cell', () => {
    expect(coverage(PAGE, [])).toBe(0);
  });
});

describe('largestEmptyRect', () => {
  it('is the whole box when nothing is on it', () => {
    expect(largestEmptyRect(PAGE, [])).toEqual(PAGE);
  });

  it('is nothing when everything is covered', () => {
    expect(largestEmptyRect(PAGE, [PAGE])).toBeNull();
  });

  /*
   * The shape someone draws on a proof when they say there is too much
   * air: a page with a band of products across its middle has one empty
   * block above and one below, and the bigger of the two is the finding.
   */
  it('finds the band above a strip of products', () => {
    const band = box(0, 60, 100, 80);
    expect(largestEmptyRect(PAGE, [band])).toEqual(box(0, 0, 100, 60));
  });

  it('answers with a rectangle, not with the leftover area', () => {
    /*
     * Four small marks near the corners leave 98% of the page bare, but
     * no RECTANGLE can have more than the band between them: 100 × 72.
     * That gap between "how much is empty" and "how much is empty in
     * one piece" is the whole reason this measure exists beside
     * `coverage`.
     */
    const marks = [
      box(10, 10, 14, 14), box(86, 10, 90, 14),
      box(10, 86, 14, 90), box(86, 86, 90, 90),
    ];
    const found = largestEmptyRect(PAGE, marks)!;
    expect(rectArea(found)).toBe(7200);
    for (const mark of marks) expect(rectArea(clipRect(mark, found))).toBe(0);
  });

  it('never returns a rectangle that touches an obstacle', () => {
    const obstacles = [box(20, 0, 40, 100), box(60, 0, 80, 100)];
    const found = largestEmptyRect(PAGE, obstacles)!;
    for (const o of obstacles) expect(rectArea(clipRect(o, found))).toBe(0);
    // Three equal columns are left; any of them is a correct answer.
    expect(rectArea(found)).toBe(20 * 100);
  });

  it('stays inside the bounds it was given', () => {
    const found = largestEmptyRect(box(10, 10, 90, 90), [box(0, 0, 100, 40)])!;
    expect(found).toEqual(box(10, 40, 90, 90));
  });

  it('ignores an obstacle that is not on the page at all', () => {
    expect(largestEmptyRect(PAGE, [box(200, 200, 300, 300)])).toEqual(PAGE);
  });
});

describe('largestEmptyCells', () => {
  const grid = (rows: string[]) => rows.map((row) => [...row].map((c) => c === '#'));

  it('is nothing for an empty grid', () => {
    expect(largestEmptyCells([])).toBeNull();
  });

  it('is the whole grid when there is no ink', () => {
    expect(largestEmptyCells(grid(['...', '...']))).toEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it('is nothing when the grid is full', () => {
    expect(largestEmptyCells(grid(['##', '##']))).toBeNull();
  });

  it('finds the band above a strip of ink', () => {
    expect(largestEmptyCells(grid([
      '....',
      '....',
      '####',
      '....',
    ]))).toEqual({ x: 0, y: 0, width: 4, height: 2 });
  });

  it('finds a block that is not against an edge', () => {
    expect(largestEmptyCells(grid([
      '#####',
      '#...#',
      '#...#',
      '#####',
    ]))).toEqual({ x: 1, y: 1, width: 3, height: 2 });
  });
});

/*
 * The two measures have to agree, or the threshold is meaningless.
 *
 * A generated page is measured exactly, from rectangles; a chain's own
 * printed page can only be measured by sampling pixels. Comparing one
 * against the other is only fair if the sampled answer lands on the
 * exact one — so the grid the pixel side uses is pinned here against
 * the geometry the layout side uses.
 */
describe('the raster agrees with the exact measure', () => {
  const PAGE_COLUMNS = 100;
  const PAGE_ROWS = 140;

  const cases: [string, Rect[]][] = [
    ['a band across the middle', [box(0, 60, 100, 80)]],
    ['two columns of product', [box(20, 0, 40, 100), box(60, 0, 80, 100)]],
    ['a masthead and a row of tiles', [
      box(0, 0, 100, 12), box(4, 55, 30, 90), box(36, 55, 62, 90), box(68, 55, 94, 90),
    ]],
  ];

  for (const [name, obstacles] of cases) {
    it(name, () => {
      const exact = largestEmptyRect(PAGE, obstacles)!;
      const cells = largestEmptyCells(inkGrid(PAGE, obstacles, PAGE_COLUMNS, PAGE_ROWS))!;
      const sampled = (cells.width / PAGE_COLUMNS) * (cells.height / PAGE_ROWS) * rectArea(PAGE);
      expect(Math.abs(sampled - rectArea(exact)) / rectArea(PAGE)).toBeLessThan(0.02);
    });
  }
});
