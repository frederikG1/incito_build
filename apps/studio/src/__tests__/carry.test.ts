import { describe, expect, it } from 'vitest';
import { PlacementOverrides, type Offer } from '@incitio/schema';
import { carryOverrides } from '../state.js';

// Only what carrying reads: the id and the pictures.
const offer = {
  id: 'o1', imagePack: ['/a.png', '/b.png', '/c.png', '/d.png'], members: ['m1', 'm2', 'm3', 'm4'],
} as unknown as Offer;

describe('a tile moved into a cell of another size', () => {
  const nudged = PlacementOverrides.parse({
    pack: { 0: { offsetX: -10, offsetY: 4 } },
    parts: { price: { offsetX: 2, offsetY: -3 } },
  });

  it('scales its nudges with the cell, so the products keep their places in it', () => {
    const moved = carryOverrides(nudged, offer, { w: 0.2, h: 0.4, role: 'standard' }, { w: 0.4, h: 0.2, role: 'standard' });
    expect(moved.pack['0']!.offsetX).toBeCloseTo(-20);
    expect(moved.pack['0']!.offsetY).toBeCloseTo(2);
    expect(moved.parts['price']!.offsetX).toBeCloseTo(4);
    expect(moved.parts['price']!.offsetY).toBeCloseTo(-1.5);
  });

  it('pins the arrangement it was nudged in, which the new cell would otherwise change', () => {
    const moved = carryOverrides(nudged, offer, { w: 0.5, h: 0.5, role: 'hero' }, { w: 0.25, h: 0.25, role: 'standard' });
    expect(moved.arrangement).not.toBeNull();
  });

  it('leaves an untouched tile alone', () => {
    const plain = PlacementOverrides.parse({});
    const moved = carryOverrides(plain, offer, { w: 0.5, h: 0.5, role: 'hero' }, { w: 0.25, h: 0.25, role: 'standard' });
    expect(moved.arrangement).toBeNull();
  });
});
