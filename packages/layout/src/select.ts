import type { Offer } from '@incitio/schema';
import { compareByImportance, offerImportance } from './scoring.js';

/**
 * Which offers make the catalog at all.
 *
 * This is an editorial decision, not a layout one, and it was missing:
 * the pipeline laid out every offer it was given, so nemlig's 1,235-offer
 * range became a 162-page catalog. A real leaflet publishes a fraction of
 * the range — SuperBrugsen runs 160 offers over 40 pages.
 *
 * Deterministic by design. The M4 planner will eventually make this call
 * with better judgement, and it plugs in exactly here: same signature,
 * same result shape, so nothing downstream changes.
 */
export interface SelectionOptions {
  /** How many offers the finished catalog should contain. */
  targetCount: number;
  /**
   * Most of the catalog any single category may occupy. Without it a
   * range heavy in one category (nemlig lists 213 drinks) crowds out
   * everything else, and the catalog stops representing the shop.
   */
  maxCategoryShare?: number;
  /** Categories represented at all get at least this many slots. */
  minPerCategory?: number;
  /** Drop offers with no artwork — they render as a placeholder tile. */
  requireImage?: boolean;
  /** Offer ids the retailer insists on, selected before anything else. */
  pinned?: string[];
}

export interface SelectionReject {
  offerId: string;
  category: string;
  reason: string;
}

export interface SelectionResult {
  selected: Offer[];
  rejected: SelectionReject[];
  /** How many offers each category contributed. */
  byCategory: Record<string, number>;
}

const DEFAULTS = {
  maxCategoryShare: 0.25,
  minPerCategory: 2,
  requireImage: true,
};

export function selectOffers(offers: Offer[], options: SelectionOptions): SelectionResult {
  const maxShare = options.maxCategoryShare ?? DEFAULTS.maxCategoryShare;
  const minPer = options.minPerCategory ?? DEFAULTS.minPerCategory;
  const requireImage = options.requireImage ?? DEFAULTS.requireImage;
  const target = Math.max(0, Math.floor(options.targetCount));
  const pinned = new Set(options.pinned ?? []);

  const rejected: SelectionReject[] = [];
  const eligible: Offer[] = [];

  for (const offer of offers) {
    if (requireImage && !offer.imageUrl && !pinned.has(offer.id)) {
      rejected.push({ offerId: offer.id, category: offer.category, reason: 'no image' });
      continue;
    }
    eligible.push(offer);
  }

  if (target === 0 || eligible.length === 0) {
    return {
      selected: [],
      rejected: [
        ...rejected,
        ...eligible.map((o) => ({ offerId: o.id, category: o.category, reason: 'not selected' })),
      ],
      byCategory: {},
    };
  }

  const byCategory = new Map<string, Offer[]>();
  for (const offer of eligible) {
    const key = offer.category || 'uncategorised';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(offer);
    else byCategory.set(key, [offer]);
  }
  for (const list of byCategory.values()) list.sort(compareByImportance);

  // The requested cap may make the target unreachable — three categories
  // at 25% each can only ever fill 75% of a catalog. Raising the ceiling
  // uniformly keeps the mix balanced; abandoning it (the obvious fix)
  // hands the whole remainder to the single strongest category, which is
  // exactly the imbalance the cap exists to prevent.
  const requestedCap = Math.max(1, Math.floor(target * maxShare));
  const cap = effectiveCap(
    [...byCategory.values()].map((list) => list.length),
    target,
    requestedCap,
  );
  const selected = new Map<string, Offer>();

  // Pinned offers bypass every quota — a retailer's contractual placement
  // is not the engine's decision to make.
  for (const offer of eligible) {
    if (pinned.has(offer.id) && selected.size < target) selected.set(offer.id, offer);
  }

  // Round 1: a floor for every category, so a catalog with sixteen
  // categories does not publish only the two strongest.
  const categories = [...byCategory.keys()].sort();
  for (const category of categories) {
    const list = byCategory.get(category) ?? [];
    for (const offer of list.slice(0, minPer)) {
      if (selected.size >= target) break;
      selected.set(offer.id, offer);
    }
  }

  // Round 2: fill the rest by strength, honouring the per-category cap.
  const counts = new Map<string, number>();
  for (const offer of selected.values()) {
    counts.set(offer.category, (counts.get(offer.category) ?? 0) + 1);
  }
  const ranked = [...eligible].sort(compareByImportance);
  for (const offer of ranked) {
    if (selected.size >= target) break;
    if (selected.has(offer.id)) continue;
    const used = counts.get(offer.category) ?? 0;
    if (used >= cap) continue;
    selected.set(offer.id, offer);
    counts.set(offer.category, used + 1);
  }

  // Safety net: with the cap already raised to a feasible level this
  // should not bind, but a catalog short of its target is worse than a
  // slightly uneven one.
  if (selected.size < target) {
    for (const offer of ranked) {
      if (selected.size >= target) break;
      if (!selected.has(offer.id)) selected.set(offer.id, offer);
    }
  }

  for (const offer of eligible) {
    if (!selected.has(offer.id)) {
      rejected.push({
        offerId: offer.id,
        category: offer.category,
        reason: (counts.get(offer.category) ?? 0) >= cap ? 'category quota full' : 'ranked below cut',
      });
    }
  }

  const result = [...selected.values()].sort(compareByImportance);
  const tally: Record<string, number> = {};
  for (const offer of result) tally[offer.category] = (tally[offer.category] ?? 0) + 1;

  return { selected: result, rejected, byCategory: tally };
}

/**
 * Smallest per-category ceiling, at or above the requested one, that lets
 * the target be reached. Returns the largest category's size when even
 * that is not enough.
 */
function effectiveCap(categorySizes: number[], target: number, requested: number): number {
  const largest = Math.max(...categorySizes, 1);
  for (let cap = requested; cap <= largest; cap += 1) {
    const reachable = categorySizes.reduce((sum, size) => sum + Math.min(size, cap), 0);
    if (reachable >= target) return cap;
  }
  return largest;
}

/** Convenience: how many offers fill a page count at a given density. */
export function targetForPages(pages: number, offersPerPage: number): number {
  return Math.max(0, Math.round(pages * offersPerPage));
}

export { offerImportance };
