import type { CatalogPage, ImageProfile, Offer, PageTemplate, Placement } from '@incitio/schema';
import { slotArea } from './geometry.js';
import {
  DEFAULT_WEIGHTS,
  colorDistance,
  compareByImportance,
  placementScore,
  type FitContext,
  type ScoringWeights,
} from './scoring.js';
import { isPlacementLegal, type ConstraintContext } from './constraints.js';

export interface SolveOptions {
  pageAspect: number;
  profiles?: Map<string, ImageProfile>;
  weights?: ScoringWeights;
  /** How many refinement sweeps to run. Each is O(slots^2). */
  maxPasses?: number;
}

export interface SolvedPage {
  templateId: string;
  placements: Placement[];
  score: number;
  /** Offers that could not be placed legally in this template. */
  unplaced: string[];
}

/**
 * Page-level terms that only make sense once every tile is assigned:
 * two garish neighbours, or the same brand twice in a row, are invisible
 * to a per-placement score but obvious to a reader.
 */
function adjacencyPenalty(
  placements: Placement[],
  offers: Map<string, Offer>,
  template: PageTemplate,
  profiles: Map<string, ImageProfile>,
  weights: ScoringWeights,
): number {
  const slots = new Map(template.slots.map((s) => [s.id, s]));
  let penalty = 0;

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const pa = placements[i];
      const pb = placements[j];
      if (!pa || !pb) continue;
      const sa = slots.get(pa.slotId);
      const sb = slots.get(pb.slotId);
      if (!sa || !sb) continue;

      // Only neighbours matter: share an edge horizontally or vertically.
      const touchesX = sa.x + sa.w === sb.x || sb.x + sb.w === sa.x;
      const touchesY = sa.y + sa.h === sb.y || sb.y + sb.h === sa.y;
      const overlapY = sa.y < sb.y + sb.h && sb.y < sa.y + sa.h;
      const overlapX = sa.x < sb.x + sb.w && sb.x < sa.x + sa.w;
      const adjacent = (touchesX && overlapY) || (touchesY && overlapX);
      if (!adjacent) continue;

      const oa = offers.get(pa.offerId);
      const ob = offers.get(pb.offerId);
      if (!oa || !ob) continue;

      if (oa.brand && oa.brand === ob.brand) penalty += weights.brandRepeat;

      const ca = profiles.get(pa.offerId)?.dominantColors[0];
      const cb = profiles.get(pb.offerId)?.dominantColors[0];
      if (ca && cb) {
        const distance = colorDistance(ca, cb);
        // Near-identical neighbours merge visually; violently opposed ones
        // fight. Both ends are penalised, the comfortable middle is not.
        if (distance < 0.12) penalty += weights.colorClash * (1 - distance / 0.12);
        else if (distance > 0.8) penalty += weights.colorClash * ((distance - 0.8) / 0.2) * 0.6;
      }
    }
  }
  return penalty;
}

export function scorePage(
  placements: Placement[],
  offers: Map<string, Offer>,
  template: PageTemplate,
  opts: SolveOptions,
): number {
  const profiles = opts.profiles ?? new Map();
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const ctx: FitContext = { template, pageAspect: opts.pageAspect, profiles, weights };
  const slots = new Map(template.slots.map((s) => [s.id, s]));

  let total = 0;
  for (const placement of placements) {
    const offer = offers.get(placement.offerId);
    const slot = slots.get(placement.slotId);
    if (offer && slot) total += placementScore(offer, slot, ctx);
  }
  return total - adjacencyPenalty(placements, offers, template, profiles, weights);
}

/**
 * Assigns offers to a template's slots.
 *
 * Greedy seeding (most important offer into the most prominent slot) gets
 * close, then pairwise swaps polish it. Swap-based local search is used
 * rather than an exact solver because the page-level adjacency terms make
 * the objective non-separable — and because a solver that runs in
 * milliseconds can be re-run on every keystroke in the editor.
 */
