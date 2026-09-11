import { describe, expect, it } from 'vitest';
import {
  PART_DEFAULTS, PlacementOverrides, TILE_PARTS, TILE_PART_NAMES,
  partLimits, partOverride, partPatch, partTouched, tileArranged,
} from '../catalog.js';

const fresh = () => PlacementOverrides.parse({});

describe('tile parts', () => {
  it('names every box it can address', () => {
    for (const part of TILE_PARTS) expect(TILE_PART_NAMES[part]).toBeTruthy();
  });

  it('reads a catalogue saved before boxes were movable', () => {
    // The field did not exist; a document without it is not a broken
    // document, it is last week's.
    const old = PlacementOverrides.parse({
      pinned: false, displayName: null, description: null,
      imageScale: 1.4, imageOffsetX: -0.2, imageOffsetY: 0,
    });
    expect(old.parts).toEqual({});
    expect(partOverride(old, 'name')).toEqual(PART_DEFAULTS);
  });

  it('reads the artwork out of the three fields that have always held it', () => {
    const o = PlacementOverrides.parse({ imageScale: 1.5, imageOffsetX: -0.4, imageOffsetY: 0.2 });
    expect(partOverride(o, 'media')).toMatchObject({
      scale: 1.5, offsetX: -0.4, offsetY: 0.2,
    });
  });

  it('writes the artwork back to those fields, never to parts', () => {
    const patch = partPatch(fresh(), 'media', { offsetX: 0.5, scale: 1.2 });
    expect(patch).toEqual({ imageOffsetX: 0.5, imageScale: 1.2 });
    expect(patch).not.toHaveProperty('parts');
  });

  it('writes every other box into parts, leaving the others alone', () => {
    const before = { ...fresh(), parts: { name: { ...PART_DEFAULTS, offsetX: 3 } } };
    const patch = partPatch(before, 'quantity', { offsetY: -2 });
    expect(patch.parts?.['name']).toMatchObject({ offsetX: 3 });
    expect(patch.parts?.['quantity']).toMatchObject({ offsetY: -2, offsetX: 0, scale: 1 });
  });

  it('merges into a box rather than replacing it', () => {
    let o = fresh();
    o = { ...o, ...partPatch(o, 'meta', { offsetX: 4 }) };
    o = { ...o, ...partPatch(o, 'meta', { hidden: true }) };
    expect(partOverride(o, 'meta')).toMatchObject({ offsetX: 4, hidden: true });
  });

  it('counts a rewrite and a hide as touched, but not as arranged', () => {
    // "Arranged" is about geometry — it is what makes the tile stop
    // clipping its text block. Renaming a line does not move anything.
    let o = fresh();
    o = { ...o, ...partPatch(o, 'tags', { text: 'Frit valg' }) };
    o = { ...o, ...partPatch(o, 'brand', { hidden: true }) };
    expect(partTouched(o, 'tags')).toBe(true);
    expect(partTouched(o, 'brand')).toBe(true);
    expect(partTouched(o, 'name')).toBe(false);
    expect(tileArranged(o)).toBe(false);

    o = { ...o, ...partPatch(o, 'name', { offsetY: 1.5 }) };
    expect(tileArranged(o)).toBe(true);
  });

  it('keeps its clamps inside what the schema will accept', () => {
    // A limit looser than the schema is a drag that stops writing
    // halfway with no error anywhere.
    for (const part of TILE_PARTS) {
      const { reach, minScale, maxScale } = partLimits(part);
      const at = partPatch(fresh(), part, {
        offsetX: reach, offsetY: -reach, scale: maxScale,
      });
      expect(() => PlacementOverrides.parse({ ...fresh(), ...at })).not.toThrow();
      const low = partPatch(fresh(), part, { scale: minScale });
      expect(() => PlacementOverrides.parse({ ...fresh(), ...low })).not.toThrow();
    }
  });

  it('gives the artwork and the rest different currencies', () => {
    // The artwork moves in fractions of its own frame, everything else
    // in percent of the page. Equal reaches would mean one of the two
    // is wrong by a factor of twenty-five.
    expect(partLimits('media').reach).toBe(1);
    expect(partLimits('name').reach).toBe(25);
  });
});
