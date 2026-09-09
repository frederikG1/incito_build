import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CatalogDocument } from '@incitio/schema';
import { AUTHORED_LIBRARY, validateTemplate } from '@incitio/layout';
import { buildCatalog, SAMPLE_RETAILER } from '../index.js';

const FEED = readFileSync(
  fileURLToPath(new URL('../../../../data/feeds/sample-offers.csv', import.meta.url)),
  'utf8',
);

function build() {
  return buildCatalog(FEED, 'csv', SAMPLE_RETAILER);
}

describe('buildCatalog against the sample feed', () => {
  it('reports exactly the defects planted in the sample feed', () => {
    const { issues } = build();
    expect(issues.map((i) => i.reason)).toEqual([
      'duplicate id, row skipped',
      'missing name',
      'unparseable price',
    ]);
  });

  it('places every ingested offer exactly once', () => {
    const { document, offerCount, unplaced } = build();
    const placed = document.pages.flatMap((p) => p.placements.map((pl) => pl.offerId));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length + unplaced.length).toBe(offerCount);
  });

  it('produces a document that satisfies the schema', () => {
    expect(CatalogDocument.safeParse(build().document).success).toBe(true);
  });

  it('references only templates that exist and are internally valid', () => {
    const { document } = build();
    for (const page of document.pages) {
      const template = AUTHORED_LIBRARY.templates.find((t) => t.id === page.templateId);
      expect(template, `unknown template ${page.templateId}`).toBeDefined();
      expect(validateTemplate(template!)).toEqual([]);
    }
  });

  it('never assigns two offers to the same slot on a page', () => {
    for (const page of build().document.pages) {
      const slots = page.placements.map((p) => p.slotId);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  /*
   * The golden test. Timestamps and the document id are excluded because
   * they are wall-clock values, not layout decisions; everything that the
   * solver actually chose is pinned. If a scoring-weight change is
   * intentional this snapshot is meant to be updated — the point is that
   * it cannot change by accident.
   */
  it('matches the committed layout snapshot', () => {
    const { document } = build();
    const snapshot = document.pages.map((page) => ({
      id: page.id,
      templateId: page.templateId,
      title: page.title,
      subtitle: page.subtitle,
      placements: page.placements.map((p) => `${p.slotId}=${p.offerId}`),
    }));
    expect(snapshot).toMatchSnapshot();
  });

  it('is stable across repeated runs', () => {
    const a = build().document.pages;
    const b = build().document.pages;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
