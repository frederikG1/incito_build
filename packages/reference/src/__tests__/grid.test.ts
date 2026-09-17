import { describe, expect, it } from 'vitest';
import { blocks, gridOf, lattice, offerBlocks } from '../grid.js';
import type { PageItem, ReferencePage, Rect } from '../extract.js';

/**
 * The layout reader, on pages built by hand.
 *
 * No PDF anywhere: `readPage` turns a file into boxes and everything
 * after it is arithmetic on boxes, so the arithmetic is tested on boxes
 * a person can read. The real file is the other lane — `npm run
 * reference -- <fil.pdf> --overlay` draws what was found onto the page
 * it was found on, which is the only way to see that a reading is
 * right rather than merely consistent.
 *
 * Every case here is a page shape the book this was written against
 * actually prints.
 */

let painted = 0;

const text = (str: string, size: number, rect: Rect): PageItem =>
  ({ kind: 'text', rect, order: painted += 1, text: str, size });

const image = (rect: Rect): PageItem => ({ kind: 'image', rect, order: painted += 1 });

const page = (items: PageItem[]): ReferencePage =>
  ({ page: 1, width: 539, height: 746, items });

/**
 * One offer, as the chains set it: a packshot, the price over it, the
 * name under it and a line of fine print.
 */
function offer(x: number, y: number, w: number, h: number, name: string): PageItem[] {
  return [
    image({ x: x + w * 0.1, y: y + h * 0.05, w: w * 0.8, h: h * 0.5 }),
    text('49,-', 34, { x: x + w * 0.55, y: y + h * 0.3, w: w * 0.4, h: h * 0.22 }),
    text(name, 12, { x, y: y + h * 0.62, w: w * 0.9, h: h * 0.14 }),
    text('500 g. Kg-pris 98,00.', 8, { x, y: y + h * 0.8, w: w * 0.95, h: h * 0.1 }),
  ];
}

