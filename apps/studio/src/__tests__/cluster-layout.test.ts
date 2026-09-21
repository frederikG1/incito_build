import { describe, expect, it } from 'vitest';
import {
  planCluster, reviewCluster, snapToBaseline,
  type MeasuredProduct, type PlacedProduct,
} from '../cluster-layout.js';

/** A cell 400×300 at the page's origin, on a 1000×1400 page. */
const media = { left: 0, top: 0, width: 400, height: 300 };
const page = { width: 1000, height: 1400 };

const stands = (over: Partial<MeasuredProduct> = {}): MeasuredProduct => ({
  cx: 200, cy: 150, width: 100, rotate: 0, aspect: 1, driftX: 0, driftY: 0,
  already: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0 },
  ...over,
});

const read = (over: Partial<PlacedProduct> & { index: number }): PlacedProduct =>
  ({ cx: 0.5, cy: 0.5, width: 0.3, rotate: 0, ...over });

describe('rebuilding a composition on the page', () => {
  it('fits the group, not the picture, so the white around it is not printed', () => {
    // Two squares in the middle third of a square picture: the group is
    // 0.4 wide and 0.2 tall, and the cell is 400×300 — so width binds,
    // every product comes out 0.2/0.4 × 400 = 200 wide, and the pair
    // sits centred on the cell.
    const { patches } = planCluster({
      media,
      page,
      picture: 1,
      placed: [read({ index: 1, cx: 0.4, width: 0.2 }), read({ index: 2, cx: 0.6, width: 0.2 })],
      measured: [stands(), stands()],
    });
    expect(patches.get(0)!.scale).toBeCloseTo(2);
    // 200px wide each, so the left one wants its centre at x = 100.
    expect(patches.get(0)!.offsetX).toBeCloseTo(((100 - 200) / 1000) * 100);
    expect(patches.get(1)!.offsetX).toBeCloseTo(((300 - 200) / 1000) * 100);
    expect(patches.get(0)!.offsetY).toBeCloseTo(0);
  });

  it('reads a square picture as a square, whatever shape the cell is', () => {
    // The same reading, once as a square picture and once as a wide
    // one. A picture twice as wide holds the same fractions at half the
    // vertical stretch, so the two must not come out alike.
    const placed = [read({ index: 1, cx: 0.3, cy: 0.3 }), read({ index: 2, cx: 0.7, cy: 0.7 })];
    const { patches: square } = planCluster({ media, page, picture: 1, placed, measured: [stands(), stands()] });
    const { patches: wide } = planCluster({ media, page, picture: 2, placed, measured: [stands(), stands()] });
    // The same fractions on a picture twice as wide are a group half as
    // tall for its width — a different composition, and the one the
    // file actually holds. Reading both the same way is the bug.
    expect(square.get(0)!.offsetY).not.toBeCloseTo(wide.get(0)!.offsetY);
    expect(square.get(0)!.offsetX).not.toBeCloseTo(wide.get(0)!.offsetX);
    // What must not change is the shape: a square picture puts the pair
    // on a diagonal, so its two products differ as much down as across.
    const down = Math.abs(square.get(0)!.offsetY - square.get(1)!.offsetY);
    const across = Math.abs(square.get(0)!.offsetX - square.get(1)!.offsetX);
    expect(down * page.height).toBeCloseTo(across * page.width);
  });

  it('scales by the drawn artwork, so a letterboxed cutout is not made tiny', () => {
    // Same reading, same element, but the artwork drawn at half the
    // width: the correction has to be twice as big.
    const { patches: one } = planCluster({
      media, page, picture: 1, placed: [read({ index: 1 }), read({ index: 2, cx: 0.8 })],
      measured: [stands({ width: 150 }), stands()],
    });
    const { patches: third } = planCluster({
      media, page, picture: 1, placed: [read({ index: 1 }), read({ index: 2, cx: 0.8 })],
      measured: [stands({ width: 75 }), stands()],
    });
    expect(third.get(0)!.scale).toBeCloseTo(one.get(0)!.scale * 2);
  });

  it('gives a tall cutout the height its own proportions ask for', () => {
    // One product, read as half the picture wide. A bottle three times
    // taller than it is wide needs 1.5 of the picture's height, so the
    // fit is bound by the cell's height rather than its width.
    const { patches } = planCluster({
      media, page, picture: 1,
      placed: [read({ index: 1, width: 0.5 })],
      measured: [stands({ aspect: 1 / 3 })],
    });
    // 0.5 wide × 1.5 tall against 400×300: height binds at 300/1.5 = 200,
    // so the product draws 0.5 × 200 = 100 wide — the width it already is.
    expect(patches.get(0)!.scale).toBeCloseTo(1);
  });

  it('writes the difference in rotation, not the total', () => {
    // A fan already turns this one 6°, and the picture shows it at 10°.
    const { patches } = planCluster({
      media, page, picture: 1,
      placed: [read({ index: 1, rotate: 10 }), read({ index: 2, cx: 0.8 })],
      measured: [stands({ rotate: 6 }), stands()],
    });
    expect(patches.get(0)!.rotate).toBeCloseTo(4);
  });

  it('adds to the corrections already on a product, so twice converges', () => {
    // Standing where it should already be, with a nudge on it: the
    // nudge survives and nothing else is asked for.
    const { patches } = planCluster({
      media, page, picture: 4 / 3,
      placed: [read({ index: 1, cx: 0.5, cy: 0.5, width: 0.3 })],
      measured: [stands({ already: { offsetX: 5, offsetY: -2, scale: 1.4, rotate: 0 } })],
    });
    expect(patches.get(0)!.offsetX).toBeCloseTo(5);
    expect(patches.get(0)!.offsetY).toBeCloseTo(-2);
  });

  it('skips a product the page could not measure, and says nothing about it', () => {
    const { patches } = planCluster({
      media, page, picture: 1,
      placed: [read({ index: 1 }), read({ index: 2, cx: 0.8 })],
      measured: [null, stands()],
    });
    expect(patches.has(0)).toBe(false);
    expect(patches.has(1)).toBe(true);
  });

  it('clamps rather than drops a correction that runs past the limits', () => {
    const { patches } = planCluster({
      media: { left: 0, top: 0, width: 30000, height: 9000 },
      page, picture: 1,
      placed: [read({ index: 1, cx: 0.05 }), read({ index: 2, cx: 0.95 })],
      measured: [stands(), stands()],
    });
    // A cell ten times the page's own width asks for a move nobody may
    // make; it comes back at the limit rather than not at all.
    expect(patches.get(0)!.offsetX).toBe(100);
    expect(patches.get(0)!.scale).toBe(3);
  });
});

