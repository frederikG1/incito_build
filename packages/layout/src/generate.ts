import type {
  CatalogDocument,
  CatalogPage,
  ImageProfile,
  Offer,
  Theme,
  TemplateLibrary,
} from '@incitio/schema';
import { AUTHORED_LIBRARY, templatesForCount } from './templates.js';
import { DEFAULT_MAX_OFFERS_PER_PAGE, paginateByCategory, type PageGroup } from './paginate.js';
import { selectOffers, type SelectionOptions, type SelectionReject } from './select.js';
import { solvePageCandidates } from './solver.js';
import type { ScoringWeights } from './scoring.js';

export interface GenerateOptions {
  id: string;
  name: string;
  retailerId: string;
  theme: Theme;
  pageAspect?: number;
  library?: TemplateLibrary;
  profiles?: Map<string, ImageProfile>;
  weights?: ScoringWeights;
  /** Supply page groups directly to bypass category pagination (M4 planner). */
  groups?: PageGroup[];
  /** Most offers any one page may carry. See DEFAULT_MAX_OFFERS_PER_PAGE. */
  maxOffersPerPage?: number;
  /**
   * Editorial selection. Omit to lay out every offer supplied — correct
   * for a feed already curated to catalog size, wrong for a full range.
   */
  selection?: SelectionOptions;
}

export interface GenerateResult {
  document: CatalogDocument;
  /** Offers no template could legally hold. Surfaced, never silently dropped. */
  unplaced: string[];
  /** Offers deliberately left out of the catalog, with the reason. */
  notSelected: SelectionReject[];
  /** Offers per category in the finished catalog. */
  categoryMix: Record<string, number>;
}

/**
 * Offers in, CatalogDocument out. Everything intelligent is injected:
 * `groups` comes from the planner, `profiles` from the ML sidecar,
 * `library` from the miner. With none of them supplied this still produces
 * a complete, correct catalog — which is what makes M0 shippable ahead of
 * the AI work rather than blocked behind it.
 */
export function generateCatalog(offers: Offer[], opts: GenerateOptions): GenerateResult {
  const library = opts.library ?? AUTHORED_LIBRARY;
  const pageAspect = opts.pageAspect ?? 0.707;
  const maxPerPage = opts.maxOffersPerPage ?? DEFAULT_MAX_OFFERS_PER_PAGE;

  // Selection runs before pagination: deciding what goes in the catalog
  // is an editorial question, and laying out what was never meant to be
  // published wastes the solver's effort on offers destined to be cut.
  const selection = opts.selection
    ? selectOffers(offers, opts.selection)
    : { selected: offers, rejected: [], byCategory: {} };

  const groups = opts.groups ?? paginateByCategory(selection.selected, library, maxPerPage);

  const pages: CatalogPage[] = [];
  const unplaced: string[] = [];

  groups.forEach((group, index) => {
    // Exact-fit templates first; fall back to any template with room, so an
    // odd group size still renders instead of failing the whole catalog.
    let candidates = templatesForCount(library, group.offers.length);
    if (candidates.length === 0) {
      candidates = library.templates.filter(
        (t) => t.slots.length >= group.offers.length && t.slots.length <= maxPerPage,
      );
    }
    if (candidates.length === 0) {
      candidates = [...library.templates].sort((a, b) => b.slots.length - a.slots.length).slice(0, 3);
    }
    if (candidates.length === 0) return;

    const solved = solvePageCandidates(group.offers, candidates, {
      pageAspect,
      ...(opts.profiles ? { profiles: opts.profiles } : {}),
      ...(opts.weights ? { weights: opts.weights } : {}),
    });

    const winner = solved[0];
    if (!winner) return;

    unplaced.push(...winner.unplaced);
    pages.push({
      id: `page-${index + 1}`,
      templateId: winner.templateId,
      title: group.title,
      subtitle: group.subtitle,
      placements: winner.placements,
    });
  });

  const now = new Date().toISOString();
  return {
    notSelected: selection.rejected,
    categoryMix: selection.byCategory,
    document: {
      id: opts.id,
      schemaVersion: 1,
      name: opts.name,
      retailerId: opts.retailerId,
      theme: opts.theme,
      pageAspect,
      pages,
      createdAt: now,
      updatedAt: now,
    },
    unplaced,
  };
}
