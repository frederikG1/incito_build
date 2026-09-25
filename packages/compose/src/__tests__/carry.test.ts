import { describe, expect, it } from 'vitest';
import { PlacementOverrides, type CatalogDocument, type Offer, type PageTemplate } from '@incitio/schema';
import { carryForward, mentionsDate, priceTheme } from '../carry.js';
import { applyFeedDiff, feedDiff } from '../diff.js';
import { departmentOf, pageDepartment } from '../department.js';

function offer(id: string, name: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id, name, description: '', brand: '', category: 'Side 1',
    price: 10, priceFrom: false, prePrice: null, savings: null, savingsMax: null,
    currency: 'DKK', comparison: null,
    quantity: { size: null, unit: 'pcs', pieceCount: 1 }, pack: '',
    validFrom: '2026-09-28', validTo: '2026-10-04',
    imageUrl: '/images/x.png', imagePack: [], labels: [], priority: null, members: [],
    ...overrides,
  };
}

const GRID: PageTemplate = {
  id: 'doc/two',
  name: 'To',
  areas: ['a b'],
  slots: [{ id: 'a', role: 'standard', bleed: 1 }, { id: 'b', role: 'hero', bleed: 1 }],
};

function book(pages: { offers: Offer[]; notes?: string[] }[]): CatalogDocument {
  return {
    id: 'u40', schemaVersion: 2, name: 'uge 40', brandId: 'superbrugsen',
    week: { year: 2026, week: 40 },
    offers: pages.flatMap((page) => page.offers),
    templates: [GRID],
    createdAt: '', updatedAt: '',
    pages: pages.map((page, n) => ({
      id: `p${n}`, kind: 'offers', templateId: GRID.id, title: '', subtitle: '', rationale: '',
      ground: '#fff1b8', decorations: [], background: null, texts: {}, incito: null, exact: false,
      notes: (page.notes ?? []).map((text, i) => ({
        id: `n${i}`, text, x: 0, y: 0, w: 0.5, size: 0.04, color: '#000', bold: true,
        align: 'center', rotate: 0, background: null, image: null, h: null, behind: false,
      })),
      placements: page.offers.map((o, i) => ({ offerId: o.id, slotId: ['a', 'b', 'c'][i]!, overrides: PlacementOverrides.parse({}) })),
    })) as CatalogDocument['pages'],
  };
}

const options = {
  templateFor: (id: string) => (id === GRID.id ? GRID : undefined),
  week: { year: 2026, week: 41 },
  brandName: 'SuperBrugsen',
  id: 'u41',
  now: '2026-09-24T00:00:00.000Z',
};

describe('departmentOf', () => {
  it('reads frozen off the underline before the name', () => {
    expect(departmentOf(offer('1', 'Coop kylling', { description: 'Dybfrost. 750 g.' }))).toBe('frost');
    expect(departmentOf(offer('2', 'Coop kylling'))).toBe('koed');
  });

  it('does not read "øl" inside "pølse", or "vin" inside "vingummi"', () => {
    expect(departmentOf(offer('1', 'Langelænder pølser'))).toBe('koed');
    expect(departmentOf(offer('2', 'Haribo vingummi'))).toBe('slik');
    expect(departmentOf(offer('3', 'Carlsberg eller Tuborg øl'))).toBe('vin');
  });

  it('lets a one-department category beat a wandering underline', () => {
    const wine = offer('1', 'Spier Signature', { category: 'Vin og spiritus', description: 'Passer til fisk og kød' });
    // "og" makes it a combined category, so the grape list has to carry it.
    expect(departmentOf({ ...wine, name: 'Spier Signature Chardonnay' })).toBe('vin');
    expect(departmentOf(offer('2', 'Ukendt', { category: 'Drikkevarer', description: 'spor af nødder' }))).toBe('drikke');
  });

  it('calls a page mixed when no department holds half of it', () => {
    expect(pageDepartment([offer('1', 'Coop bacon'), offer('2', 'Red Bull'), offer('3', 'Lurpak smør')])).toBeNull();
    expect(pageDepartment([offer('1', 'Coop bacon'), offer('2', 'Coop mørbrad')])).toBe('koed');
  });
});

