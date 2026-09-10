import { describe, expect, it } from 'vitest';
import type { Offer } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { composeCatalog } from '../compose.js';
import { chooseTemplate, partitionCount, planByCategory, seededRandom } from '../plan.js';
import type { CataloguePlan } from '../plan.js';

const NETTO = getBrand('netto').brand;

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
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
    quantity: { size: null, unit: 'pcs', pieceCount: 1 },
    validFrom: '2026-09-14',
    validTo: '2026-09-20',
    imageUrl: '/images/x.svg',
    imagePack: [],
    labels: [],
    priority: null,
    ...overrides,
  };
}

describe('partitionCount', () => {
  it('finds an exact partition rather than stranding a remainder', () => {
    // Greedy takes 9 first and leaves 1, which no template holds. The DP
    // finds 6 + 4 and every offer gets a slot.
    expect(partitionCount(10, [4, 6, 9])).toEqual([6, 4]);
  });

  it('prefers fewer pages', () => {
    expect(partitionCount(12, [4, 6, 9])).toEqual([6, 6]);
  });

  it('leaves slots empty rather than dropping offers when no partition exists', () => {
    // 11 is unreachable from {4,6,9}. Overshooting wastes three slots;
    // undershooting would lose an offer, which is the worse trade.
    expect(partitionCount(11, [4, 6, 9]).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(11);
    expect(partitionCount(5, [4, 9]).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
  });

  it('is empty for nothing to place', () => {
    expect(partitionCount(0, [4])).toEqual([]);
  });
});

describe('chooseTemplate', () => {
  it('prefers an exact fit', () => {
    const id = chooseTemplate(NETTO, 6, [], seededRandom('a'));
    expect(NETTO.templates.find((t) => t.id === id)!.slots).toHaveLength(6);
  });

  it('avoids the templates the last few pages used', () => {
    const fours = NETTO.templates.filter((t) => t.slots.length === 4).map((t) => t.id);
    const id = chooseTemplate(NETTO, 4, fours, seededRandom('a'));
    // Only one four-slot layout exists, so it has to come back — but it
    // must still be a layout that can hold four, not a smaller one.
    expect(NETTO.templates.find((t) => t.id === id)!.slots.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to a roomier layout when nothing fits exactly', () => {
    const id = chooseTemplate(NETTO, 5, [], seededRandom('a'));
    expect(NETTO.templates.find((t) => t.id === id)!.slots.length).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic for one seed', () => {
    const a = chooseTemplate(NETTO, 6, [], seededRandom('same'));
    const b = chooseTemplate(NETTO, 6, [], seededRandom('same'));
    expect(a).toBe(b);
  });
});

describe('planByCategory', () => {
  const offers = [
    ...Array.from({ length: 7 }, (_, i) => offer(`m${i}`, { category: 'mejeri' })),
    ...Array.from({ length: 5 }, (_, i) => offer(`k${i}`, { category: 'kolonial' })),
  ];

  /*
   * A page is either all one category, or it says so. The heading is a
   * claim about the contents, and a page titled "Mejeri" holding yarn
   * and batteries is the failure this ordering exists to prevent.
   */
  it('either keeps a page pure or marks it as mixed', () => {
    for (const page of planByCategory(NETTO, offers, 6).pages) {
      const categories = new Set(
        page.offerIds.map((id) => offers.find((o) => o.id === id)!.category),
      );
      if (categories.size > 1) expect(page.subtitle).toBe('m.m.');
    }
  });

  it('titles a page after its majority category', () => {
    for (const page of planByCategory(NETTO, offers, 6).pages) {
      const tally = new Map<string, number>();
      for (const id of page.offerIds) {
        const category = offers.find((o) => o.id === id)!.category;
        tally.set(category, (tally.get(category) ?? 0) + 1);
      }
      const [lead] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
      expect(page.title.toLowerCase()).toBe(lead.toLowerCase());
    }
  });

  /*
   * The regression that mattered: one page per category left a
   * 1,235-offer range printing three pages of two offers on eight-slot
   * layouts, and dropping the rest.
   */
  it('fills pages rather than giving every category its own', () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      offer(`x${i}`, { category: `kat${i % 12}` }));
    const plan = planByCategory(NETTO, many, 4);
    const smallest = Math.min(...NETTO.templates.map((t) => t.slots.length));
    // Only the last page may run short — it holds whatever was left.
    for (const page of plan.pages.slice(0, -1)) {
      expect(page.offerIds.length).toBeGreaterThanOrEqual(smallest);
    }
    expect(plan.pages.flatMap((p) => p.offerIds).length).toBeGreaterThan(12);
  });

  it('marks a page that had to mix categories', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      offer(`y${i}`, { category: `kat${i}` }));
    const plan = planByCategory(NETTO, many, 3);
    // Every category holds one offer, so mixing is unavoidable — and the
    // heading must say so rather than claiming the page is all one thing.
    expect(plan.pages.some((page) => page.subtitle === 'm.m.')).toBe(true);
  });

  it('honours the page ceiling and reports what did not fit', () => {
    const plan = planByCategory(NETTO, offers, 1);
    expect(plan.pages).toHaveLength(1);
    const placed = plan.pages.flatMap((p) => p.offerIds).length;
    expect(placed + plan.dropped.length).toBe(offers.length);
  });

  it('varies page density instead of maxing out every page', () => {
    // Always taking the largest capacity printed four identical eight-up
    // grids, because the page size is what fixes the template.
    const many = Array.from({ length: 40 }, (_, i) =>
      offer(`v${i}`, { category: `kat${i % 3}` }));
    const sizes = planByCategory(NETTO, many, 8).pages.map((p) => p.offerIds.length);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it('names a template this chain owns', () => {
    const owned = new Set(NETTO.templates.map((t) => t.id));
    for (const page of planByCategory(NETTO, offers, 6).pages) {
      expect(owned.has(page.templateId)).toBe(true);
    }
  });
});

describe('composeCatalog', () => {
  const offers = Array.from({ length: 6 }, (_, i) => offer(`o${i}`));
  const base = { id: 'c1', name: 'Uge 38', brand: NETTO };

  function plan(pages: Partial<CataloguePlan['pages'][number]>[]): CataloguePlan {
    return {
      pages: pages.map((page) => ({
        title: 'Side', subtitle: '', templateId: 'netto/grid-6',
        offerIds: [], rationale: '', ...page,
      })),
      dropped: [],
    };
  }

  it('seats the page\'s lead offer in the hero slot', () => {
    const { document } = composeCatalog(
      plan([{ templateId: 'netto/hero-5', offerIds: ['o0', 'o1', 'o2', 'o3', 'o4'] }]),
      offers, base,
    );
    const hero = document.pages[0]!.placements.find((p) => p.slotId === 'hero');
    expect(hero?.offerId).toBe('o0');
  });

  /*
   * The isolation guarantee, at the point it actually binds: a plan may
   * name any string, and composition must never resolve one belonging to
   * another chain.
   */
  it('substitutes a template from another chain and says so', () => {
    const result = composeCatalog(
      plan([{ templateId: 'sb/grid-4', offerIds: ['o0', 'o1', 'o2', 'o3'] }]),
      offers, base,
    );
    const used = result.document.pages[0]!.templateId;
    expect(used.startsWith('netto/')).toBe(true);
    expect(result.substitutions[0]?.asked).toBe('sb/grid-4');
    expect(result.substitutions[0]?.reason).toContain('findes ikke');
  });

  it('substitutes a template too small for its page', () => {
    const result = composeCatalog(
      plan([{ templateId: 'netto/split-4', offerIds: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5'] }]),
      offers, base,
    );
    expect(result.document.pages[0]!.placements).toHaveLength(6);
    expect(result.substitutions[0]?.reason).toContain('pladser');
  });

  it('reports invented offer ids instead of failing', () => {
    const result = composeCatalog(
      plan([{ offerIds: ['o0', 'ghost', 'o1'] }]), offers, base,
    );
    expect(result.unknown).toEqual(['ghost']);
    expect(result.document.pages[0]!.placements).toHaveLength(2);
  });

  it('never prints one offer twice', () => {
    const result = composeCatalog(
      plan([{ offerIds: ['o0', 'o1'] }, { offerIds: ['o1', 'o2'] }]), offers, base,
    );
    const printed = result.document.pages.flatMap((p) => p.placements.map((x) => x.offerId));
    expect(new Set(printed).size).toBe(printed.length);
  });

  it('embeds only the offers that reached a page', () => {
    const result = composeCatalog(plan([{ offerIds: ['o0', 'o1'] }]), offers, base);
    expect(result.document.offers.map((o) => o.id)).toEqual(['o0', 'o1']);
  });

  it('stamps the catalogue with its own brand', () => {
    const result = composeCatalog(plan([{ offerIds: ['o0'] }]), offers, base);
    expect(result.document.brandId).toBe('netto');
    expect(result.document.schemaVersion).toBe(2);
  });

  it('produces the same document twice for one seed', () => {
    const p = plan([{ templateId: '', offerIds: ['o0', 'o1', 'o2'] }]);
    const a = composeCatalog(p, offers, { ...base, seed: 's' }).document;
    const b = composeCatalog(p, offers, { ...base, seed: 's' }).document;
    expect(a.pages).toEqual(b.pages);
  });
});
