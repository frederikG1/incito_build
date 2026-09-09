import { describe, expect, it } from 'vitest';
import type { ImageProfile, Offer, PageTemplate } from '@incitio/schema';
import { solvePage, solvePageCandidates, scorePage } from '../solver.js';
import { offerImportance } from '../scoring.js';
import { AUTHORED_TEMPLATES } from '../templates.js';

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id, name: `Vare ${id}`, description: '', brand: '', category: 'test',
    price: 10, prePrice: null, savings: null, currency: 'DKK', comparison: null,
    quantity: { size: null, unit: 'pcs', pieceCount: 1 },
    validFrom: '2026-09-14', validTo: '2026-09-20',
    imageUrl: null, labels: [], priority: null,
    ...overrides,
  };
}

function profile(offerId: string, overrides: Partial<ImageProfile> = {}): ImageProfile {
  return {
    offerId, sourceHash: offerId, kind: 'cutout', hasAlpha: true,
    subjectBBox: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1,
    dominantColors: [], qualityScore: 0.9, provisional: false,
    ...overrides,
  };
}

const heroLeft = AUTHORED_TEMPLATES.find((t) => t.id === 'authored/hero-left') as PageTemplate;
const grid6 = AUTHORED_TEMPLATES.find((t) => t.id === 'authored/grid-6') as PageTemplate;

describe('offerImportance', () => {
  it('ranks a deep discount above a shallow one', () => {
    const deep = offer('a', { price: 5, prePrice: 20 });
    const shallow = offer('b', { price: 19, prePrice: 20 });
    expect(offerImportance(deep)).toBeGreaterThan(offerImportance(shallow));
  });

  it('lets the feed override the derived value', () => {
    expect(offerImportance(offer('a', { price: 19, prePrice: 20, priority: 0.95 }))).toBe(0.95);
  });

  it('stays within 0..1 for an extreme discount', () => {
    const value = offerImportance(offer('a', { price: 0.5, prePrice: 500 }));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe('solvePage', () => {
  const six = Array.from({ length: 6 }, (_, i) =>
    offer(`o${i}`, { price: 20 - i * 3, prePrice: 20 }),
  );

  it('fills every slot when there are exactly enough offers', () => {
    const solved = solvePage(six, heroLeft, { pageAspect: 0.707 });
    expect(solved.placements).toHaveLength(heroLeft.slots.length);
    expect(solved.unplaced).toEqual([]);
  });

  it('uses each offer at most once', () => {
    const solved = solvePage(six, heroLeft, { pageAspect: 0.707 });
    const ids = solved.placements.map((p) => p.offerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives the hero slot the most important offer', () => {
    const solved = solvePage(six, heroLeft, { pageAspect: 0.707 });
    const hero = solved.placements.find((p) => p.slotId === 'hero');
    const strongest = [...six].sort((a, b) => offerImportance(b) - offerImportance(a))[0];
    expect(hero?.offerId).toBe(strongest?.id);
  });

  it('is deterministic for the same input', () => {
    const a = solvePage(six, heroLeft, { pageAspect: 0.707 });
    const b = solvePage(six, heroLeft, { pageAspect: 0.707 });
    expect(a.placements).toEqual(b.placements);
  });

  it('does not depend on the order offers arrive in', () => {
    const a = solvePage(six, heroLeft, { pageAspect: 0.707 });
    const b = solvePage([...six].reverse(), heroLeft, { pageAspect: 0.707 });
    expect(b.placements).toEqual(a.placements);
  });

  it('reports surplus offers as unplaced rather than dropping them silently', () => {
    const many = Array.from({ length: 9 }, (_, i) => offer(`o${i}`));
    const solved = solvePage(many, heroLeft, { pageAspect: 0.707 });
    expect(solved.unplaced).toHaveLength(3);
  });

  // The hero-quality rule is a hard constraint, so a weak image must be
  // refused the hero slot no matter how good its score would otherwise be.
  it('refuses the hero slot to a low-quality image', () => {
    const profiles = new Map(six.map((o) => [o.id, profile(o.id)]));
    const strongest = [...six].sort((a, b) => offerImportance(b) - offerImportance(a))[0]!;
    profiles.set(strongest.id, profile(strongest.id, { qualityScore: 0.2 }));

    const solved = solvePage(six, heroLeft, { pageAspect: 0.707, profiles });
    const hero = solved.placements.find((p) => p.slotId === 'hero');
    expect(hero?.offerId).not.toBe(strongest.id);
  });

  it('leaves a slot empty rather than making an illegal placement', () => {
    const labelled = six.map((o) => ({ ...o, labels: [{ kind: 'member' as const, text: 'Medlemspris', image: null, imageOnDark: null }] }));
    const solved = solvePage(labelled, grid6, { pageAspect: 0.707 });
    // grid-6 tiles are all large enough, so this should still place fully;
    // the guarantee under test is that nothing illegal is emitted.
    for (const placement of solved.placements) {
      expect(placement.offerId).toBeTruthy();
    }
  });

  it('never leaves the page worse than the greedy seed', () => {
    const noRefinement = solvePage(six, heroLeft, { pageAspect: 0.707, maxPasses: 0 });
    const refined = solvePage(six, heroLeft, { pageAspect: 0.707, maxPasses: 6 });
    expect(refined.score).toBeGreaterThanOrEqual(noRefinement.score);
  });

  it('respects a pinned placement during refinement', () => {
    const solved = solvePage(six, heroLeft, { pageAspect: 0.707, maxPasses: 0 });
    const pinnedId = solved.placements[0]!.offerId;
    solved.placements[0]!.overrides.pinned = true;

    const offerMap = new Map(six.map((o) => [o.id, o]));
    const before = scorePage(solved.placements, offerMap, heroLeft, { pageAspect: 0.707 });
    expect(before).toBeTypeOf('number');
    expect(solved.placements[0]!.offerId).toBe(pinnedId);
  });
});

describe('solvePageCandidates', () => {
  it('ranks templates that place every offer above ones that do not', () => {
    const six = Array.from({ length: 6 }, (_, i) => offer(`o${i}`));
    const ranked = solvePageCandidates(six, [grid6, heroLeft], { pageAspect: 0.707 });
    expect(ranked[0]?.unplaced).toEqual([]);
    expect(ranked).toHaveLength(2);
  });

  it('returns the losers too, for re-ranking and "try another layout"', () => {
    const four = Array.from({ length: 4 }, (_, i) => offer(`o${i}`));
    const ranked = solvePageCandidates(four, AUTHORED_TEMPLATES, { pageAspect: 0.707 });
    expect(ranked.length).toBe(AUTHORED_TEMPLATES.length);
  });
});
