import { describe, expect, it } from 'vitest';
import { freeSpots, motifDecoration } from '../backdropMeasure.js';

describe('freeSpots', () => {
  it('finds the empty corner of a page and nothing under the products', () => {
    // Products fill everything but the top-left quarter.
    const taken = [
      { x0: 50, x1: 100, y0: 0, y1: 100 },
      { x0: 0, x1: 50, y0: 50, y1: 100 },
    ];
    const [first, ...rest] = freeSpots(taken, 0.707);
    expect(first!.x0).toBe(0);
    expect(first!.y0).toBe(0);
    expect(first!.x1).toBeLessThanOrEqual(50);
    expect(first!.y1).toBeLessThanOrEqual(50);
    expect(rest).toEqual([]);
  });

  it('finds nothing on a full page', () => {
    expect(freeSpots([{ x0: 0, x1: 100, y0: 0, y1: 100 }], 0.707)).toEqual([]);
  });
});

describe('motifDecoration', () => {
  it('fills a spot on the left edge, anchored to the nearer corner', () => {
    const d = motifDecoration(
      { url: '/m.png', spot: { x0: 0, x1: 25, y0: 30, y1: 60 }, width: 800, height: 600 },
      0.707, 'motif-a', 'AI-motiv: x',
    );
    expect(d.anchor).toBe('top-left');
    expect(d.scale).toBe(0.25);
    expect(d.front).toBe(false);
  });

  it('is never smaller than a fifth of the page', () => {
    const d = motifDecoration(
      { url: '/m.png', spot: { x0: 90, x1: 100, y0: 10, y1: 20 }, width: 500, height: 500 },
      0.707, 'motif-b', 'AI-motiv: x',
    );
    expect(d.scale).toBe(0.2);
    expect(d.anchor).toBe('top-right');
  });
});