export function solvePage(
  offers: Offer[],
  template: PageTemplate,
  opts: SolveOptions,
): SolvedPage {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const profiles = opts.profiles ?? new Map();
  const offerMap = new Map(offers.map((o) => [o.id, o]));
  const fitCtx: FitContext = { template, pageAspect: opts.pageAspect, profiles, weights };
  const constraintCtx: ConstraintContext = { template, profiles };

  // Prominence, not raw area: a hero role outranks a merely large filler.
  const roleRank = { hero: 2, standard: 1, filler: 0 } as const;
  const slots = [...template.slots].sort((a, b) => {
    if (roleRank[a.role] !== roleRank[b.role]) return roleRank[b.role] - roleRank[a.role];
    return slotArea(b, template) - slotArea(a, template);
  });

  const ranked = [...offers].sort(compareByImportance);

  const placements: Placement[] = [];
  const used = new Set<string>();

  for (const slot of slots) {
    let best: { offer: Offer; score: number } | null = null;
    for (const offer of ranked) {
      if (used.has(offer.id)) continue;
      if (!isPlacementLegal(offer, slot, constraintCtx)) continue;
      const score = placementScore(offer, slot, fitCtx);
      if (!best || score > best.score) best = { offer, score };
    }
    if (best) {
      used.add(best.offer.id);
      placements.push({
        offerId: best.offer.id,
        slotId: slot.id,
        overrides: {
          pinned: false,
          displayName: null,
          imageScale: 1,
          imageOffsetX: 0,
          imageOffsetY: 0,
        },
      });
    }
  }

  // Local refinement: swap any two placements whenever it improves the
  // page total and both resulting placements stay legal.
  const maxPasses = opts.maxPasses ?? 4;
  let current = scorePage(placements, offerMap, template, opts);
  const slotById = new Map(template.slots.map((s) => [s.id, s]));

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const pa = placements[i];
        const pb = placements[j];
        if (!pa || !pb) continue;
        if (pa.overrides.pinned || pb.overrides.pinned) continue;

        const oa = offerMap.get(pa.offerId);
        const ob = offerMap.get(pb.offerId);
        const sa = slotById.get(pa.slotId);
        const sb = slotById.get(pb.slotId);
        if (!oa || !ob || !sa || !sb) continue;
        if (!isPlacementLegal(oa, sb, constraintCtx)) continue;
        if (!isPlacementLegal(ob, sa, constraintCtx)) continue;

        const swapped = placements.map((p, idx) => {
          if (idx === i) return { ...p, offerId: pb.offerId };
          if (idx === j) return { ...p, offerId: pa.offerId };
          return p;
        });
        const next = scorePage(swapped, offerMap, template, opts);
        if (next > current + 1e-9) {
          placements[i] = { ...pa, offerId: pb.offerId };
          placements[j] = { ...pb, offerId: pa.offerId };
          current = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return {
    templateId: template.id,
    placements,
    score: current,
    unplaced: offers.filter((o) => !used.has(o.id)).map((o) => o.id),
  };
}

/**
 * Tries every candidate template and returns them best-first. Keeping the
 * losers is deliberate: the M5 scorer will re-rank these, and the editor
 * offers them as "try another layout for this page".
 */
export function solvePageCandidates(
  offers: Offer[],
  templates: PageTemplate[],
  opts: SolveOptions,
): SolvedPage[] {
  return templates
    .map((template) => solvePage(offers, template, opts))
    .sort((a, b) => {
      // Leaving offers off the page is worse than any styling gain.
      if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length - b.unplaced.length;
      return b.score - a.score;
    });
}

export function toCatalogPage(
  id: string,
  solved: SolvedPage,
  title = '',
  subtitle = '',
): CatalogPage {
  return { id, templateId: solved.templateId, title, subtitle, placements: solved.placements };
}
