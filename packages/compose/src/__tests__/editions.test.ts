import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer, type CatalogPage } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { resolveVariant } from '@incitio/edit/core';
import {
  BASE_EDITION, checkEditions, feedToEdition, mergeEditionFeeds, splitMergedFeed,
} from '../editions.js';

const { brand } = getBrand('superbrugsen');
const offer = (id: string, name: string, price: number) => Offer.parse({
  id, name, price, validFrom: '2026-09-01', validTo: '2026-09-30', quantity: { size: null, unit: 'pcs' },
});
const page = (id: string, templateId: string, cells: [string, string][]): CatalogPage => ({
  id, templateId, title: id, placements: cells.map(([slotId, offerId]) => ({ slotId, offerId })),
} as unknown as CatalogPage);

const week = [
  offer('1', 'Elkedel, 1,7 L', 139), offer('2', 'Brødrister', 159),
  offer('3', 'Bagepapir, 24 ark', 9.9), offer('4', 'Trillebør', 849), offer('5', 'Fælgrens', 39.9),
];
const base = CatalogDocument.parse({
  id: 'uge40', schemaVersion: 2, name: 'Uge 40', brandId: 'superbrugsen',
  createdAt: '2026-09-28', updatedAt: '2026-09-28',
  offers: week,
  pages: [
    page('forside', 'sb/duo-2', [['a', '4'], ['b', '5']]),
    page('hjem', 'sb/hero-3', [['hero', '1'], ['a', '2'], ['b', '3']]),
  ],
  variants: [
    { id: 'jylland', name: 'Jylland', stores: ['s-401', 's-402'] },
    { id: 'holbaek', name: 'Holbæk', stores: ['s-415'] },
  ],
});

/** Holbæk's file: brødrister cheaper, no bagepapir, one product of its own. */
const holbaekFile = [
  offer('1', 'Elkedel, 1,7 L', 139), offer('2', 'Brødrister', 129),
  offer('4', 'Trillebør', 849), offer('5', 'Fælgrens', 39.9), offer('77', 'Affaldsposer 20-pak', 8.9),
];

describe('an edition from its own file', () => {
  it('prices, what it does not sell and its own products become the edition — the base is untouched', () => {
    const { variant, diff } = feedToEdition(base, 'holbaek', { name: 'holbaek.json', readAt: 'now', offers: holbaekFile }, brand);
    expect(diff.removed.map((r) => r.offer.id)).toEqual(['3']);
    const withIt = { ...base, variants: base.variants!.map((v) => (v.id === 'holbaek' ? variant : v)) };
    const holbaek = resolveVariant(withIt, 'holbaek', brand).document;
    expect(holbaek.offers.find((o) => o.id === '2')!.price).toBe(129);
    expect(holbaek.pages.flatMap((p) => p.placements.map((pl) => pl.offerId))).not.toContain('3');
    expect(variant.offers.map((o) => o.id)).toEqual(['77']);
    expect(base.offers.find((o) => o.id === '2')!.price).toBe(159);
    // Uploading the same file again changes nothing.
    const again = feedToEdition(withIt, 'holbaek', { name: 'holbaek.json', readAt: 'later', offers: holbaekFile }, brand);
    expect(again.diff.changed).toEqual([]);
    expect(again.diff.removed).toEqual([]);
  });

  it('the check says what prints wrong, per edition, before and after the file is applied', () => {
    const before = checkEditions(
      { ...base, variants: base.variants!.map((v) => (v.id === 'holbaek' ? { ...v, feed: { name: 'h', readAt: '', offers: holbaekFile } } : v)) },
      { name: 'uge40.json', offers: week }, brand,
    );
    expect(before.map((c) => [c.name, c.problems, c.onPages])).toEqual([
      ['Alle butikker', 0, 5], ['Jylland', 0, 5], ['Holbæk', 2, 5],
    ]);
    expect(before[2]!.unplaced.map((o) => o.id)).toEqual(['77']);

    const { variant } = feedToEdition(base, 'holbaek', { name: 'h', readAt: '', offers: holbaekFile }, brand);
    const after = checkEditions({ ...base, variants: [base.variants![0]!, variant] }, { name: 'uge40.json', offers: week }, brand);
    expect(after[2]!.problems).toBe(0);
    expect(after[2]!.onPages).toBe(4);
  });
});

describe('several feeds as one output', () => {
  const editions = [
    { id: 'jylland', name: 'Jylland', stores: ['s-401'], offers: null },
    { id: 'holbaek', name: 'Holbæk', stores: ['s-415'], offers: holbaekFile },
  ];

  it('rows every edition shares stay single; a local price or product is scoped', () => {
    const merged = mergeEditionFeeds('superbrugsen', week, editions);
    const row = (id: string) => merged.offers.find((o) => o.id === id)!;
    expect(row('1').editions).toBeUndefined();
    expect(row('2')).toMatchObject({ price: 159, editions: [BASE_EDITION, 'jylland'] });
    expect(row('2@holbaek')).toMatchObject({ price: 129, editions: ['holbaek'] });
    expect(row('3').editions).toEqual([BASE_EDITION, 'jylland']);
    expect(row('77').editions).toEqual(['holbaek']);
    expect(merged.offers).toHaveLength(week.length + 2);
    expect(merged.editions!.map((e) => e.id)).toEqual([BASE_EDITION, 'jylland', 'holbaek']);
  });

  it('splits back into exactly the files it was merged from', () => {
    const split = splitMergedFeed(mergeEditionFeeds('superbrugsen', week, editions));
    const ids = (offers: Offer[]) => offers.map((o) => `${o.id}:${o.price}`).sort();
    expect(ids(split.get(BASE_EDITION)!)).toEqual(ids(week));
    expect(ids(split.get('jylland')!)).toEqual(ids(week));
    expect(ids(split.get('holbaek')!)).toEqual(ids(holbaekFile));
  });
});
