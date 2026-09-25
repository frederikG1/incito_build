import {
  PlacementOverrides, isImagePage, rememberPrinted, slotAssignmentOrder, weekName,
  type CatalogDocument, type CatalogPage, type CatalogWeek, type Offer, type PageTemplate,
} from '@incitio/schema';
import { compareByImportance } from './importance.js';
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
}

export interface CarriedPage {
  pageId: string;
  department: Department | null;
  cells: number;
  filled: number;
  /** Filled from a neighbouring department because its own ran out. */
  borrowed: number;
}

export interface CarryReport {
  pages: CarriedPage[];
  cells: number;
  filled: number;
  borrowed: number;
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

  // One offer per id, and a picture before no picture: a product with no
  // photograph cannot stand in a cell in print.
  const seen = new Set<string>();
  const pool = feed
    .filter((offer) => (seen.has(offer.id) ? false : (seen.add(offer.id), true)))
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || compareByImportance(a, b));
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
    };
  });

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
    for (const cell of front.cells) {
      // The cover sells food first; what it carried last week is a hint, not a rule.
      const offer = take(food, () => true);
      if (offer) front.dealt.set(cell, offer.id);
    }
  }
  for (const item of work) {
    if (!item.department) continue;
    const own = (offer: Offer) => department.get(offer.id) === item.department;
    for (const cell of item.cells) {
      const offer = take((offer) => own(offer) && priced(item)(offer), own);
      if (offer) item.dealt.set(cell, offer.id);
    }
  }
  for (const item of work) {
    if (item.department || item.cells.length === 0 || item === front) continue;
    for (const cell of item.cells) {
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
        .map((cell) => ({ offerId: item.dealt.get(cell)!, slotId: cell, overrides: PlacementOverrides.parse({}) })),
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
    })),
    cells: work.reduce((sum, item) => sum + item.cells.length, 0),
    filled: work.reduce((sum, item) => sum + item.dealt.size, 0),
    borrowed: work.reduce((sum, item) => sum + item.borrowed, 0),
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
