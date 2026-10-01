import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseDesign, designCells, designTags, Offer, offerTypesOf, readIncitoDesigns } from '../index.js';

const text = readFileSync(new URL('../../../../data/designs/superbrugsen-cms.json', import.meta.url), 'utf8');
const { designs, skipped } = readIncitoDesigns(text);
const offer = (over: Partial<Offer> = {}) => Offer.parse({
  id: 'x', name: 'Coop kylling', price: 49, validFrom: '2026-09-21', validTo: '2026-09-27', quantity: { size: null, unit: 'pcs' }, ...over,
});

describe('SuperBrugsen offer designs from the CMS', () => {
  it('reads all 36 as they were copied out', () => {
    expect([designs.length, skipped]).toEqual([36, 0]);
    expect(designTags(designs)).toContain('Rød, sort, hvid');
    expect(designTags(designs)).toContain('Rød, sort, hvid - Uden billede');
    // Also the raw clipboard form.
    expect(readIncitoDesigns(`incito_designs:${JSON.stringify(designs)}`).designs).toHaveLength(36);
  });

  it('A offers get the a design of the tag; the rest the b', () => {
    expect(chooseDesign(designs, 'Rød, sort, hvid', offer(), { a: true, turn: 0 })!.design.offer_priority).toBe('a');
    const b = chooseDesign(designs, 'Rød, sort, hvid', offer(), { a: false, turn: 0 })!.design;
    expect([b.offer_priority, b.offer_type ?? null]).toEqual(['b', null]);
  });

  it('a design for an offer type is only for that type, and wins for it', () => {
    const member = offer({ memberPrice: 39, price: 49 });
    expect(offerTypesOf(member).has('membership_relative_savings')).toBe(true);
    expect(chooseDesign(designs, 'Rød, sort, hvid', member, { a: false, turn: 0 })!.design.offer_type).toBe('membership_relative_savings');
  });

  it('designs left with the same tag take turns', () => {
    const picks = [0, 1, 2, 3].map((turn) => chooseDesign(designs, 'Offer B', offer(), { a: true, turn })!.design.id);
    expect(new Set(picks).size).toBe(2);
    expect(picks[0]).toBe(picks[2]);
  });
});

describe('designCells', () => {
  // SuperBrugsen's week-38 cover, as measured off the printed page.
  const rects = {
    e: { x: 0.045, y: 0.116, w: 1.051, h: 0.362 },
    d: { x: 0.002, y: 0.452, w: 0.498, h: 0.287 },
    c: { x: 0.512, y: 0.46, w: 0.488, h: 0.278 },
    b: { x: 0.002, y: 0.729, w: 0.998, h: 0.272 },
  };
  const masthead = { x: 0.2209, y: 0.0651, w: 0.5582, h: 0.0795 };
  const cells = designCells(rects, [masthead]);
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= 0.029 && r.y >= 0 && r.x + r.w <= 0.971 && r.y + r.h <= 0.99;
  const apart = (a: typeof cells[string], b: typeof cells[string]) =>
    a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

  it('keeps every cell on the paper, inside the margin', () => {
    expect(Object.values(cells).every(inside)).toBe(true);
  });

  it('leaves no two cells overlapping', () => {
    const list = Object.values(cells);
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) expect(apart(list[i]!, list[j]!)).toBe(true);
  });

  it('starts the lead under the masthead, not behind it', () => {
    expect(cells['e']!.y).toBeGreaterThan(masthead.y + masthead.h);
  });

  it('steps a lead aside from a tall picture beside it, rather than squashing it under it', () => {
    // SuperBrugsen uge 36 side 1: the fries run half the page down the left.
    const fries = { x: -0.1845, y: 0.0374, w: 0.5111, h: 0.4866 };
    const lead = designCells({ e: { x: 0.045, y: 0.1159, w: 1.0512, h: 0.362 } }, [masthead, fries])['e']!;
    expect(lead.x).toBeGreaterThan(fries.x + fries.w);
    expect(lead.h).toBeGreaterThan(0.25);
  });
});