describe('carryForward', () => {
  const last = book([
    { offers: [offer('a1', 'Coop bacon'), offer('a2', 'Red Bull')] },
    { offers: [offer('b1', 'Premier is', { description: 'Dybfrost' }), offer('b2', 'Coop pizza', { description: 'Dybfrost' })] },
    { offers: [offer('c1', 'Coop hakket oksekød'), offer('c2', 'Coop mørbrad')], notes: ['Gælder fra fredag d. 2. oktober'] },
  ]);

  const feed = [
    offer('n1', 'Coop kyllingebryst', { prePrice: 60, price: 30 }),
    offer('n2', 'Ben & Jerry is', { description: 'Dybfrost' }),
    offer('n3', 'Coop entrecote'),
    offer('n4', 'Coop ispinde', { description: 'Dybfrost', prePrice: 40, price: 20 }),
    offer('n5', 'Faxe Kondi', { prePrice: 20, price: 10 }),
    offer('n6', 'Lambi toiletpapir'),
  ];

  const { document, report } = carryForward(last, feed, options);

  it('keeps every page and its design, and names the new week', () => {
    expect(document.pages.map((page) => page.id)).toEqual(['p0', 'p1', 'p2']);
    expect(document.pages[1]!.ground).toBe('#fff1b8');
    expect(document.name).toBe('SuperBrugsen · uge 41');
    expect(document.week).toEqual({ year: 2026, week: 41 });
    expect(document.offers.map((o) => o.id).sort()).toEqual(feed.map((o) => o.id).sort());
  });

  it('gives the front page the strongest offers, from anywhere', () => {
    const front = document.pages[0]!.placements;
    // The hero cell ("b") takes the strongest: n1 and n4 tie on depth, n1 wins on id.
    expect(front.find((p) => p.slotId === 'b')!.offerId).toBe('n1');
    expect(front).toHaveLength(2);
  });

  it('deals the frozen page frozen offers and the meat page meat', () => {
    const frozen = document.pages[1]!.placements.map((p) => p.offerId);
    expect(frozen).toEqual(expect.arrayContaining(['n2']));
    const meat = document.pages[2]!.placements.map((p) => p.offerId);
    expect(meat).toContain('n3');
    expect(meat).not.toContain('n6');
  });

  it('leaves a cell empty rather than put toilet paper on the meat page', () => {
    expect(report.filled).toBeLessThan(report.cells);
    expect(document.pages.flatMap((p) => p.placements).some((p) => p.offerId === 'n6')).toBe(false);
    expect(report.reserve).toBeGreaterThan(0);
  });

  it('keeps a price-point page on its price points', () => {
    const krone = book([
      { offers: [offer('f1', 'Coop bacon'), offer('f2', 'Red Bull')] },
      { offers: [offer('k1', 'Knorr sauce', { price: 10 }), offer('k2', 'Katjes slik', { price: 20 }), offer('k3', 'Actimel', { price: 10 })] },
    ]);
    krone.templates = [{ ...GRID, areas: ['a b c'], slots: [...GRID.slots, { id: 'c', role: 'standard', bleed: 1 }] }];
    const next = carryForward(krone, [
      offer('x1', 'Coop bacon', { prePrice: 60, price: 30 }),
      offer('x2', 'Coop mørbrad', { prePrice: 60, price: 30 }),
      offer('x3', 'Pasta', { price: 13, prePrice: 30 }),
      offer('x4', 'Ketchup', { price: 10 }),
      offer('x5', 'Mayo', { price: 20 }),
      offer('x6', 'Haribo slik', { price: 10 }),
    ], { ...options, templateFor: () => krone.templates[0] });
    const second = next.document.pages[1]!.placements.map((p) => next.document.offers.find((o) => o.id === p.offerId)!.price);
    expect(second.sort()).toEqual([10, 10, 20]);
    expect(priceTheme([{ price: 10 }, { price: 19.95 }, { price: 10 }])).toBeNull();
  });

  it('flags notes that carry last week\'s dates', () => {
    expect(report.datedNotes).toEqual([{ pageId: 'p2', noteId: 'n0', text: 'Gælder fra fredag d. 2. oktober' }]);
    expect(mentionsDate('Kun i weekenden')).toBe(false);
    expect(mentionsDate('Gælder t.o.m. 4/10')).toBe(true);
  });
});

describe('feedDiff', () => {
  const doc = book([{ offers: [offer('a', 'Coop bacon', { price: 25 }), offer('b', 'Rossini laks')] }]);
  doc.offers.push(offer('r', 'I reserve'));
  const feed = [
    offer('a', 'Coop bacon', { price: 22 }),
    offer('x9', 'I reserve'),
    offer('n', 'Ny vare'),
  ];
  const diff = feedDiff(doc, feed);

  it('finds a changed price on a page, a pulled product, and a new one', () => {
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.fields).toEqual([{ field: 'price', before: 25, after: 22 }]);
    expect(diff.changed[0]!.pageId).toBe('p0');
    expect(diff.removed.map((r) => r.offer.id)).toEqual(['b']);
    expect(diff.added.map((o) => o.id)).toEqual(['n']);
    // Matched by name when the id changed between files.
    expect(diff.unchanged).toBe(1);
  });

  it('applies under the old id and leaves pulled products for a person', () => {
    const next = applyFeedDiff(doc, diff);
    expect(next.offers.find((o) => o.id === 'a')!.price).toBe(22);
    expect(next.offers.some((o) => o.id === 'b')).toBe(true);
    expect(next.offers.some((o) => o.id === 'n')).toBe(true);
    expect(next.pages[0]!.placements.map((p) => p.offerId)).toEqual(['a', 'b']);
  });
});
