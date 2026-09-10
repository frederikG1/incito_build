import type { Brand, Offer } from '@incitio/schema';
import { brandCapacities, templatesForCount } from '@incitio/brands';
import { compareByImportance } from './importance.js';

/**
 * The contract between curation (step 2) and the template engine (step 3).
 *
 * A plan says WHAT goes on a page and WHICH of the brand's layouts holds
 * it. It never says where a tile sits or how big it is — that is the
 * template's job, and keeping the boundary here is what makes the output
 * reproducible, diffable and editable by hand. A model that emitted
 * coordinates would give up all three.
 */
export interface PlannedPage {
  title: string;
  subtitle: string;
  /** A template id belonging to the catalogue's own brand. */
  templateId: string;
  /** Offers on the page, strongest first. Position 0 leads. */
  offerIds: string[];
  /** One sentence on why these belong together. Editor-facing only. */
  rationale: string;
}

export interface CataloguePlan {
  pages: PlannedPage[];
  /** Offers the plan could not fit within the page budget. */
  dropped: string[];
}

/**
 * Most offers any one page may carry.
 *
 * Real leaflets do not run twelve-up grids: SuperBrugsen averages four
 * offers a page and never exceeds seven, Netto runs three to ten. The
 * ceiling is per brand — it is the largest template that chain owns.
 */
export function maxOffersPerPage(brand: Brand): number {
  return Math.max(...brandCapacities(brand));
}

/**
 * Pages to build by default. A cost control, not an editorial judgement:
 * every offer goes into the curator's prompt, so a 160-offer feed is a
 * large call on every click while iterating. Raise it per run.
 */
export const DEFAULT_MAX_PAGES = 6;

/** How many offers fill a run of `pages` pages for this brand. */
export function offerBudget(brand: Brand, pages: number): number {
  return Math.max(1, pages * maxOffersPerPage(brand));
}

/**
 * Split `total` into page sizes this brand can actually lay out.
 *
 * Dynamic programming rather than greedy chunking, because greedy
 * strands remainders: 11 offers against capacities {4,6,9} greedily
 * gives 9 + 2, and there is no two-slot template, so two offers get
 * dropped. The DP finds 6 + 5, or failing an exact partition, the
 * packing that wastes fewest slots.
 */
export function partitionCount(total: number, capacities: number[]): number[] {
  if (total <= 0) return [];
  const sizes = [...new Set(capacities)].filter((s) => s > 0).sort((a, b) => a - b);
  if (sizes.length === 0) return [];

  const smallest = sizes[0]!;
  // best[n] = the shortest partition of exactly n, or null if unreachable.
  const best: (number[] | null)[] = new Array(total + 1).fill(null);
  best[0] = [];

  for (let n = 1; n <= total; n += 1) {
    for (const size of sizes) {
      if (size > n) break;
      const prev = best[n - size];
      if (!prev) continue;
      const incumbent = best[n];
      if (!incumbent || prev.length + 1 < incumbent.length) best[n] = [...prev, size];
    }
  }

  const exact = best[total];
  if (exact) return exact.sort((a, b) => b - a);

  // No exact partition: take the largest reachable prefix and give the
  // stragglers the smallest page, leaving slots empty rather than
  // silently dropping offers.
  for (let n = total - 1; n > 0; n -= 1) {
    const partial = best[n];
    if (partial) return [...partial, smallest].sort((a, b) => b - a);
  }
  return [smallest];
}

/**
 * Deterministic 0..1 generator seeded from a string (mulberry32).
 *
 * Template choice needs to vary from page to page but must not vary
 * between two runs of the same catalogue, or the editor's pages would
 * reshuffle under them on every reload and a golden test would be
 * meaningless. Variety comes from the sequence, not from fresh entropy.
 */
export function seededRandom(seed: string): () => number {
  let hash = 0x9e3779b9;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x85ebca6b);
    hash = (hash ^ (hash >>> 13)) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one of the brand's templates for a page of `count` offers,
 * avoiding whatever the last few pages used.
 *
 * Published catalogues never print the same grid on two facing pages,
 * and an earlier version of this system did exactly that — every
 * six-offer page got the one template that scored highest, so a ten-page
 * run used three layouts. Rotating through the eligible set is the whole
 * fix, and it needs no scoring model to do it.
 */
export function chooseTemplate(
  brand: Brand,
  count: number,
  recent: string[],
  random: () => number,
): string {
  const exact = templatesForCount(brand, count);
  const roomy = brand.templates
    .filter((t) => t.slots.length >= count)
    .sort((a, b) => a.slots.length - b.slots.length);
  const pool = exact.length > 0 ? exact : roomy.length > 0 ? roomy : brand.templates;

  const fresh = pool.filter((t) => !recent.includes(t.id));
  const eligible = fresh.length > 0 ? fresh : pool;
  return eligible[Math.floor(random() * eligible.length)]!.id;
}

/** How many templates back the "don't repeat" memory reaches. */
export const RECENT_TEMPLATE_MEMORY = 3;

/**
 * The deterministic plan: one section per category, strongest offers
 * first so they open the catalogue and lead their pages.
 *
 * This is what runs when the curator is unavailable or unconfigured. It
 * produces a correct, complete catalogue with dull headlines — which is
 * the right failure mode, because a catalogue that ships beats one that
 * waits for an API.
 */
