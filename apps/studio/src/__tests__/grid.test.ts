import { describe, expect, it } from 'vitest';
import { validateTemplate, type CatalogPage, type PageTemplate } from '@incitio/schema';
import { freeSlots, growTemplate, grownId, MAX_ROWS } from '../grid.js';

const template = (areas: string[], slots: PageTemplate['slots']): PageTemplate => ({
  id: 'test', name: 'Prøve', areas, slots,
});

const page = (templateId: string, slotIds: string[]): CatalogPage => ({
  id: 'p1',
  kind: 'offers',
  templateId,
  title: '',
  subtitle: '',
  placements: slotIds.map((slotId, index) => ({
    offerId: `o${index}`, slotId, overrides: {} as never,
  })),
  rationale: '',
  ground: null,
  decorations: [],
  background: null,
  texts: {},
  notes: [],
});

const FULL = template(['a b', 'c d'], [
  { id: 'a', role: 'hero', bleed: 1 },
  { id: 'b', role: 'standard', bleed: 1 },
  { id: 'c', role: 'standard', bleed: 1 },
  { id: 'd', role: 'standard', bleed: 1 },
]);

const HOLED = template(['a b', 'c .'], [
  { id: 'a', role: 'hero', bleed: 1 },
  { id: 'b', role: 'standard', bleed: 1 },
  { id: 'c', role: 'standard', bleed: 1 },
]);

describe('free cells on a page', () => {
  it('finds the slots no placement is sitting in', () => {
    expect(freeSlots(page('test', ['a', 'c']), FULL).map((slot) => slot.id))
      .toEqual(['b', 'd']);
  });

  /*
   * Assignment order, not declaration order: the first product added to
   * a half-empty page should land in the most prominent cell that is
   * free, the same rule the composer follows when it fills a page from
   * scratch.
   */
  it('offers the most prominent empty cell first', () => {
    expect(freeSlots(page('test', ['b']), FULL).map((slot) => slot.id)[0]).toBe('a');
  });

  it('reports nothing on a full page', () => {
    expect(freeSlots(page('test', ['a', 'b', 'c', 'd']), FULL)).toEqual([]);
  });
});

describe('growing a page\'s own grid', () => {
  it('takes an empty cell before it makes one', () => {
    const grown = growTemplate(HOLED, 1, 'grown/p1/4')!;
    expect(grown.template.areas).toEqual(['a b', 'c d']);
    expect(grown.added).toEqual(['d']);
  });

  it('adds a row when there is no empty cell, and fills it left to right', () => {
    const grown = growTemplate(FULL, 2, 'grown/p1/6')!;
    expect(grown.template.areas).toEqual(['a b', 'c d', 'e f']);
    expect(grown.added).toEqual(['e', 'f']);
  });

  /*
   * One cell at a time, never the largest empty rectangle. On a fresh
   * row the "largest" rule hands one product the whole row, which is not
   * what anybody clicking "+" expects to happen to the page.
   */
  it('gives one new product one cell, not the whole new row', () => {
    const grown = growTemplate(FULL, 1, 'grown/p1/5')!;
    expect(grown.template.areas).toEqual(['a b', 'c d', 'e .']);
  });

  it('leaves the original template untouched', () => {
    growTemplate(FULL, 2, 'grown/p1/6');
    expect(FULL.areas).toEqual(['a b', 'c d']);
    expect(FULL.slots).toHaveLength(4);
  });

  it('hands back a template the renderer will accept', () => {
    const grown = growTemplate(FULL, 3, 'grown/p1/7')!;
    expect(validateTemplate(grown.template)).toEqual([]);
    expect(grown.template.slots).toHaveLength(7);
  });

  /*
   * Rows are `1fr`, so every row added shortens every tile on the page.
   * Past the ceiling the honest answer is another page, and a refusal
   * the editor can report beats a sheet of slivers.
   */
  it('refuses rather than printing a page of slivers', () => {
    const tall = template(
      new Array(MAX_ROWS).fill('a a'),
      [{ id: 'a', role: 'hero', bleed: 1 }],
    );
    expect(growTemplate(tall, 1, 'grown/p1/2')).toBeNull();
  });

  it('names a grown layout after the page and the count it grew to', () => {
    expect(grownId('cat-p3', 7)).toBe('grown/cat-p3/7');
  });
});
