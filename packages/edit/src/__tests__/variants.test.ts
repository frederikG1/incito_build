import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer, type CatalogPage } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { applyOps, diffToOps, newVariant, recordVariant, resolveVariant, variantSummary } from '../core.js';

/*
 * Shaped on Biltema's "Alt til en god september" (Tjek CMS, W36–W40
 * 2026): nineteen store publications with identical designs, where
 * Holbæk's one difference from Næstved is offer 262023 — affaldsposer,
 * 8,90, "3 for 20,90" — as a fourth offer in the section Næstved fills
 * with three. Laid out here on SuperBrugsen's layouts, which is the
 * chain the repo has; the delta is the same.
 */
const { brand } = getBrand('superbrugsen');
const offer = (id: string, name: string, price: number) => Offer.parse({
  id, name, price, validFrom: '2026-09-01', validTo: '2026-09-30', quantity: { size: null, unit: 'pcs' },
});
const page = (id: string, templateId: string, cells: [string, string][]): CatalogPage => ({
  id, templateId, title: id, placements: cells.map(([slotId, offerId]) => ({ slotId, offerId })),
} as unknown as CatalogPage);

const base = CatalogDocument.parse({
  id: 'biltema-sep', schemaVersion: 2, name: 'Alt til en god september', brandId: 'superbrugsen',
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
  offers: [
    offer('37831', 'Fælgrens, 500 ml', 39.9), offer('14399', 'Trillebør, 160 liter', 849),
    offer('841334', 'Elkedel, 1,7 L', 139), offer('840083', 'Brødrister', 159),
    offer('858023', 'Bagepapir, 24 ark', 9.9), offer('360240', 'Håndopvaskemiddel, 1 liter', 9.9),
  ],
  pages: [
    page('intro', 'sb/duo-2', [['a', '37831'], ['b', '14399']]),
    page('miljo-nederst', 'sb/hero-3', [['hero', '841334'], ['a', '840083'], ['b', '858023']]),
  ],
  variants: [
    { id: 'naestved', name: 'Næstved', stores: ['auto-generated-for-store-401'] },
    {
      id: 'holbaek', name: 'Holbæk', stores: ['auto-generated-for-store-415'],
      offers: [offer('262023', 'Affaldspose 30 liter, 20-pak', 8.9)],
      ops: [{ op: 'add', offerId: '262023', pageId: 'miljo-nederst' }],
    },
  ],
});

/** The offers on a page in its layout's slot order. */
const onPage = (d: CatalogDocument, pageId: string) => {
  const page = d.pages.find((p) => p.id === pageId)!;
  const slots = brand.templates.find((t) => t.id === page.templateId)!.slots.map((s) => s.id);
  return [...page.placements].sort((a, b) => slots.indexOf(a.slotId) - slots.indexOf(b.slotId)).map((p) => p.offerId);
};
const bySlot = (d: CatalogDocument) => d.pages.map((p) => [...p.placements].sort((a, b) => a.slotId.localeCompare(b.slotId)));

