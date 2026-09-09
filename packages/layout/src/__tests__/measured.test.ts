import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEASURED } from '@incitio/renderer';

const PATH = fileURLToPath(new URL('../../../../data/templates/tile-composition.json', import.meta.url));

/**
 * The renderer's proportions are copied from the miner's output. This
 * guards against the two drifting apart: re-running the miner on new
 * catalogs should either agree with the constants or fail here loudly, not
 * leave the renderer quietly shaped by last month's measurements.
 */
describe.runIf(existsSync(PATH))('renderer proportions match the mined measurements', () => {
  const data = JSON.parse(readFileSync(PATH, 'utf8')) as {
    aggregate: { medianImageAreaFraction: number; priceToNameQuartiles: number[] };
    tiles: { dealer: string; imageAreaFraction?: number; priceToNameRatio?: number }[];
  };

  const GROCERY = new Set(['Bilka', 'Kvickly', 'Købmandsgården', 'Poetzsch Padborg']);
  const grocery = data.tiles.filter((t) => GROCERY.has(t.dealer));

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  it('has a grocery segment large enough to draw from', () => {
    expect(grocery.length).toBeGreaterThan(300);
  });

  it('uses the measured artwork share, within rounding', () => {
    const measured = median(
      grocery.map((t) => t.imageAreaFraction).filter((v): v is number => v !== undefined),
    );
    expect(Math.abs(MEASURED.artworkShare - measured)).toBeLessThan(0.02);
  });

  it('records a price-to-name range the renderer actually sits inside', () => {
    // The stylesheet uses 4.4 / 1.62 = 2.72.
    const rendered = 4.4 / 1.62;
    expect(rendered).toBeGreaterThan(MEASURED.priceToName.q1);
    expect(rendered).toBeLessThan(MEASURED.priceToName.q3);
  });

  it('keeps the recorded quartiles in agreement with the mined file', () => {
    const ratios = grocery
      .map((t) => t.priceToNameRatio)
      .filter((v): v is number => v !== undefined);
    expect(Math.abs(MEASURED.priceToName.median - median(ratios))).toBeLessThan(0.15);
  });
});
