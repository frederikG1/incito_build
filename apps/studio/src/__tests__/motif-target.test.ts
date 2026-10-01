import { describe, expect, it } from 'vitest';
import { motifTarget, type PageMeasure } from '../backdropMeasure.js';

const page = (over: Partial<PageMeasure>): PageMeasure => ({
  aspect: '4:5', colour: '#bad4e1', regions: [], text: [], ratio: 0.6,
  productBoxes: [], wordBoxes: [], spots: [], ...over,
});
const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

describe('where a drawn motif goes', () => {
  it('takes the free place on the page when there is one', () => {
    const spot = { x0: 0, x1: 40, y0: 60, y1: 95 };
    const target = motifTarget(page({ spots: [spot], productBoxes: [{ x0: 45, x1: 95, y0: 10, y1: 90 }] }));
    // What shows on the sheet is that place; an edge place may reach off it.
    expect({ ...target, x0: Math.max(0, target.x0) }).toEqual(spot);
  });

  it('always finds a place on a full page — a corner, over no words', () => {
    const words = [{ x0: 5, x1: 60, y0: 40, y1: 50 }, { x0: 60, x1: 95, y0: 88, y1: 98 }];
    const target = motifTarget(page({
      spots: [],
      productBoxes: [{ x0: 5, x1: 95, y0: 5, y1: 38 }, { x0: 5, x1: 55, y0: 52, y1: 95 }],
      wordBoxes: words,
    }));
    expect(target.x1 - target.x0).toBeGreaterThan(10);
    for (const box of words) expect(overlap(target, box)).toBe(0);
  });

  it('never hands the model a sliver', () => {
    const target = motifTarget(page({ spots: [{ x0: 0, x1: 100, y0: 90, y1: 100 }] }));
    const onPage = ((target.x1 - target.x0) * 0.6) / (target.y1 - target.y0);
    expect(onPage).toBeLessThanOrEqual(2.01);
  });
});
