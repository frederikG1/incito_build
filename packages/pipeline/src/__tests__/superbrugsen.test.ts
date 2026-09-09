import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestJson } from '@incitio/ingest';
import { SUPERBRUGSEN_RETAILER } from '../index.js';

const PATH = fileURLToPath(new URL('../../../../data/feeds/SuperBrugsenW36.json', import.meta.url));

describe.runIf(existsSync(PATH))('superbrugsen feed', () => {
  const { feed, issues } = ingestJson(readFileSync(PATH, 'utf8'), SUPERBRUGSEN_RETAILER.mapping);

  // Offers sit two levels deep in Pages[].Entries[], which the generic
  // reader cannot reach — this is what the extractRows seam exists for.
  it('reaches offers nested inside pages', () => {
    expect(feed.offers.length).toBe(160);
    expect(issues).toEqual([]);
  });

  /*
   * Priority is inverse prominence: 2 is the large tile, 4 the small one.
   * Verified independently by joining this week's feed against the same
   * catalog's hotspot rectangles — P2 tiles ran at a median 0.357 of the
   * page against P4's 0.132.
   */
  it('inverts Priority into editorial weight', () => {
    const weights = feed.offers.map((o) => o.priority).filter((p): p is number => p !== null);
    expect(Math.min(...weights)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...weights)).toBeLessThanOrEqual(1);
    // P2 is the most prominent tier present, so it must top the range.
    expect(Math.max(...weights)).toBe(1);
  });

  it('carries the category hierarchy through from Varer', () => {
    const categorised = feed.offers.filter((o) => o.category !== 'uncategorised');
    expect(categorised.length).toBeGreaterThan(feed.offers.length * 0.8);
  });

  /*
   * The feed states a Motivid per offer but no URL that resolves it, so
   * every tile renders without photography. Asserted rather than left as
   * a surprise: if a future feed gains images this fails and gets updated.
   */
  it('has no product imagery, which is why tiles render as placeholders', () => {
    expect(feed.offers.filter((o) => o.imageUrl !== null)).toEqual([]);
  });
});
