import { describe, expect, it } from 'vitest';
import { OfferDesign } from '@incitio/schema';
import { addLayer, blankDesign, freeTag, removeLayer } from '../design-new.js';

describe('designs made by hand', () => {
  it('starts with picture, words and price, valid for the CMS', () => {
    const design = blankDesign('d1', 'Nyt design');
    expect(OfferDesign.safeParse(design).success).toBe(true);
    expect(design.layers.map((l) => l.type)).toEqual(['offer_price', 'offer_text', 'offer_image']);
    expect(new Set(design.layers.map((l) => l.id)).size).toBe(3);
  });

  it('adds a field on top, a background underneath, and removes a field with its group', () => {
    const base = blankDesign('d1', 'x');
    const { design, layer } = addLayer(base, 'offer_savings');
    expect(design.layers[0]).toBe(layer);
    expect(addLayer(design, 'offer_bg_image').design.layers.at(-1)!.type).toBe('offer_bg_image');
    const child = { ...addLayer(design, 'offer_logos').layer, parent_id: layer.id };
    const grouped = { ...design, layers: [child, ...design.layers] };
    expect(removeLayer(grouped, String(layer.id)).layers).toHaveLength(3);
  });

  it('names a new design with a free tag', () => {
    expect(freeTag([blankDesign('a', 'Nyt design'), blankDesign('b', 'Nyt design 2')])).toBe('Nyt design 3');
  });
});