describe('local variants', () => {
  it('Næstved is the base; Holbæk is the base plus one offer, and its section grows a cell', () => {
    expect(onPage(resolveVariant(base, 'naestved', brand).document, 'miljo-nederst')).toEqual(['841334', '840083', '858023']);
    const holbaek = resolveVariant(base, 'holbaek', brand);
    expect(holbaek.conflicts).toEqual([]);
    const section = holbaek.document.pages.find((p) => p.id === 'miljo-nederst')!;
    expect(section.placements.map((p) => p.offerId)).toEqual(['841334', '840083', '858023', '262023']);
    expect(brand.templates.find((t) => t.id === section.templateId)!.slots).toHaveLength(4);
    expect(variantSummary(base, holbaek.variant, brand)).toEqual({ added: 1, removed: 0, moved: 0, repriced: 0, conflicts: 0 });
  });

  it('an edit to the base reaches every edition — nothing to copy', () => {
    const edited = applyOps(base, [
      { op: 'price', offerId: '841334', price: 119 },
      { op: 'lead', offerId: '840083' },
    ], brand).document;
    for (const id of ['naestved', 'holbaek']) {
      const { document } = resolveVariant(edited, id, brand);
      expect(document.offers.find((o) => o.id === '841334')!.price).toBe(119);
      expect(onPage(document, 'miljo-nederst')[0]).toBe('840083');
    }
  });

  it('an op the base no longer supports is named, and the rest of the edition still stands', () => {
    const variant = { ...base.variants![1]!, ops: [...base.variants![1]!.ops, { op: 'price' as const, offerId: '858023', price: 7.9 }] };
    const moved = applyOps({ ...base, variants: [variant] }, [{ op: 'remove', offerId: '858023' }], brand).document;
    // The price op still applies (the offer is in the document, only not on a page) — so remove it outright:
    const gone = { ...moved, offers: moved.offers.filter((o) => o.id !== '858023') };
    const holbaek = resolveVariant(gone, 'holbaek', brand);
    expect(holbaek.conflicts).toEqual(['2. price 858023: no offer "858023"']);
    expect(onPage(holbaek.document, 'miljo-nederst')).toContain('262023');
  });

  it('records what staff did to an edition as ops, and replaying them gives the same pages', () => {
    const shown = resolveVariant(base, 'holbaek', brand).document;
    const worked = applyOps(shown, [
      { op: 'swap', offerId: '37831', withOfferId: '360240' },
      { op: 'price', offerId: '262023', price: 7.9 },
      { op: 'text', offerId: '841334', part: 'name', text: 'Elkedel i glas' },
      { op: 'part', offerId: '841334', part: 'media', scale: 1.3 },
    ], brand).document;

    const { variant, unrepresented } = recordVariant(base, base.variants![1]!, worked, brand);
    expect(unrepresented).toEqual([]);
    expect(variant.offers.map((o) => o.id)).toEqual(['262023']);

    const replay = resolveVariant({ ...base, variants: [variant] }, 'holbaek', brand).document;
    expect(bySlot(replay)).toEqual(bySlot(worked));
    expect(replay.offers.find((o) => o.id === '262023')!.price).toBe(7.9);
  });

  it('keeps a store\'s own placing of the products inside a cluster, and leaves the base alone', () => {
    const shown = resolveVariant(base, 'holbaek', brand).document;
    const worked = applyOps(shown, [
      { op: 'pack', offerId: '841334', index: 2, offsetX: 4.5, offsetY: -3, scale: 1.2, rotate: -8, depth: 2 },
      { op: 'pack', offerId: '841334', index: 0, hidden: true },
    ], brand).document;

    const { variant, unrepresented } = recordVariant(base, base.variants![1]!, worked, brand);
    expect(unrepresented).toEqual([]);
    const replay = resolveVariant({ ...base, variants: [variant] }, 'holbaek', brand).document;
    const pack = (d: CatalogDocument) => d.pages.flatMap((p) => p.placements).find((p) => p.offerId === '841334')!.overrides.pack;
    expect(pack(replay)).toEqual(pack(worked));
    expect(pack(replay)['2']).toMatchObject({ offsetX: 4.5, scale: 1.2, rotate: -8, depth: 2 });
    expect(pack(resolveVariant(base, 'naestved', brand).document)).toEqual({});

    // Put back where it was, it leaves no key behind.
    const back = applyOps(worked, [{ op: 'pack', offerId: '841334', index: 0, hidden: false }], brand).document;
    expect(Object.keys(pack(back))).toEqual(['2']);
  });

  it('says what the ops cannot express instead of dropping it', () => {
    const after = { ...base, pages: [...base.pages, page('extra', 'sb/duo-2', [])] };
    expect(diffToOps(base, after, brand).unrepresented).toEqual(['page extra was added']);
  });

  it('names a new edition uniquely', () => {
    expect(newVariant(base, 'Holbæk').id).toBe('holbaek-2');
    expect(newVariant(base, 'Sønderborg').id).toBe('sonderborg');
  });
});