describe('reading a page', () => {
  it('finds one block per offer', () => {
    const found = blocks(page([
      ...offer(0.03, 0.05, 0.44, 0.4, 'Cheasy hytteost'),
      ...offer(0.53, 0.05, 0.44, 0.4, 'Danonino eller Actimel'),
      ...offer(0.03, 0.53, 0.44, 0.4, 'K-Salat pålægssalat'),
      ...offer(0.53, 0.53, 0.44, 0.4, 'Coop bacon'),
    ]));
    expect(found).toHaveLength(4);
  });

  it('keeps a price with the words it prices', () => {
    // The whole point of the weld: the cut is made on type, and an
    // offer's type comes in two lumps with the product between them.
    const found = blocks(page(offer(0.03, 0.05, 0.44, 0.4, 'Cheasy hytteost')));
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toContain('49,-');
    expect(found[0]!.text).toContain('Cheasy hytteost');
  });

  it('does not weld one offer to the next', () => {
    // Two offers side by side look exactly like a price beside its own
    // text — a row, with artwork in the alley. Welding on geometry
    // alone put all four offers on a real front page into one region.
    const found = blocks(page([
      ...offer(0.03, 0.3, 0.44, 0.4, 'Cheasy hytteost'),
      ...offer(0.53, 0.3, 0.44, 0.4, 'Danonino eller Actimel'),
    ]));
    expect(found).toHaveLength(2);
  });

  it('welds a bare number standing beside its own words', () => {
    // The other arrangement the same book prints two pages later.
    const found = blocks(page([
      image({ x: 0.30, y: 0.30, w: 0.14, h: 0.20 }),
      text('10,-', 44, { x: 0.44, y: 0.33, w: 0.18, h: 0.13 }),
      text('Knorr sauce, bouillon', 12, { x: 0.08, y: 0.38, w: 0.20, h: 0.05 }),
      text('Flere varianter. 28-40 g.', 8, { x: 0.08, y: 0.44, w: 0.20, h: 0.04 }),
    ]));
    expect(found).toHaveLength(1);
  });

  it('reads the grid the offers sit on', () => {
    const reading = gridOf(page([
      ...offer(0.03, 0.05, 0.44, 0.4, 'Cheasy hytteost'),
      ...offer(0.53, 0.05, 0.44, 0.4, 'Danonino eller Actimel'),
      ...offer(0.03, 0.53, 0.44, 0.4, 'K-Salat pålægssalat'),
      ...offer(0.53, 0.53, 0.44, 0.4, 'Coop bacon'),
    ]));
    expect(reading).not.toBeNull();
    expect(reading!.columns).toBe(2);
    expect(reading!.rows).toBe(2);
    expect(reading!.areas).toEqual(['a b', 'c d']);
    // Read, not fitted: a page laid out on the lattice it is drawn on
    // lands on it to within a rounding error.
    expect(reading!.fit).toBeLessThan(0.02);
  });

  it('gives a lead offer the cells it spans', () => {
    const reading = gridOf(page([
      ...offer(0.03, 0.05, 0.94, 0.45, 'Coop kartofler'),
      ...offer(0.03, 0.55, 0.44, 0.4, 'K-Salat pålægssalat'),
      ...offer(0.53, 0.55, 0.44, 0.4, 'Coop bacon'),
    ]));
    expect(reading!.areas).toEqual(['a a', 'b c']);
  });

  it('leaves a full-width band out of the grid', () => {
    // A footer is on the page without being in its grid, and fitted
    // alongside the offers it drags the lattice off every line the page
    // is actually on.
    const footer = [
      text('Gælder fra fredag 18. september', 9, { x: 0.02, y: 0.9, w: 0.9, h: 0.03 }),
      text('Husk at indløse dine samlemærker', 22, { x: 0.02, y: 0.94, w: 0.96, h: 0.05 }),
      text('søndag og mandag', 9, { x: 0.3, y: 0.96, w: 0.3, h: 0.02 }),
    ];
    const sheet = page([
      ...offer(0.03, 0.05, 0.44, 0.4, 'Cheasy hytteost'),
      ...offer(0.53, 0.05, 0.44, 0.4, 'Danonino eller Actimel'),
      ...footer,
    ]);

    expect(blocks(sheet).length).toBeGreaterThan(2);
    expect(offerBlocks(blocks(sheet))).toHaveLength(2);
    expect(gridOf(sheet)!.areas).toEqual(['a b']);
  });

  it('says so when the blocks are on no common grid', () => {
    const scattered = [
      { x: 0.02, y: 0.03, w: 0.3, h: 0.2 },
      { x: 0.41, y: 0.28, w: 0.17, h: 0.31 },
      { x: 0.63, y: 0.07, w: 0.26, h: 0.11 },
      { x: 0.11, y: 0.66, w: 0.44, h: 0.09 },
    ];
    // Nothing lines up with anything, and a reader that answers anyway
    // is worse than one that does not: the page goes to the stage that
    // can look at it.
    expect(lattice(scattered, { maxTracks: 4 })).toBeNull();
  });

  it('reports how hard the lattice had to work', () => {
    // A leaflet's lead artwork runs past its own cell on purpose — the
    // repo already models it as `bleedPercent` — so one edge of the
    // biggest offer lands wherever the photograph ended. The grid is
    // still the grid; the overrun is reported rather than rejected.
    const rects = [
      { x: 0.00, y: 0.00, w: 0.5, h: 0.5 },
      { x: 0.50, y: 0.00, w: 0.5, h: 0.5 },
      { x: 0.00, y: 0.50, w: 0.5, h: 0.5 },
      { x: 0.38, y: 0.50, w: 0.62, h: 0.5 },
    ];
    const fitted = lattice(rects, { maxTracks: 4 });
    expect(fitted!.columns).toBe(2);
    expect(fitted!.fit).toBeGreaterThan(0.05);
  });
});
