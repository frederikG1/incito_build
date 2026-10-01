import {
  PlacementOverrides, isImagePage, rememberPrinted, slotAssignmentOrder, weekName,
  type CatalogDocument, type CatalogPage, type CatalogWeek, type Offer, type OfferRule, type PageTemplate,
} from '@incitio/schema';
import { byImportance } from './importance.js';
import { departmentOf, familyOf, pageDepartment, type Department } from './department.js';

/**
 * Next week's avis, started from this week's.
 *
 * The leaflet is roughly the same paper every week: the meat spread is
 * where the meat spread was, the frozen pages keep their balloons, the
 * back page is the back page. What changes is WHICH products stand in
 * the cells. So this keeps every page's design — grid, ground,
 * background, artwork, notes, headlines — and deals the new feed into
 * the cells, department by department, strongest offer into the
 * strongest cell.
 *
 * It is the whole of the "Ny uge" button and deliberately contains no
 * model: the same two inputs give the same avis, and every cell it
 * could not fill honestly is left empty for a person, never stuffed
 * with whatever was left.
 */

export interface CarryOptions {
  /** How to find a page's grid: the chain's own, or one the document carries. */
  templateFor: (templateId: string) => PageTemplate | undefined;
  week: CatalogWeek | null;
  brandName: string;
  id: string;
  now?: string;
  /** The chain's offer rules — "fokus på siden" moves an offer up the deal. */
  rules?: readonly OfferRule[];
}

export interface CarriedPage {
  pageId: string;
  department: Department | null;
  cells: number;
  filled: number;
  /** Filled from a neighbouring department because its own ran out. */
  borrowed: number;
  /** Pinned tiles whose product is in the new week too, kept in their cell. */
  kept: number;
}

export interface CarryReport {
  pages: CarriedPage[];
  cells: number;
  filled: number;
  borrowed: number;
  /** Pinned tiles kept in their cell, corrections and all. */
  kept: number;
  /** Pinned tiles whose product is not in the new week — their cell was dealt as usual. */
  pinnedGone: { pageId: string; slotId: string; name: string }[];
  /** Offers in the feed that no page took — the reserve. */
  reserve: number;
  /** Notes that name a date or a weekday, and are therefore last week's. */
  datedNotes: { pageId: string; noteId: string; text: string }[];
}

/** A note that says when something is valid is a note about last week. */
const DATED = /(\d{1,2}\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december))|(\d{1,2}[./-]\d{1,2})|\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b|\buge\s*\d{1,2}\b/iu;

export function mentionsDate(text: string): boolean {
  return DATED.test(text);
}

/** Departments a mixed food page should not be filled from. */
const NOT_FOOD = new Set<Department>(['nonfood', 'pleje', 'husholdning', 'dyr', 'vin']);

/**
 * A page sold on its price rather than its products — "Kronemarked",
 * everything 10,- or 20,- — keeps that promise next week.
 *
 * Read as: three products or more, every price whole kroner, and no
 * more than two of them. Anything looser is an ordinary page whose
 * prices happen to rhyme.
 */
export function priceTheme(offers: Pick<Offer, 'price'>[]): Set<number> | null {
  if (offers.length < 3) return null;
  const prices = new Set(offers.map((offer) => offer.price));
  if (prices.size > 2 || [...prices].some((price) => !Number.isInteger(price))) return null;
  return prices;
}

/**
 * The same product in another week's feed.
 *
 * By id when the feed keeps its ids; Coop's do not — Thise
 * vesterhavsost is 1073780 in week 36 and another number in week 38 —
 * so otherwise by what is printed: the name, and the brand when there is
 * one. Case and spacing do not make a product different.
 */
