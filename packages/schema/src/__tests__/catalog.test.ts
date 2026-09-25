import { describe, expect, it } from 'vitest';
import {
  CatalogDocument, CatalogPage, PAGE_PARTS, PAGE_PART_NAMES, PAGE_TEXT_DEFAULTS,
  PART_DEFAULTS, PlacementOverrides, TILE_PARTS, TILE_PART_NAMES,
  healLabelPrices, isImagePage,
  mergeCatalogDocuments, pageTextOverride, pageTextPatch, pageTextTouched, pageTextsFreed,
  packStack, partLimits, partOverride, partPatch, partTouched, tileArranged,
} from '../catalog.js';

const fresh = () => PlacementOverrides.parse({});

const sheet = (texts?: unknown) => CatalogPage.parse({
  id: 'p1', templateId: 't', title: 'Fisk og brød', subtitle: 'til den lange arbejdsdag',
  placements: [], ...(texts ? { texts } : {}),
});

describe('page lines', () => {
  it('names every line it can address', () => {
    for (const part of PAGE_PARTS) expect(PAGE_PART_NAMES[part]).toBeTruthy();
  });

  it('reads a page saved before the heading was movable', () => {
    // The field did not exist; a page without it is not broken, it is
    // last week's — and its heading is simply where the masthead puts it.
    const page = sheet();
    expect(page.texts).toEqual({});
    expect(pageTextOverride(page, 'title')).toEqual(PAGE_TEXT_DEFAULTS);
    expect(pageTextTouched(page, 'title')).toBe(false);
  });

  it('writes one line without disturbing the other', () => {
    const page = sheet({ subtitle: { offsetX: 4 } });
    const patched = { ...page, ...pageTextPatch(page, 'title', { offsetY: 12 }) };
    expect(pageTextOverride(patched, 'title').offsetY).toBe(12);
    expect(pageTextOverride(patched, 'subtitle').offsetX).toBe(4);
  });

  it('counts a hidden line as touched but leaves the masthead clipping', () => {
    // Hiding takes the line off the page; it does not move anything out
    // of the strip, so the guard that keeps a long heading off the
    // offers stays exactly where it was. See `pageTextsFreed`.
    const page = sheet({ title: { hidden: true } });
    expect(pageTextTouched(page, 'title')).toBe(true);
    expect(pageTextsFreed(page)).toBe(false);
  });

  it('frees the masthead once a line is moved or resized', () => {
    expect(pageTextsFreed(sheet({ title: { offsetY: 20 } }))).toBe(true);
    expect(pageTextsFreed(sheet({ subtitle: { scale: 1.4 } }))).toBe(true);
    expect(pageTextsFreed(sheet())).toBe(false);
  });

  it('refuses a line pushed further than the sheet is wide', () => {
    expect(() => sheet({ title: { offsetY: 140 } })).toThrow();
    expect(() => sheet({ title: { scale: 9 } })).toThrow();
  });
});

