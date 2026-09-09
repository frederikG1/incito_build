import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const PATH = fileURLToPath(new URL('../../../../data/templates/tile-composition.json', import.meta.url));

/**
 * Measurements of what real published tiles do, mined from print PDFs by
 * the Python sidecar. Asserted rather than trusted: these numbers become
 * scoring weights, and a silent regression in the miner would move the
 * renderer's type scale without anyone noticing.
 */
const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const TileRecord = z.object({
  catalogId: z.string(),
  dealer: z.string(),
  page: z.number().int().positive(),
  tileAspect: z.number().positive(),
  tileAreaFraction: z.number().min(0).max(1),
  priceSizePt: z.number().positive(),
  priceSizeRatio: z.number().positive(),
  priceBox: Box,
  imageAreaFraction: z.number().min(0).max(1),
  priceOverImageFraction: z.number().min(0),
  priceToNameRatio: z.number().positive().optional(),
});

const Composition = z.object({
  version: z.string(),
  aggregate: z.object({
    tiles: z.number().int(),
    medianPriceToNameRatio: z.number().nullable(),
    medianImageAreaFraction: z.number().nullable(),
    shareWithPriceOverImage: z.number().nullable(),
  }),
  tiles: z.array(TileRecord),
});

describe.runIf(existsSync(PATH))('mined tile composition', () => {
  const data = Composition.parse(JSON.parse(readFileSync(PATH, 'utf8')));

  it('has a usable sample size', () => {
    expect(data.tiles.length).toBeGreaterThan(200);
  });

  it('covers several retailers, not one house style', () => {
    const dealers = new Set(data.tiles.map((t) => t.dealer));
    expect(dealers.size).toBeGreaterThanOrEqual(5);
  });

  it('keeps every normalised box inside its tile', () => {
    const escaping = data.tiles.filter(
      (t) => t.priceBox.x < -0.05 || t.priceBox.y < -0.05
        || t.priceBox.x + t.priceBox.w > 1.05 || t.priceBox.y + t.priceBox.h > 1.05,
    );
    expect(escaping).toEqual([]);
  });

  // The renderer's price step is derived from this. If the miner's
  // estimate moves, the tile design should move with it deliberately.
  it('finds a price set materially larger than the product name', () => {
    expect(data.aggregate.medianPriceToNameRatio).toBeGreaterThan(1.5);
  });

  it('finds artwork occupying a substantial share of the tile', () => {
    expect(data.aggregate.medianImageAreaFraction).toBeGreaterThan(0.3);
  });

  /*
   * Documents the finding that overturned an assumption: real published
   * leaflets print the price over the product very often. A hard "price
   * must not intersect artwork" constraint would reject a large share of
   * professionally designed pages, so the rule has to be about the
   * price's legibility, not about intersection.
   */
  it('shows price-over-artwork is common in real pages, not an error', () => {
    expect(data.aggregate.shareWithPriceOverImage).toBeGreaterThan(0.2);
  });
});
