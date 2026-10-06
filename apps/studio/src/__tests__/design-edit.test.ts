import { describe, expect, it } from 'vitest';
import { align, cloneLayers, distribute, emptyHistory, record, redo, restack, snapMove, snapResize, undo } from '../design-edit.js';
import { blankDesign } from '../design-new.js';

const opts = { threshold: { x: 0.02, y: 0.02 }, grid: null };

describe('snapping', () => {
  it('catches the cell middle and draws a guide', () => {
    const start = { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.2 };
    // centre would land at 0.49 → snaps to 0.5
    const { dx, guides } = snapMove(start, 0.29, 0, [], opts);
    expect(dx).toBeCloseTo(0.3);
    expect(guides).toContainEqual({ axis: 'x', at: 0.5, from: 0, to: 1 });
  });

  it('catches another field’s edge, and lets go when switched off', () => {
    const other = { x1: 0.6, y1: 0.6, x2: 0.9, y2: 0.9 };
    const start = { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 };
    expect(snapMove(start, 0.392, 0, [other], opts).dx).toBeCloseTo(0.4); // right edge 0.592 → 0.6
    expect(snapMove(start, 0.392, 0, [other], { ...opts, off: true }).dx).toBeCloseTo(0.392);
  });

  it('resizes only the held edges, and keeps the ratio with shift', () => {
    const start = { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.3 };
    const min = { x: 0.01, y: 0.01 };
    const e = snapResize(start, 'e', 0.1, 0.5, [], { ...opts, off: true, min }).rect;
    expect(e).toEqual({ x1: 0.2, y1: 0.2, x2: expect.closeTo(0.5), y2: 0.3 });
    const se = snapResize(start, 'se', 0.2, 0, [], { ...opts, off: true, min, keepRatio: true }).rect;
    expect((se.x2 - se.x1) / (se.y2 - se.y1)).toBeCloseTo(2);
  });
});

describe('arranging', () => {
  it('aligns one field to the cell, several to their box', () => {
    expect(align([{ x1: 0.1, y1: 0, x2: 0.3, y2: 0.1 }], 'right')[0]!.x2).toBe(1);
    const two = align([{ x1: 0.1, y1: 0, x2: 0.2, y2: 0.1 }, { x1: 0.5, y1: 0, x2: 0.9, y2: 0.1 }], 'left');
    expect(two.map((r) => r.x1)).toEqual([0.1, 0.1]);
  });

  it('distributes with equal gaps', () => {
    const out = distribute([
      { x1: 0, y1: 0, x2: 0.1, y2: 1 }, { x1: 0.15, y1: 0, x2: 0.25, y2: 1 }, { x1: 0.9, y1: 0, x2: 1, y2: 1 },
    ], 'x');
    expect(out[1]!.x1).toBeCloseTo(0.45);
  });

  it('restacks and clones with fresh ids', () => {
    const design = blankDesign('d', 't'); // price, text, image
    const bottom = String(design.layers[2]!.id);
    expect(String(restack(design, [bottom], 'forward', true).layers[0]!.id)).toBe(bottom);
    const { design: more, ids } = cloneLayers(design, [design.layers[0]!], { x: 0.05, y: 0.05 });
    expect(more.layers).toHaveLength(4);
    expect(design.layers.some((l) => String(l.id) === ids[0])).toBe(false);
  });
});

describe('history', () => {
  it('undoes and redoes, and coalesces typing', () => {
    const a = blankDesign('d', 'a');
    const b = { ...a, tag: 'b' };
    const c = { ...a, tag: 'c' };
    let h = record(emptyHistory(), a, 'tag', 1000);
    h = record(h, b, 'tag', 1500); // same word → same step
    expect(h.past).toHaveLength(1);
    const back = undo(h, c)!;
    expect(back.design.tag).toBe('a');
    expect(redo(back.history, back.design)!.design.tag).toBe('c');
  });
});