describe('tile parts', () => {
  it('names every box it can address', () => {
    for (const part of TILE_PARTS) expect(TILE_PART_NAMES[part]).toBeTruthy();
  });

  it('reads a catalogue saved before boxes were movable', () => {
    // The field did not exist; a document without it is not a broken
    // document, it is last week's.
    const old = PlacementOverrides.parse({
      pinned: false, displayName: null, description: null,
      imageScale: 1.4, imageOffsetX: -0.2, imageOffsetY: 0,
    });
    expect(old.parts).toEqual({});
    expect(partOverride(old, 'name')).toEqual(PART_DEFAULTS);
  });

  it('reads the artwork out of the three fields that have always held it', () => {
    const o = PlacementOverrides.parse({ imageScale: 1.5, imageOffsetX: -0.4, imageOffsetY: 0.2 });
    expect(partOverride(o, 'media')).toMatchObject({
      scale: 1.5, offsetX: -0.4, offsetY: 0.2,
    });
  });

  it('writes the artwork back to those fields, never to parts', () => {
    const patch = partPatch(fresh(), 'media', { offsetX: 0.5, scale: 1.2 });
    expect(patch).toEqual({ imageOffsetX: 0.5, imageScale: 1.2 });
    expect(patch).not.toHaveProperty('parts');
  });

  it('writes every other box into parts, leaving the others alone', () => {
    const before = { ...fresh(), parts: { name: { ...PART_DEFAULTS, offsetX: 3 } } };
    const patch = partPatch(before, 'quantity', { offsetY: -2 });
    expect(patch.parts?.['name']).toMatchObject({ offsetX: 3 });
    expect(patch.parts?.['quantity']).toMatchObject({ offsetY: -2, offsetX: 0, scale: 1 });
  });

  it('merges into a box rather than replacing it', () => {
    let o = fresh();
    o = { ...o, ...partPatch(o, 'meta', { offsetX: 4 }) };
    o = { ...o, ...partPatch(o, 'meta', { hidden: true }) };
    expect(partOverride(o, 'meta')).toMatchObject({ offsetX: 4, hidden: true });
  });

  it('counts a rewrite and a hide as touched, but not as arranged', () => {
    // "Arranged" is about geometry — it is what makes the tile stop
    // clipping its text block. Renaming a line does not move anything.
    let o = fresh();
    o = { ...o, ...partPatch(o, 'tags', { text: 'Frit valg' }) };
    o = { ...o, ...partPatch(o, 'brand', { hidden: true }) };
    expect(partTouched(o, 'tags')).toBe(true);
    expect(partTouched(o, 'brand')).toBe(true);
    expect(partTouched(o, 'name')).toBe(false);
    expect(tileArranged(o)).toBe(false);

    o = { ...o, ...partPatch(o, 'name', { offsetY: 1.5 }) };
    expect(tileArranged(o)).toBe(true);
  });

  it('keeps its clamps inside what the schema will accept', () => {
    // A limit looser than the schema is a drag that stops writing
    // halfway with no error anywhere.
    for (const part of TILE_PARTS) {
      const { reach, minScale, maxScale } = partLimits(part);
      const at = partPatch(fresh(), part, {
        offsetX: reach, offsetY: -reach, scale: maxScale,
      });
      expect(() => PlacementOverrides.parse({ ...fresh(), ...at })).not.toThrow();
      const low = partPatch(fresh(), part, { scale: minScale });
      expect(() => PlacementOverrides.parse({ ...fresh(), ...low })).not.toThrow();
    }
  });

  it('gives the artwork and the rest different currencies', () => {
    // The artwork moves in fractions of its own frame, everything else
    // in percent of the page. Equal reaches would mean one of the two
    // is wrong by a factor of twenty-five.
    expect(partLimits('media').reach).toBe(1);
    expect(partLimits('name').reach).toBe(25);
  });
});

/* ------------------------------------------------ several pages as one */

function offer(id: string) {
  return {
    id,
    name: `Vare ${id}`,
    description: '',
    brand: '',
    category: 'mejeri',
    price: 10,
    prePrice: null,
    savings: null,
    currency: 'DKK',
    comparison: null,
    quantity: { size: null, unit: 'pcs' as const, pieceCount: 1 },
    validFrom: '2026-09-14',
    validTo: '2026-09-20',
    imageUrl: '/images/x.svg',
    imagePack: [],
    labels: [],
    priority: null,
  };
}

/** One rebuilt page, exactly as `matchPage` returns it: page-1 every time. */
function rebuilt(templateId: string, offerIds: string[]) {
  return CatalogDocument.parse({
    id: 'x-reproduce',
    schemaVersion: 2,
    name: 'X efter p08.jpg',
    brandId: 'x',
    templates: [{
      id: templateId,
      name: templateId,
      areas: offerIds.map((_, i) => `s${i}`),
      slots: offerIds.map((_, i) => ({ id: `s${i}`, role: i === 0 ? 'hero' : 'standard' })),
    }],
    pages: [{
      id: 'page-1',
      templateId,
      title: 'Side',
      placements: offerIds.map((id, i) => ({ offerId: id, slotId: `s${i}` })),
    }],
    offers: offerIds.map(offer),
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  });
}

