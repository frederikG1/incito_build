import { describe, expect, it } from 'vitest';
import { Offer } from '@incitio/schema';
import { ARRANGE_SYSTEM, defaultArrangement, validate } from '../arrange.js';

/**
 * What the model is allowed to come back with.
 *
 * The call itself is not tested — it needs a key and it costs money —
 * but the thing between it and the page is, and that is where the
 * damage would be. A tile is a price covering a set of products: an
 * ordering that repeated one of them and lost another would charge for
 * something the page does not show.
 */
const offer = (id: string, name: string): Offer => Offer.parse({
  id,
  name,
  price: 10,
  quantity: { size: null, unit: 'pcs', pieceCount: 1 },
  validFrom: '2026-09-14',
  validTo: '2026-09-20',
});

const THREE = [offer('a', 'Klovborg'), offer('b', 'Riberhus'), offer('c', 'Thise')];

describe('what the model said, made safe', () => {
  it('keeps the order it was given when the model returns a clean one', () => {
    expect(validate(THREE, { order: ['c', 'a', 'b'], arrangement: 'stagger' }).order)
      .toEqual(['c', 'a', 'b']);
  });

  /*
   * The failure that would actually cost something: a tile printing one
   * product twice and silently dropping another, under one price that
   * claims to cover both.
   */
  it('drops a repeat and keeps every product exactly once', () => {
    expect(validate(THREE, { order: ['a', 'a', 'b'] }).order).toEqual(['a', 'b', 'c']);
  });

  it('ignores an id that is not in the cell', () => {
    expect(validate(THREE, { order: ['b', 'zzz', 'a', 'c'] }).order)
      .toEqual(['b', 'a', 'c']);
  });

  it('falls back to the plain order when the model returns nothing usable', () => {
    expect(validate(THREE, {}).order).toEqual(['a', 'b', 'c']);
    expect(validate(THREE, null).order).toEqual(['a', 'b', 'c']);
  });

  it('refuses an arrangement the stylesheet cannot draw', () => {
    expect(validate(THREE, { arrangement: 'carousel' }).arrangement).toBe('stagger');
    expect(validate(THREE, { arrangement: 'fan' }).arrangement).toBe('fan');
  });

  /*
   * A heading that overruns is set smaller by the stylesheet until it
   * fits, so a tile whose type is half the size of its neighbours' is
   * the same bug wearing different clothes.
   */
  it('caps the two lines and flattens their whitespace', () => {
    const said = validate(THREE, {
      heading: `  Thise   økologisk\n ost  ${'x'.repeat(200)}`,
      support: 'Flere   varianter.  Frit valg.',
    });
    expect(said.heading.startsWith('Thise økologisk ost')).toBe(true);
    expect(said.heading.length).toBeLessThanOrEqual(60);
    expect(said.support).toBe('Flere varianter. Frit valg.');
  });

  it('leaves the wording empty when the model wrote none', () => {
    expect(validate(THREE, { order: ['a', 'b', 'c'] })).toMatchObject({
      heading: '', support: '',
    });
  });
});

describe('the arrangement nobody chose', () => {
  it('blocks four or more and staggers fewer', () => {
    expect(defaultArrangement(6, 'hero')).toBe('grid');
    expect(defaultArrangement(4, 'standard')).toBe('grid');
    expect(defaultArrangement(3, 'standard')).toBe('stagger');
  });

  it('keeps a compact cell to a plain row, whatever the count', () => {
    // At that size anything but a row is mush — see `MAX_PACK`.
    expect(defaultArrangement(6, 'compact')).toBe('row');
  });
});

describe('the prompt', () => {
  /*
   * Pinned because the prompt is the whole of this feature that can be
   * read: it is what decides whether the cell comes back looking like a
   * page of a leaflet or like a product listing.
   */
  it('names all four arrangements the stylesheet draws', () => {
    for (const shape of ['row', 'stagger', 'grid', 'fan']) {
      expect(ARRANGE_SYSTEM).toContain(shape);
    }
  });

  it('forbids the two things a model must never decide here', () => {
    // Geometry belongs to the stylesheet, and a price belongs to the
    // data — a headline that states one can contradict the mark beside it.
    expect(ARRANGE_SYSTEM).toContain('Never a price');
    expect(ARRANGE_SYSTEM).toMatch(/nothing about colour, size, position, pixels or CSS/);
  });

  it('says the group has a front, which is the whole difference', () => {
    expect(ARRANGE_SYSTEM).toContain('FRONT');
  });
});
