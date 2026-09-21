import { describe, expect, it } from 'vitest';
import { shifted, snap, SNAP_WITHIN, type Rect } from '../snap.js';

const rect = (left: number, top: number, width = 40, height = 20): Rect =>
  ({ left, top, width, height });

describe('lining a drag up', () => {
  it('leaves a drag alone when there is nothing near it', () => {
    expect(snap(rect(0, 0), [rect(500, 500)])).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snap(rect(0, 0), [])).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('takes the exact value when an edge is nearly on another', () => {
    // 3px short of sharing a left edge, which is inside the reach.
    expect(snap(rect(97, 300), [rect(100, 40)]).dx).toBe(3);
  });

  it('will not reach further than it is allowed', () => {
    // Moving edges 80/100/120, target edges 145/165/185 — 25 apart at
    // the nearest, which is out of reach by default and in reach at 30.
    expect(snap(rect(80, 300), [rect(145, 40)]).dx).toBe(0);
    expect(snap(rect(80, 300), [rect(145, 40)], 30).dx).toBe(25);
  });

  /*
   * The two axes are independent, and they have to be: most of what
   * happens is a box taking a vertical alignment while its horizontal
   * position is exactly where the hand left it.
   */
  it('answers each axis on its own', () => {
    const said = snap(rect(97, 300), [rect(100, 700)]);
    expect(said.dx).toBe(3);
    expect(said.dy).toBe(0);
  });

  it('lines centres up, not only edges', () => {
    // Moving centre 40, target centre 44 — four to go, on centres only.
    const said = snap(rect(20, 0, 40, 20), [rect(4, 200, 80, 20)]);
    expect(said.dx).toBe(4);
  });

  it('sits flush: a leading edge lands on a trailing one', () => {
    // Moving left 138, target right 140.
    expect(snap(rect(138, 0), [rect(100, 0)]).dx).toBe(2);
  });

  it('takes the nearer of two things it could line up with', () => {
    const said = snap(rect(97, 0), [rect(100, 200), rect(95, 400)]);
    // 100 is 3 away, 95 is 2 away — the nearer wins.
    expect(said.dx).toBe(-2);
  });

  describe('the line it draws', () => {
    const said = snap(rect(97, 300), [rect(100, 40)]);

    it('marks the axis it lined up on and where', () => {
      expect(said.guides).toHaveLength(1);
      expect(said.guides[0]).toMatchObject({ axis: 'x', at: 100 });
    });

    /*
     * Spanning both boxes is what makes it readable: a line over the
     * thing in hand alone says "this edge"; a line reaching what it met
     * says "these two edges are the same".
     */
    it('runs from one box to the other', () => {
      expect(said.guides[0]!.from).toBe(40);
      expect(said.guides[0]!.to).toBe(320);
    });
  });

  it('is six pixels by default — about what a hand can hold still', () => {
    expect(SNAP_WITHIN).toBe(6);
    expect(snap(rect(94, 0), [rect(100, 400)]).dx).toBe(6);
    expect(snap(rect(93, 0), [rect(100, 400)]).dx).toBe(0);
  });
});

describe('shifting a rectangle', () => {
  it('moves it without touching the original', () => {
    const one = rect(10, 20);
    expect(shifted(one, 5, -5)).toEqual({ left: 15, top: 15, width: 40, height: 20 });
    expect(one.left).toBe(10);
  });
});