describe('mergeCatalogDocuments', () => {
  it('renumbers pages, because every rebuilt page calls itself page-1', () => {
    const merged = mergeCatalogDocuments([
      rebuilt('x/a', ['a1', 'a2']),
      rebuilt('x/b', ['b1']),
      rebuilt('x/c', ['c1']),
    ]);
    expect(merged.pages.map((page) => page.id)).toEqual(['page-1', 'page-2', 'page-3']);
    // The order the references were handed in is the order they print.
    expect(merged.pages.map((page) => page.templateId)).toEqual(['x/a', 'x/b', 'x/c']);
  });

  it('carries every layout, so no page renders as unknown', () => {
    const merged = mergeCatalogDocuments([rebuilt('x/a', ['a1']), rebuilt('x/b', ['b1'])]);
    expect(merged.templates.map((t) => t.id)).toEqual(['x/a', 'x/b']);
  });

  it('keeps every page’s offers', () => {
    const merged = mergeCatalogDocuments([rebuilt('x/a', ['a1', 'a2']), rebuilt('x/b', ['b1'])]);
    expect(merged.offers.map((o) => o.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('holds one copy of an offer two pages happen to share', () => {
    // `exclude` is what should stop this happening at all — but a
    // duplicate in the list must not become a duplicate in the document.
    const merged = mergeCatalogDocuments([rebuilt('x/a', ['a1']), rebuilt('x/b', ['a1'])]);
    expect(merged.offers.map((o) => o.id)).toEqual(['a1']);
    expect(merged.pages).toHaveLength(2);
  });

  it('takes its identity from the first page, or from what it is told', () => {
    const parts = [rebuilt('x/a', ['a1']), rebuilt('x/b', ['b1'])];
    expect(mergeCatalogDocuments(parts).id).toBe('x-reproduce');
    expect(mergeCatalogDocuments(parts, { id: 'y', name: 'Uge 38' }))
      .toMatchObject({ id: 'y', name: 'Uge 38' });
  });

  it('is unchanged by merging a single document', () => {
    const one = rebuilt('x/a', ['a1', 'a2']);
    const merged = mergeCatalogDocuments([one]);
    expect(merged.pages).toEqual(one.pages);
    expect(merged.offers).toEqual(one.offers);
  });

  it('refuses to invent a catalogue out of nothing', () => {
    expect(() => mergeCatalogDocuments([])).toThrow();
  });
});

describe('image pages', () => {
  it('reads a page saved before ads existed as an offer page', () => {
    expect(CatalogPage.parse({ id: 'p1', templateId: 't', placements: [] }).kind).toBe('offers');
  });

  it('takes an image page with no template', () => {
    const page = CatalogPage.parse({
      id: 'ad', kind: 'image', placements: [],
      background: { imageUrl: '/uploads/ad.jpg' },
    });
    expect(page.templateId).toBe('');
    expect(isImagePage(page)).toBe(true);
    expect(page.background?.fit).toBe('cover');
  });
});

describe('which product of a cluster paints over which', () => {
  it('puts the middle one in front when nobody has said', () => {
    // Three products: the middle leads, as a printed group does.
    const auto = [0, 1, 2].map((i) => packStack(3, i, 0));
    expect(auto[1]).toBeGreaterThan(auto[0]!);
    expect(auto[1]).toBeGreaterThan(auto[2]!);
    // Four: the two in the middle share the front.
    expect(packStack(4, 1, 0)).toBe(packStack(4, 2, 0));
    expect(packStack(4, 1, 0)).toBeGreaterThan(packStack(4, 0, 0));
  });

  it('lets the editor override it in either direction', () => {
    const auto = [0, 1, 2, 3, 4].map((i) => packStack(5, i, 0));
    const highest = Math.max(...auto);
    const lowest = Math.min(...auto);
    // An outer product brought forward beats the middle one.
    expect(packStack(5, 0, 1)).toBeGreaterThan(highest);
    // The middle one sent back goes under every other.
    expect(packStack(5, 2, -1)).toBeLessThan(lowest);
    // Two brought forward keep the order they were asked in.
    expect(packStack(5, 0, 2)).toBeGreaterThan(packStack(5, 4, 1));
  });

  it('never reaches the words or the price, which print above artwork', () => {
    const all = [-4, -3, -2, -1, 0, 1, 2, 3, 4].flatMap(
      (depth) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => packStack(8, i, depth)),
    );
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    // `.tile__info` sits at 20 and the price mark at 30.
    expect(Math.max(...all)).toBeLessThan(20);
  });
});

describe('healLabelPrices', () => {
  const offer = (id: string, name: string, price: number, description = '') => ({
    id, name, price, description,
    quantity: { size: null, unit: 'pcs' }, validFrom: '2026-09-28', validTo: '2026-10-04',
  });
  const doc = CatalogDocument.parse({
    id: 'u40', schemaVersion: 2, name: 'uge 40', brandId: 'superbrugsen', pages: [],
    offers: [
      offer('a', 'Spangsberg is\n, DKK 32', 0, 'Dybfrost. 360-450 ml.'),
      offer('b', 'Coop koteletter, skinkeschnitzler eller stegeflæsk\n, DKK 39', 0, 'Coop koteletter, skinkeschnitzler eller stegeflæsk'),
      offer('c', 'Udvalgt Fiskars til køkkenet*', 0),
      offer('d', 'Coop bacon', 25),
    ],
    createdAt: '', updatedAt: '',
  });

  it('moves the price out of the name, and drops fine print that only repeated it', () => {
    const { document, healed } = healLabelPrices(doc);
    expect(healed).toBe(2);
    expect(document.offers[0]).toMatchObject({ name: 'Spangsberg is', price: 32, description: 'Dybfrost. 360-450 ml.' });
    expect(document.offers[1]).toMatchObject({ price: 39, description: '' });
    // A display ad with no price stays priceless — and stays flagged.
    expect(document.offers[2]!.price).toBe(0);
  });

  it('hands back the same document when there is nothing to heal', () => {
    const clean = { ...doc, offers: [doc.offers[3]!] };
    expect(healLabelPrices(clean).document).toBe(clean);
  });
});
