import type { Offer, TemplateLibrary } from '@incitio/schema';
import { compareByImportance, offerImportance } from './scoring.js';

export interface PageGroup {
  title: string;
  subtitle: string;
  offers: Offer[];
}

/**
 * Splits `total` into chunk sizes the library can actually lay out.
 *
 * Done with dynamic programming rather than greedy chunking because greedy
 * strands remainders — 11 offers against sizes {4,6,9} greedily gives
 * 9 + 2, and there is no two-slot template, so two offers get dropped.
 * The DP finds 6 + 5... or, failing an exact partition, the packing that
 * wastes fewest slots.
 */
export function partitionCount(total: number, sizes: number[]): number[] {
  if (total <= 0) return [];
  const available = [...new Set(sizes)].filter((s) => s > 0).sort((a, b) => a - b);
  if (available.length === 0) return [];

  const smallest = available[0]!;
  // best[n] = the partition of exactly n, or null when n is unreachable.
  const best: (number[] | null)[] = new Array(total + 1).fill(null);
  best[0] = [];

  for (let n = 1; n <= total; n += 1) {
    for (const size of available) {
      if (size > n) break;
      const prev = best[n - size];
      if (!prev) continue;
      const candidate = [...prev, size];
      const incumbent = best[n];
      if (!incumbent || candidate.length < incumbent.length) best[n] = candidate;
    }
  }

  const exact = best[total];
  if (exact) return exact.sort((a, b) => b - a);

  // No exact partition: fill with the largest reachable prefix and give the
  // stragglers the smallest page, leaving some slots empty rather than
  // silently dropping offers.
  for (let n = total - 1; n > 0; n -= 1) {
    const partial = best[n];
    if (partial) return [...partial, smallest].sort((a, b) => b - a);
  }
  return [smallest];
}

/**
 * Groups offers into pages. M0 rule: one section per category, most
 * important offers first so they land on early pages and in hero slots.
 *
 * This is the function the M4 Claude planner replaces — the contract
 * (Offer[] in, PageGroup[] out) is fixed now precisely so that swap is a
 * drop-in rather than a rewrite of everything downstream.
 */
/**
 * Most offers a page may carry.
 *
 * Without a ceiling the paginator always picks the largest template that
 * divides the category evenly, because that yields the fewest pages — and
 * the mined library goes up to 12. Real leaflets do not: SuperBrugsen
 * averages 4.0 offers per page and never exceeds 7. Overcrowding was also
 * rated a dealbreaker, so it is capped rather than merely discouraged.
 */
export const DEFAULT_MAX_OFFERS_PER_PAGE = 8;

export function paginateByCategory(
  offers: Offer[],
  library: TemplateLibrary,
  maxPerPage: number = DEFAULT_MAX_OFFERS_PER_PAGE,
): PageGroup[] {
  const allSizes = [...new Set(library.templates.map((t) => t.slots.length))];
  const withinCap = allSizes.filter((n) => n <= maxPerPage);
  // If no template is small enough, the cap cannot be honoured; use the
  // smallest available rather than emitting nothing.
  const sizes = withinCap.length > 0 ? withinCap : [Math.min(...allSizes)];
  const byCategory = new Map<string, Offer[]>();

  for (const offer of offers) {
    const key = offer.category || 'uncategorised';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(offer);
    else byCategory.set(key, [offer]);
  }

  // Categories carrying the strongest offers open the catalog. Ties break
  // on the category name so page order does not depend on feed row order.
  const categories = [...byCategory.entries()].sort((a, b) => {
    const peak = (list: Offer[]) => Math.max(...list.map(offerImportance));
    const diff = peak(b[1]) - peak(a[1]);
    if (Math.abs(diff) > 1e-9) return diff;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  const groups: PageGroup[] = [];
  for (const [category, list] of categories) {
    const ranked = [...list].sort(compareByImportance);
    const chunks = partitionCount(ranked.length, sizes);

    let cursor = 0;
    chunks.forEach((size, index) => {
      const slice = ranked.slice(cursor, cursor + size);
      cursor += size;
      if (slice.length === 0) return;
      groups.push({
        title: titleCase(category),
        subtitle: chunks.length > 1 ? `${index + 1} af ${chunks.length}` : '',
        offers: slice,
      });
    });
  }
  return groups;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