export function planByCategory(
  brand: Brand,
  offers: Offer[],
  maxPages: number = DEFAULT_MAX_PAGES,
  seed = 'incitio',
  /**
   * Put the same number of offers on every page.
   *
   * Set when the caller named BOTH a count and a page total — "the
   * eight best across two pages" means four and four. Left unset the
   * sizes are drawn for variety, which is right for a whole book and
   * wrong for a two-page brief: drawing gave 2 + 6 and neither page
   * looked deliberate.
   */
  evenPages = false,
): CataloguePlan {
  const capacities = brandCapacities(brand);
  const random = seededRandom(`${seed}:templates`);
  const recent: string[] = [];

  const byCategory = new Map<string, Offer[]>();
  for (const offer of offers) {
    const key = offer.category || 'uncategorised';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(offer);
    else byCategory.set(key, [offer]);
  }

  // Categories carrying the strongest offers open the catalogue. Ties
  // break on the name, so page order does not depend on feed row order.
  const strongest = (list: Offer[]) => [...list].sort(compareByImportance)[0]!;
  const categories = [...byCategory.entries()].sort((a, b) => {
    const diff = compareByImportance(strongest(a[1]), strongest(b[1]));
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });

  const sections = categories.map(([category, list]) => ({
    category,
    offers: [...list].sort(compareByImportance),
  }));

  const smallest = capacities[0]!;
  const pages: PlannedPage[] = [];
  const placed = new Set<string>();
  let sectionIndex = 0;
  let within = 0;

  /*
   * Pages are FILLED, one category at a time.
   *
   * Giving each category its own page is editorially pure and
   * practically useless under a page budget: a 1,235-offer range over
   * two dozen categories produced three pages of two offers each on
   * eight-slot layouts, and dropped everything else. So a page takes as
   * much as it can from the current category, and only spills into the
   * next one when what is left cannot stand alone.
   *
   * The heading is always the majority category, so it stays a true
   * claim about the contents — a page titled "Brød og mejeri" holding
   * yarn and batteries is the failure this ordering exists to avoid.
   */
  /*
   * A page size that fits within `limit`, drawn from the larger half of
   * what fits.
   *
   * Always taking the largest is what an optimiser would do and it
   * produced four consecutive eight-up grids — every page identical,
   * because the size fixes the template. Drawing varies the rhythm the
   * way a real leaflet does, while staying seeded so two runs of the
   * same catalogue still match.
   */
  const pageSize = (limit: number) => {
    const fits = capacities.filter((c) => c <= limit);
    if (fits.length === 0) return smallest;
    if (evenPages) {
      // The size the brief implies, or the nearest layout the chain
      // actually owns.
      const wanted = Math.ceil(offers.length / maxPages);
      return [...fits].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0]!;
    }
    const from = fits.slice(Math.floor(fits.length / 2));
    return from[Math.floor(random() * from.length)]!;
  };

  let remaining = offers.length;

  while (pages.length < maxPages && sectionIndex < sections.length) {
    const section = sections[sectionIndex]!;
    const left = section.offers.length - within;
    if (left === 0) { sectionIndex += 1; within = 0; continue; }

    /*
     * Decide the page's kind before filling it, not while filling it.
     *
     * A category with enough offers gets a page to itself, at the
     * largest size it can fill. A category too small for even the
     * smallest page is going to share one no matter what, so that page
     * is sized against everything still unplaced and filled from as
     * many categories as it takes. Deciding this mid-fill — "stop
     * mixing once the page looks viable" — capped every mixed page at
     * the smallest layout and left two thirds of the feed unplaced.
     */
    /*
     * A stated brief fills its pages before it keeps them pure.
     *
     * "Eight across two pages" means eight reach print. Letting a
     * category's short remainder close a page early published six and
     * dropped two, which is not what was asked for. Without a stated
     * count the reverse holds — a category that can fill a page gets
     * one to itself, and the heading stays a true claim.
     */
    const pure = !evenPages && left >= smallest;
    const target = pure ? pageSize(left) : pageSize(remaining);

    const taken: string[] = [];
    const titles = new Map<string, number>();

    while (taken.length < target && sectionIndex < sections.length) {
      const current = sections[sectionIndex]!;
      const available = current.offers.length - within;
      if (available === 0) {
        if (pure) break;
        sectionIndex += 1;
        within = 0;
        continue;
      }

      const want = Math.min(target - taken.length, available);
      for (const offer of current.offers.slice(within, within + want)) {
        taken.push(offer.id);
        placed.add(offer.id);
      }
      titles.set(current.category, (titles.get(current.category) ?? 0) + want);
      within += want;
      remaining -= want;
    }

    if (taken.length === 0) break;

    const templateId = chooseTemplate(brand, taken.length, recent, random);
    recent.push(templateId);
    if (recent.length > RECENT_TEMPLATE_MEMORY) recent.shift();

    const [lead] = [...titles.entries()].sort((a, b) => b[1] - a[1])[0]!;
    pages.push({
      title: titleCase(lead),
      // Only ever set when a category genuinely spilled, and the title
      // is always the majority — so "m.m." means "and a few others",
      // which is true, rather than papering over an arbitrary mix.
      subtitle: titles.size > 1 ? 'm.m.' : '',
      templateId,
      offerIds: taken,
      rationale: 'grupperet efter kategori',
    });
  }

  return { pages, dropped: offers.filter((o) => !placed.has(o.id)).map((o) => o.id) };
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