describe('the ghost of the picture', () => {
  it('lands where the composition was mapped, so it lies on the rebuild', () => {
    // One product, dead centre, a third of a square picture wide.
    const { frame, patches } = planCluster({
      media: { left: 0, top: 0, width: 400, height: 300 },
      page: { width: 1000, height: 1400 },
      picture: 1,
      placed: [{ index: 1, cx: 0.5, cy: 0.5, width: 1 / 3, rotate: 0 }],
      measured: [stands()],
    });
    // The product is a third of the picture, and its box fills the
    // cell's height — so the picture is three times as tall as the cell.
    expect(frame!.height).toBeCloseTo(3);
    expect(frame!.width).toBeCloseTo((3 * 300) / 400);
    // Centred: the product sits in the middle of both.
    expect(frame!.left + frame!.width / 2).toBeCloseTo(0.5);
    expect(frame!.top + frame!.height / 2).toBeCloseTo(0.5);
    expect(patches.get(0)!.scale).toBeCloseTo(3);
  });

  it('has no frame to draw when nothing could be placed', () => {
    expect(planCluster({
      media: { left: 0, top: 0, width: 400, height: 300 },
      page: { width: 1000, height: 1400 },
      picture: 1,
      placed: [{ index: 1, cx: 0.5, cy: 0.5, width: 0.3, rotate: 0 }],
      measured: [null],
    }).frame).toBeNull();
  });
});

describe('a composition that reorders the pack', () => {
  it('lets two products swap ends of the cell', () => {
    // The stylesheet has them left-to-right; the picture has them the
    // other way round. Rebuilding it means each crosses the whole cell,
    // and no limit may cut that in half — it is the composition.
    const media = { left: 0, top: 0, width: 700, height: 400 };
    const { patches } = planCluster({
      media,
      page: { width: 760, height: 1070 },
      picture: 1.4,
      placed: [
        { index: 1, cx: 0.8, cy: 0.5, width: 0.3, rotate: 0 },
        { index: 2, cx: 0.2, cy: 0.5, width: 0.3, rotate: 0 },
      ],
      measured: [
        { cx: 120, cy: 200, width: 180, rotate: 0, aspect: 0.7, driftX: 0, driftY: 0, already: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0 } },
        { cx: 580, cy: 200, width: 180, rotate: 0, aspect: 0.7, driftX: 0, driftY: 0, already: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0 } },
      ],
    });
    // Each crosses: the left-hand one goes right, the right-hand one left.
    expect(patches.get(0)!.offsetX).toBeGreaterThan(40);
    expect(patches.get(1)!.offsetX).toBeLessThan(-40);
    // And neither is sitting on a limit.
    expect(Math.abs(patches.get(0)!.offsetX)).toBeLessThan(100);
    expect(Math.abs(patches.get(1)!.offsetX)).toBeLessThan(100);
  });
});

