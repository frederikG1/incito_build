import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer, type CatalogPage } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { applyOps, EditError, outline, outlineText, readFlatOp } from '../index.js';

const { brand } = getBrand('superbrugsen');
const offer = (id: string, name: string, price: number) => Offer.parse({
  id, name, price, validFrom: '2026-09-04', validTo: '2026-09-10', quantity: { size: null, unit: 'pcs' },
});
const page = (id: string, templateId: string, cells: [string, string][]): CatalogPage => ({
  id, templateId, title: id, placements: cells.map(([slotId, offerId]) => ({ slotId, offerId })),
} as unknown as CatalogPage);

const doc = CatalogDocument.parse({
  id: 'sb-2026-u36', schemaVersion: 2, name: 'Uge 36', brandId: 'superbrugsen',
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
  offers: [offer('ost', 'Klovborg', 30), offer('øl', 'Tuborg', 99), offer('mælk', 'Letmælk', 10), offer('smør', 'Lurpak', 20), offer('kaffe', 'Lavazza', 59)],
  pages: [
    page('p1', 'sb/hero-3', [['hero', 'ost'], ['a', 'øl'], ['b', 'mælk']]),
    page('p2', 'sb/duo-2', [['a', 'smør']]),
  ],
});

const at = (d: CatalogDocument, offerId: string) => {
  for (const p of d.pages) {
    const hit = p.placements.find((x) => x.offerId === offerId);
    if (hit) return `${p.id}/${hit.slotId}`;
  }
  return 'reserve';
};

describe('applyOps', () => {
  it('swaps two placed offers across pages, each keeping its own tweaks', () => {
    const tweaked = applyOps(doc, [{ op: 'part', offerId: 'øl', part: 'price', scale: 1.4 }], brand).document;
    const { document } = applyOps(tweaked, [{ op: 'swap', offerId: 'øl', withOfferId: 'smør' }], brand);
    expect([at(document, 'øl'), at(document, 'smør')]).toEqual(['p2/a', 'p1/a']);
    const øl = document.pages[1]!.placements.find((p) => p.offerId === 'øl')!;
    expect(øl.overrides.parts['price']!.scale).toBe(1.4);
  });

  it('swaps with a reserve offer: it takes the slot, the other goes to reserve', () => {
    const { document, applied } = applyOps(doc, [{ op: 'swap', offerId: 'mælk', withOfferId: 'kaffe' }], brand);
    expect([at(document, 'kaffe'), at(document, 'mælk')]).toEqual(['p1/b', 'reserve']);
    expect(applied[0]).toBe('Lavazza tog pladsen fra Letmælk, som gik i reserve');
  });

  it('makes an offer the lead by moving it into the biggest slot', () => {
    const { document } = applyOps(doc, [{ op: 'lead', offerId: 'mælk' }], brand);
    expect([at(document, 'mælk'), at(document, 'ost')]).toEqual(['p1/hero', 'p1/b']);
  });

  it('places into an empty slot and refuses a slot the layout does not have', () => {
    const { document } = applyOps(doc, [{ op: 'place', offerId: 'kaffe', pageId: 'p2', slotId: 'b' }], brand);
    expect(at(document, 'kaffe')).toBe('p2/b');
    expect(() => applyOps(doc, [{ op: 'place', offerId: 'kaffe', pageId: 'p2', slotId: 'z' }], brand))
      .toThrow(/has no slot "z" \(has a, b\)/);
  });

  it('is all or nothing, and names the op that failed', () => {
    try {
      applyOps(doc, [{ op: 'remove', offerId: 'ost' }, { op: 'remove', offerId: 'nope' }], brand);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EditError);
      expect((error as EditError).message).toBe('op 2: no offer "nope"');
    }
    expect(at(doc, 'ost')).toBe('p1/hero');
  });

  it('writes wording where the renderer reads it, and clamps geometry to the schema', () => {
    const { document } = applyOps(doc, [
      { op: 'text', offerId: 'ost', part: 'name', text: 'Klovborg skiver' },
      { op: 'text', offerId: 'ost', part: 'quantity', text: '' },
      { op: 'part', offerId: 'ost', part: 'media', scale: 9, offsetX: 0.2 },
    ], brand);
    const o = document.pages[0]!.placements[0]!.overrides;
    expect(o.displayName).toBe('Klovborg skiver');
    expect(o.parts['quantity']!.text).toBe('');
    expect([o.imageScale, o.imageOffsetX]).toEqual([2, 0.2]);
    expect(CatalogDocument.safeParse(document).success).toBe(true);
  });

  it('re-lays a page, keeping pinned tiles when the new layout is smaller', () => {
    const pinned = applyOps(doc, [{ op: 'pin', offerId: 'mælk', pinned: true }], brand).document;
    const { document, applied } = applyOps(pinned, [{ op: 'layout', pageId: 'p1', templateId: 'sb/duo-2' }], brand);
    expect(document.pages[0]!.templateId).toBe('sb/duo-2');
    expect([at(document, 'ost'), at(document, 'mælk'), at(document, 'øl')]).toEqual(['p1/a', 'p1/b', 'reserve']);
    expect(applied[0]).toMatch(/1 i reserve/);
  });

  it('corrects a price and the saving follows', () => {
    const { document } = applyOps(doc, [{ op: 'price', offerId: 'øl', price: 89, prePrice: 129 }], brand);
    expect(document.offers.find((o) => o.id === 'øl')).toMatchObject({ price: 89, prePrice: 129, savings: 40 });
  });
});