export function sameProduct(a: Pick<Offer, 'id' | 'name' | 'brand'>, b: Pick<Offer, 'id' | 'name' | 'brand'>): boolean {
  if (a.id === b.id) return true;
  const key = (offer: Pick<Offer, 'name' | 'brand'>) => `${offer.brand}|${offer.name}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return key(a) === key(b);
}

/**
 * What a cell keeps when a new product comes into it: where its boxes
 * stand — the price moved clear of the picture, the headline set larger.
 * That is the cell's design. What belongs to the old product goes: its
 * wording, a box hidden because it had nothing to say, the framing of
 * its photograph, the positions of its packs.
 */
function cellDesign(overrides: PlacementOverrides): PlacementOverrides {
  const parts = Object.fromEntries(Object.entries(overrides.parts)
    .filter(([, part]) => part.offsetX !== 0 || part.offsetY !== 0 || part.scale !== 1)
    .map(([key, part]) => [key, { ...part, hidden: false, text: null }]));
  return PlacementOverrides.parse({ parts });
}

/** Cells of a page, strongest first: hero, feature, standard, compact. */
function cellsOf(page: CatalogPage, templateFor: CarryOptions['templateFor']): string[] {
  const template = templateFor(page.templateId);
  if (template) return slotAssignmentOrder(template).map((slot) => slot.id);
  // A page without a known grid keeps whatever cells it used.
  return page.placements.map((placement) => placement.slotId);
}

export function carryForward(
  previous: CatalogDocument,
  feed: Offer[],
  options: CarryOptions,
): { document: CatalogDocument; report: CarryReport } {
  const now = options.now ?? new Date().toISOString();
  const byId = new Map(previous.offers.map((offer) => [offer.id, offer]));
  const strongest = byImportance(options.rules);

  // One offer per id, and a picture before no picture: a product with no
  // photograph cannot stand in a cell in print.
  const seen = new Set<string>();
  const pool = feed
    .filter((offer) => (seen.has(offer.id) ? false : (seen.add(offer.id), true)))
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || strongest(a, b));
  const department = new Map(pool.map((offer) => [offer.id, departmentOf(offer)]));
  const taken = new Set<string>();

  /** The strongest free offer passing the first test that any offer passes. */
  const take = (...tests: ((offer: Offer) => boolean)[]): Offer | null => {
    for (const accept of tests) {
      const found = pool.find((offer) => !taken.has(offer.id) && accept(offer));
      if (found) {
        taken.add(found.id);
        return found;
      }
    }
    return null;
  };

  interface Work {
    page: CatalogPage;
    department: Department | null;
    /** What last week's page carried, for a mixed page to stay itself. */
    mix: Set<Department>;
    /** "Kronemarked": every price on the page was one of these. */
    prices: Set<number> | null;
    cells: string[];
    dealt: Map<string, string>;
    borrowed: number;
    /** Cells held by a pinned tile, with the corrections it keeps. */
    kept: Map<string, PlacementOverrides>;
  }

  const work: Work[] = previous.pages.map((page) => {
    const old = page.placements
      .map((placement) => byId.get(placement.offerId))
      .filter((offer): offer is Offer => Boolean(offer))
      // A grouped tile speaks for its members, so read them.
      .flatMap((offer) => (offer.members.length > 0
        ? offer.members.map((id) => byId.get(id)).filter((m): m is Offer => Boolean(m))
        : [offer]));
    return {
      page,
      department: isImagePage(page) ? null : pageDepartment(old),
      mix: new Set(old.map(departmentOf)),
      prices: priceTheme(old),
      cells: isImagePage(page) ? [] : cellsOf(page, options.templateFor),
      dealt: new Map(),
      borrowed: 0,
      kept: new Map(),
    };
  });

  /*
   * Pinned first — "Lås varen på pladsen" means exactly this. A pinned
   * tile whose product is in the new week takes its own cell before any
   * dealing starts, with every correction on it. One whose product is
   * gone cannot be kept; its cell is dealt as usual and the report
   * names it, so nobody believes it was.
   */
  const pinnedGone: CarryReport['pinnedGone'] = [];
  for (const item of work) {
    for (const placement of item.page.placements) {
      if (!placement.overrides.pinned || !item.cells.includes(placement.slotId)) continue;
      const was = byId.get(placement.offerId);
      const now = was ? pool.find((offer) => !taken.has(offer.id) && sameProduct(offer, was)) : undefined;
      if (!now) {
        pinnedGone.push({ pageId: item.page.id, slotId: placement.slotId, name: was?.name ?? placement.offerId });
        continue;
      }
      taken.add(now.id);
      item.dealt.set(placement.slotId, now.id);
      item.kept.set(placement.slotId, placement.overrides);
    }
  }
  const free = (item: Work) => item.cells.filter((cell) => !item.dealt.has(cell));

  /*
   * Three passes, in order of how sure the answer is — after the front
   * page, which a leaflet always gives the week's strongest offers.
   *
   * 1. Department pages take their own department, page by page, so
   *    the first frozen page gets the strongest frozen offer.
   * 2. Mixed pages — the front page, "ugens bedste" — take the
   *    strongest of what is left, from anywhere.
   * 3. Department pages still short borrow from their family only.
   */
  /*
   * The front page is the week's shop window: first pick, from anywhere,
   * whatever it happened to carry last week. Two meat offers on last
   * week's cover do not make it the meat page.
   */
  const front = work.find((item) => item.cells.length > 0);
  const food = (offer: Offer) => !NOT_FOOD.has(department.get(offer.id)!);
  const priced = (item: Work) => (offer: Offer) => !item.prices || item.prices.has(offer.price);
  const mixed = (item: Work) => [
    (offer: Offer) => item.mix.has(department.get(offer.id)!) && priced(item)(offer),
    (offer: Offer) => item.mix.has(department.get(offer.id)!),
    (offer: Offer) => food(offer) && priced(item)(offer),
    food,
    () => true,
  ];

  if (front) {
    front.department = null;
    for (const cell of free(front)) {
      // The cover sells food first; what it carried last week is a hint, not a rule.
      const offer = take(food, () => true);
      if (offer) front.dealt.set(cell, offer.id);
    }
  }
  for (const item of work) {
    if (!item.department) continue;
    const own = (offer: Offer) => department.get(offer.id) === item.department;
    for (const cell of free(item)) {
      const offer = take((offer) => own(offer) && priced(item)(offer), own);
      if (offer) item.dealt.set(cell, offer.id);
    }
  }
  for (const item of work) {
    if (item.department || item.cells.length === 0 || item === front) continue;
    for (const cell of free(item)) {
      const offer = take(...mixed(item));
      if (offer) item.dealt.set(cell, offer.id);
    }
  }
  for (const item of work) {
    if (!item.department) continue;
    const family = familyOf(item.department);
    for (const cell of item.cells) {
      if (item.dealt.has(cell)) continue;
      const offer = take((candidate) => family.includes(department.get(candidate.id)!));
      if (offer) {
        item.dealt.set(cell, offer.id);
        item.borrowed += 1;
      }
    }
  }

  const datedNotes: CarryReport['datedNotes'] = [];
  const pages: CatalogPage[] = work.map((item) => {
    const page = item.page;
    for (const note of page.notes) {
      if (mentionsDate(note.text)) datedNotes.push({ pageId: page.id, noteId: note.id, text: note.text });
    }
    if (isImagePage(page)) return page;
    return {
      // What the page printed, from last week's products, before they go.
      ...rememberPrinted(page, previous.offers),
      // Cells in the order the grid declares them, so the page reads as before.
      placements: item.cells
        .filter((cell) => item.dealt.has(cell))
        .map((cell) => {
          const last = page.placements.find((placement) => placement.slotId === cell);
          const overrides = item.kept.get(cell) ?? (last ? cellDesign(last.overrides) : PlacementOverrides.parse({}));
          return { offerId: item.dealt.get(cell)!, slotId: cell, overrides };
        }),
      // Artwork tied to last week's product no longer has one.
      decorations: page.decorations.map((decoration) => (
        decoration.offerId && !taken.has(decoration.offerId) ? { ...decoration, offerId: null } : decoration
      )),
      rationale: '',
    };
  });

  const report: CarryReport = {
    pages: work.map((item) => ({
      pageId: item.page.id,
      department: item.department,
      cells: item.cells.length,
      filled: item.dealt.size,
      borrowed: item.borrowed,
      kept: item.kept.size,
    })),
    cells: work.reduce((sum, item) => sum + item.cells.length, 0),
    filled: work.reduce((sum, item) => sum + item.dealt.size, 0),
    borrowed: work.reduce((sum, item) => sum + item.borrowed, 0),
    kept: work.reduce((sum, item) => sum + item.kept.size, 0),
    pinnedGone,
    reserve: pool.length - taken.size,
    datedNotes,
  };

  return {
    document: {
      ...previous,
      id: options.id,
      name: options.week ? weekName(options.brandName, options.week) : `${options.brandName} · ny uge`,
      week: options.week,
      pages,
      offers: pool,
      createdAt: now,
      updatedAt: now,
    },
    report,
  };
}