describe('a product that is not in the middle of its own picture', () => {
  it('does not slide away as it is resized', () => {
    // The cutout sits 30px right of its element's centre at the size it
    // is drawn now, and the composition wants it twice as big. Grown
    // about the picture's centre it would carry another 30px right, so
    // the move has to give that back.
    const media = { left: 0, top: 0, width: 400, height: 300 };
    const page = { width: 1000, height: 1400 };
    const centred = planCluster({
      media, page, picture: 1,
      placed: [{ index: 1, cx: 0.5, cy: 0.5, width: 0.5, rotate: 0 }],
      measured: [{
        cx: 200, cy: 150, width: 100, rotate: 0, aspect: 1, driftX: 0, driftY: 0,
        already: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0 },
      }],
    });
    const adrift = planCluster({
      media, page, picture: 1,
      placed: [{ index: 1, cx: 0.5, cy: 0.5, width: 0.5, rotate: 0 }],
      measured: [{
        cx: 200, cy: 150, width: 100, rotate: 0, aspect: 1, driftX: 30, driftY: 0,
        already: { offsetX: 0, offsetY: 0, scale: 1, rotate: 0 },
      }],
    });
    const grows = centred.patches.get(0)!.scale;
    expect(adrift.patches.get(0)!.scale).toBeCloseTo(grows);
    // The same target, reached from the same place — minus what growing
    // is about to add.
    expect(adrift.patches.get(0)!.offsetX - centred.patches.get(0)!.offsetX)
      .toBeCloseTo((30 * (1 - grows) / page.width) * 100);
  });
});

describe('standing the group on one line', () => {
  const want = (index: number, cy: number, height = 0.5, width = 0.2) =>
    ({ index, cx: 0.2 + index * 0.3, cy, width, height });

  it('makes bottoms that are nearly equal exactly equal', () => {
    // Three products a per cent or two apart — a shelf, read with noise.
    const row = [want(0, 0.500), want(1, 0.508), want(2, 0.494)];
    snapToBaseline(row);
    const bottoms = row.map((entry) => entry.cy + entry.height / 2);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeCloseTo(0, 10);
    // And it lands on the row's own average, not on its lowest edge.
    expect(bottoms[0]).toBeCloseTo((0.500 + 0.508 + 0.494) / 3 + 0.25, 6);
  });

  it('leaves a cascade alone — it is a shape, not a mistake', () => {
    // Tubs climbing away from the reader: each a tenth of a cell higher.
    const cascade = [want(0, 0.70), want(1, 0.58), want(2, 0.46)];
    const before = cascade.map((entry) => entry.cy);
    snapToBaseline(cascade);
    expect(cascade.map((entry) => entry.cy)).toEqual(before);
  });

  it('pulls a stray product onto the line without moving the rest', () => {
    const row = [want(0, 0.50), want(1, 0.50), want(2, 0.53)];
    snapToBaseline(row);
    const bottoms = row.map((entry) => entry.cy + entry.height / 2);
    expect(bottoms[2]).toBeCloseTo(bottoms[0]!, 10);
  });

  it('keeps a product that is genuinely standing behind where it is', () => {
    // Half a product's height above the shelf is a back row, not noise.
    const row = [want(0, 0.70), want(1, 0.70), want(2, 0.45)];
    snapToBaseline(row);
    expect(row[2]!.cy).toBe(0.45);
    expect(row[0]!.cy + 0.25).toBeCloseTo(row[1]!.cy + 0.25, 10);
  });
});

describe('saying what is wrong with an arrangement', () => {
  const want = (index: number, cx: number, width = 0.2, height = 0.4) =>
    ({ index, cx, cy: 0.5, width, height });

  it('is quiet about an arrangement a leaflet would print', () => {
    expect(reviewCluster([want(0, 0.2), want(1, 0.5), want(2, 0.8)])).toEqual([]);
  });

  it('names a product that swallows its neighbour', () => {
    const said = reviewCluster([want(0, 0.40), want(1, 0.46)]);
    expect(said[0]!.said).toMatch(/dækker \d+ % af vare 2/);
  });

  it('names a product drawn out of all proportion', () => {
    const said = reviewCluster([
      want(0, 0.2), want(1, 0.5), want(2, 0.8, 0.2, 1.1),
    ]);
    expect(said.some((entry) => /højere end de andre/.test(entry.said))).toBe(true);
  });

  it('catches the litre drawn smaller than the tub', () => {
    // 1000 ml against 200 g, and the big one drawn smaller: the error
    // that makes a cluster look wrong before anybody can say why.
    const said = reviewCluster(
      [want(0, 0.3, 0.15, 0.3), want(1, 0.7, 0.3, 0.5)],
      [1000, 200],
    );
    expect(said[0]!).toMatchObject({ index: 0 });
    expect(said[0]!.said).toMatch(/5\.0× så stor/);
  });

  it('says nothing about sizes it was not given', () => {
    expect(reviewCluster([want(0, 0.3, 0.15, 0.3), want(1, 0.7, 0.3, 0.5)])).toEqual([]);
  });
});