describe('outline', () => {
  it('lists every slot with its offer, the reserve and the layouts, in a few lines', () => {
    const o = outline(doc, brand);
    expect(o.pages[1]!.slots).toEqual([
      expect.objectContaining({ slotId: 'a', offerId: 'smør' }),
      expect.objectContaining({ slotId: 'b', offerId: null }),
    ]);
    expect(o.reserve.map((r) => r.offerId)).toEqual(['kaffe']);
    const text = outlineText(o);
    expect(text).toContain('side 1 pageId=p1 layout=sb/hero-3: p1');
    expect(text).toContain('  hero (hero) ost: Klovborg — 30,-');
    expect(text).toContain('  b (hero) — tom');
  });
});

describe('readFlatOp', () => {
  it('turns the model\'s flat answer into an op, and says why when it is not one', () => {
    const flat = { op: 'part', offerId: 'ost', part: 'media', scale: 1.2, withOfferId: '', text: null, arrangement: '' };
    expect(readFlatOp(flat)).toEqual({ op: { op: 'part', offerId: 'ost', part: 'media', scale: 1.2 } });
    expect(readFlatOp({ op: 'arrange', offerId: 'ost', arrangement: 'auto' })).toEqual({ op: { op: 'arrange', offerId: 'ost', arrangement: null } });
    expect(readFlatOp({ op: 'swap', offerId: 'ost', withOfferId: '' })).toEqual({ reason: expect.stringMatching(/withOfferId/) });
    expect(readFlatOp({ op: 'text', offerId: 'ost', part: 'name', text: null })).toEqual({ op: { op: 'text', offerId: 'ost', part: 'name', text: null } });
  });
});

describe('editions that differ by page', () => {
  it('leaves a page out of an edition; its offers go to reserve', () => {
    const { document, applied } = applyOps(doc, [{ op: 'removePage', pageId: 'p1' }], brand);
    expect(document.pages.map((p) => p.id)).toEqual(['p2']);
    expect(at(document, 'ost')).toBe('reserve');
    expect(document.offers).toHaveLength(doc.offers.length);
    expect(applied[0]).toMatch(/udeladt; 3 i reserve/);
  });

  it('grows a full page into the document\'s own grid family before the chain\'s', () => {
    const grid = (n: number) => ({
      id: `cms/grid-${n}`, name: `Tilbudsgitter · ${n}`, areas: [[...'abcdefghij'.slice(0, n)].join(' ')],
      slots: [...'abcdefghij'.slice(0, n)].map((id) => ({ id, role: 'standard', bleed: 1 })),
    });
    const withGrids = CatalogDocument.parse({
      ...doc, templates: [grid(1), grid(2)],
      pages: [page('ja', 'cms/grid-1', [['a', 'ost']])],
    });
    const { document } = applyOps(withGrids, [{ op: 'add', offerId: 'kaffe', pageId: 'ja' }], brand);
    expect(document.pages[0]!.templateId).toBe('cms/grid-2');
  });
});

describe('adjust', () => {
  const overridesOf = (d: CatalogDocument, id: string) => d.pages.flatMap((p) => p.placements).find((p) => p.offerId === id)!.overrides;

  it('merges over what is set and drops what is back at zero', () => {
    let d = applyOps(doc, [{ op: 'adjust', offerId: 'ost', adjust: { brightness: 0.2, blend: 'multiply' } }], brand).document;
    d = applyOps(d, [{ op: 'adjust', offerId: 'ost', adjust: { brightness: 0, contrast: 0.1 } }], brand).document;
    expect(overridesOf(d, 'ost').adjust).toEqual({ blend: 'multiply', contrast: 0.1 });
  });
  it('develops one product of a cluster on its own, and leaves no key when cleared', () => {
    let d = applyOps(doc, [{ op: 'adjust', offerId: 'øl', index: 1, adjust: { saturation: -1 } }], brand).document;
    expect(overridesOf(d, 'øl').pack['1']!.adjust).toEqual({ saturation: -1 });
    d = applyOps(d, [{ op: 'adjust', offerId: 'øl', index: 1, adjust: null }], brand).document;
    expect(overridesOf(d, 'øl').pack).toEqual({});
  });
  it('is undone by reset', () => {
    const d = applyOps(doc, [{ op: 'adjust', offerId: 'ost', adjust: { hue: 30 } }, { op: 'reset', offerId: 'ost' }], brand).document;
    expect(overridesOf(d, 'ost').adjust).toBeUndefined();
  });
});
