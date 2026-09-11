import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@incitio/schema';
import {
  brandCapacities,
  brandIds,
  defaultSource,
  findSource,
  resolveSource,
  getBrand,
  listBrands,
  resolveTemplate,
  templatesForCount,
  UnknownBrandError,
} from '../index.js';

describe('the template library each chain owns', () => {
  for (const id of brandIds()) {
    const { brand } = getBrand(id);

    it(`${id}: every template's grid matches its slots`, () => {
      for (const template of brand.templates) {
        expect(validateTemplate(template), `${template.id}: ${validateTemplate(template).join('; ')}`)
          .toEqual([]);
      }
    });

    it(`${id}: template ids are unique`, () => {
      const ids = brand.templates.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${id}: covers a run of consecutive page sizes`, () => {
      // Gaps strand offers: a plan wanting a five-offer page with no
      // five-slot template silently falls back to a roomier one and
      // leaves a hole. Not fatal, but it should be a deliberate choice.
      const capacities = brandCapacities(brand);
      expect(capacities.length).toBeGreaterThanOrEqual(4);
      expect(Math.min(...capacities)).toBeLessThanOrEqual(3);
    });
  }
});

describe('page-to-page variety', () => {
  for (const id of brandIds()) {
    const { brand } = getBrand(id);

    /*
     * The page size fixes the template, so a chain with one layout per
     * count prints the same page over and over however cleverly the
     * pages were planned. Several shapes at the common counts is what
     * makes two six-offer pages look different.
     */
    it(`${id}: offers more than one layout at some counts`, () => {
      const counts = brandCapacities(brand);
      const withChoice = counts.filter((c) => templatesForCount(brand, c).length > 1);
      expect(withChoice.length + counts.length).toBeGreaterThanOrEqual(6);
      expect(brand.templates.length).toBeGreaterThanOrEqual(5);
    });

    /*
     * A page of equal boxes is the look this system had to stop
     * producing. At least one layout per chain must let a slot's
     * artwork out of its cell.
     */
    it(`${id}: has a layout where the lead breaks out of its cell`, () => {
      const bleeding = brand.templates.filter((t) => t.slots.some((s) => s.bleed > 1));
      expect(bleeding.length).toBeGreaterThan(0);
    });

    it(`${id}: only lets a lead slot bleed, never a filler`, () => {
      for (const t of brand.templates) {
        for (const slot of t.slots) {
          if (slot.bleed > 1) expect(slot.role).toBe('hero');
        }
      }
    });

    it(`${id}: no two templates share a grid`, () => {
      const shapes = brand.templates.map((t) => t.areas.join('|'));
      expect(new Set(shapes).size).toBe(shapes.length);
    });
  }

  it('SuperBrugsen rotates its ground while Netto keeps one', () => {
    // Measured from the printed books: Coop changes the field from
    // spread to spread under an unchanging motif; Netto prints yellow
    // on every page.
    expect(getBrand('superbrugsen').brand.groundTints.length).toBeGreaterThan(3);
    expect(getBrand('netto').brand.groundTints).toEqual([]);
  });

  it('gives every ground a distinct value', () => {
    const tints = getBrand('superbrugsen').brand.groundTints;
    expect(new Set(tints).size).toBe(tints.length);
  });

  it('gives no two chains the same typeface', () => {
    /*
     * All three named Inter once, and nothing loaded it — so every
     * chain printed in the system fallback and the books were
     * typographically identical. That is the single loudest tell that
     * a page was generated rather than designed, and it survived
     * because no test could see it.
     */
    const faces = brandIds().map((id) => getBrand(id).brand.tokens.headingFont);
    expect(new Set(faces).size).toBe(faces.length);
  });

  it('names a face the stylesheet actually ships', () => {
    // A token naming a font nobody bundled is not a typeface, it is a
    // fallback with extra steps.
    const css = readFileSync(
      new URL('../../../renderer/src/styles.css', import.meta.url), 'utf8',
    );
    const served = [...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]);
    for (const id of brandIds()) {
      const { tokens } = getBrand(id).brand;
      for (const token of [tokens.headingFont, tokens.bodyFont]) {
        const named = token.match(/'([^']+)'/)?.[1];
        expect(served, `${id} names ${named}`).toContain(named);
      }
    }
  });
});

describe('tenant isolation', () => {
  it('resolves a template only within its own chain', () => {
    const netto = getBrand('netto').brand;
    const coop = getBrand('superbrugsen').brand;

    expect(resolveTemplate(netto, 'netto/grid-6')).toBeDefined();
    // The whole point: Netto asking for a Coop layout gets nothing, not
    // a Coop layout.
    expect(resolveTemplate(netto, 'sb/grid-4')).toBeUndefined();
    expect(resolveTemplate(coop, 'netto/grid-6')).toBeUndefined();
  });

  it('never lets one chain\'s templates appear in another\'s set', () => {
    for (const { id } of listBrands()) {
      const { brand } = getBrand(id);
      const others = brandIds().filter((other) => other !== id);
      for (const other of others) {
        const foreign = new Set(getBrand(other).brand.templates.map((t) => t.id));
        for (const template of brand.templates) {
          expect(foreign.has(template.id)).toBe(false);
        }
      }
    }
  });

  it('rejects an unknown chain rather than falling back to a default', () => {
    expect(() => getBrand('rema1000')).toThrow(UnknownBrandError);
  });

  it('finds templates by capacity within one chain', () => {
    const netto = getBrand('netto').brand;
    for (const template of templatesForCount(netto, 6)) {
      expect(template.slots).toHaveLength(6);
      expect(template.id.startsWith('netto/')).toBe(true);
    }
  });
});

describe('resolveSource', () => {
  const superbrugsen = getBrand('superbrugsen');
  const netto = getBrand('netto');

  const coopFeed = JSON.stringify({
    Pages: [
      { PageNumber: 1, Entries: [] },
      { PageNumber: 2, Entries: [{ Id: '1', Header: 'Kaffe', Motivid: 'x', Priority: 2 }] },
    ],
  });

  const tjekFeed = JSON.stringify([{
    id: 'a', heading: 'Taffel chips', description: 'Frit valg. 1 pose',
    pricing: { price: 12, pre_price: null, currency: 'DKK' },
    run_from: '2026-09-03T22:00:00+0000', run_till: '2026-09-10T21:59:59+0000',
  }]);

  /*
   * The reason this exists: one chain, two real formats. Coop's own
   * campaign export and the flat Tjek offers API a single store
   * publishes. Modelling a brand as having one feed meant the second
   * could only arrive by replacing the first.
   */
  it('picks the right reader for each of the chain\'s own formats', () => {
    expect((resolveSource(superbrugsen, tjekFeed) as { source: { id: string } }).source.id)
      .toBe('tjek');
    expect((resolveSource(superbrugsen, coopFeed) as { source: { id: string } }).source.id)
      .toBe('coop-export');
  });

  it('reads records past an empty first page', () => {
    // Coop's page 1 is a cover with no entries; an earlier detector
    // gave up there and reported the whole file as empty.
    expect(resolveSource(superbrugsen, coopFeed).reason).toContain('Header');
  });

  it('refuses another chain\'s feed', () => {
    const result = resolveSource(netto, coopFeed);
    expect(result.source).toBeNull();
    expect(result.reason).toContain('Netto');
  });

  it('names the missing fields of the closest reader', () => {
    const result = resolveSource(netto, 'artikelnr;varenavn\nA;Mælk\n');
    expect(result.source).toBeNull();
    expect(result.reason).toContain('pris');
  });

  it('reports invalid JSON as such', () => {
    expect(resolveSource(superbrugsen, '{ not json').reason).toContain('JSON');
  });

  it('offers the store feed as the default', () => {
    expect(defaultSource(superbrugsen).id).toBe('tjek');
  });

  it('looks a source up by name within the chain only', () => {
    expect(findSource(superbrugsen, 'coop-export')).toBeDefined();
    // Netto has no reader by that name, and must not borrow one.
    expect(findSource(netto, 'coop-export')).toBeUndefined();
  });
});
