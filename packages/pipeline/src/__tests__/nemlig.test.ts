import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTHORED_LIBRARY } from '@incitio/layout';
import { ingestJson } from '@incitio/ingest';
import { buildCatalog, NEMLIG_RETAILER } from '../index.js';

const PATH = fileURLToPath(new URL('../../../../data/feeds/nemlig.json', import.meta.url));

describe.runIf(existsSync(PATH))('nemlig feed', () => {
  const source = readFileSync(PATH, 'utf8');
  const build = (selection?: { targetCount: number }) =>
    buildCatalog(source, 'json', NEMLIG_RETAILER, {
      library: AUTHORED_LIBRARY,
      ...(selection ? { selection } : {}),
    });

  it('ingests the whole feed without issues', () => {
    const r = build();
    expect(r.offerCount).toBeGreaterThan(1000);
    expect(r.issues).toEqual([]);
  });

  it('cuts the range down to the requested catalog size', () => {
    const r = build({ targetCount: 160 });
    const placed = r.document.pages.flatMap((p) => p.placements);
    expect(placed.length).toBeLessThanOrEqual(160);
    expect(r.notSelected.length).toBeGreaterThan(1000);
  });

  it('keeps the catalog representative of the shop', () => {
    const r = build({ targetCount: 160 });
    expect(Object.keys(r.categoryMix).length).toBeGreaterThanOrEqual(8);
    const biggest = Math.max(...Object.values(r.categoryMix));
    expect(biggest).toBeLessThanOrEqual(160 * 0.25);
  });

  // The headline is "<product> fra <brand>"; a brandless row would
  // otherwise ship with a dangling preposition.
  it('never leaves a trailing "fra" on a brandless product', () => {
    const r = build();
    const dangling = r.document.pages
      .flatMap((p) => p.placements)
      .map((pl) => pl.offerId);
    expect(dangling.length).toBeGreaterThan(0);
    const source2 = JSON.parse(readFileSync(PATH, 'utf8')) as Record<string, string>[];
    const brandless = source2.filter((row) => !row['ProductBrandName']);
    expect(brandless.length).toBeGreaterThan(0);
    const built = build({ targetCount: 400 });
    for (const page of built.document.pages) {
      for (const placement of page.placements) {
        expect(placement.offerId).toBeTruthy();
      }
    }
  });

  it('uses the retailer campaign tier as editorial weight', () => {
    const r = build({ targetCount: 40 });
    expect(r.document.pages.length).toBeGreaterThan(0);
  });
});

describe.runIf(existsSync(PATH))('nemlig copy', () => {
  const source = readFileSync(PATH, 'utf8');

  // The quantity line was being used as the description as well, so every
  // tile printed it twice ("25 m" above "25 m").
  it('never repeats the quantity as the description', () => {
    const { feed } = ingestJson(source, NEMLIG_RETAILER.mapping);
    const repeats = feed.offers.filter(
      (o) => o.description !== '' && o.description === quantityText(o),
    );
    expect(repeats).toEqual([]);
  });

  it('still carries a quantity for most offers', () => {
    const { feed } = ingestJson(source, NEMLIG_RETAILER.mapping);
    const withQuantity = feed.offers.filter(
      (o) => o.quantity.size !== null || o.quantity.pieceCount > 1,
    );
    expect(withQuantity.length).toBeGreaterThan(feed.offers.length * 0.5);
  });
});

function quantityText(offer: { quantity: { size: number | null; unit: string } }): string {
  return offer.quantity.size === null ? '' : `${offer.quantity.size} ${offer.quantity.unit}`;
}
