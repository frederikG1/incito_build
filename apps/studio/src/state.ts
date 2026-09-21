import { create } from 'zustand';
import type {
  Brand, CatalogDocument, DecorAnchor, Offer, PageBackground, PageDecoration,
  PagePart, PageTemplate, PageTextOverride,
  PackOverride, Placement, PartOverride, PlacementOverrides, TileArrangement, TilePart,
} from '@incitio/schema';
import {
  CatalogPage, mergeCatalogDocuments, pageTextLimits, pageTextOverride, pageTextPatch,
  packLimits, packOverride, packPatch,
  partLimits, partOverride, partPatch, slotAssignmentOrder, slotCells,
} from '@incitio/schema';
import { groupOffers, notOnePhotograph, readPackSize } from '@incitio/schema';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import { freeSlots, growTemplate, grownId } from './grid.js';
import * as api from './api.js';
import { countPages } from './pdf.js';
import {
  PACK_LIMITS, planCluster,
  type Complaint, type GhostFrame, type MeasuredProduct, type PackPatch, type PlacedProduct,
} from './cluster-layout.js';
import { inkOf, onWhite, WHOLE, type InkBox } from './ink.js';

/**
 * Which chain the user works for.
 *
 * Remembered across reloads because in the real product it is not a
 * choice at all — it comes from who signed in. Keeping it in one place
 * now means swapping the picker for a session is a change to this
 * constant and the toolbar, and nothing else.
 */
const BRAND_KEY = 'incitio.brand';

function rememberedBrand(): string | null {
  try {
    return window.localStorage.getItem(BRAND_KEY);
  } catch {
    return null;
  }
}

/**
 * One file the editor handed in, ready to send.
 *
 * Held as base64 rather than as a `File`: that is what the endpoint
 * takes, and a `File` cannot survive a state update any more usefully
 * than its bytes can. Reading it at the moment of choosing also means a
 * file that cannot be read is reported while the person still knows
 * which one they picked.
 */
export interface ReferenceFile {
  /** Stable across re-renders, so a row can be removed while others load. */
  id: string;
  name: string;
  base64: string;
  isPdf: boolean;
  /**
   * How many pages the file has, when it could be read.
   *
   * `null` for an image, and for a PDF pdf.js could not open — in which
   * case the row simply does not say, rather than guessing. Read in the
   * browser on upload; see `countPages`.
   */
  pageCount: number | null;
  /**
   * Which pages of a PDF this row stands for: "4", "1-6", "2,5,9".
   *
   * One row can therefore become six pages. That is the common case —
   * the editor has last week's whole avis as one PDF — and it beats
   * uploading the same file six times. Ignored for an image, which is
   * always exactly one page.
   */
  pages: string;
}

/**
 * How one page was rebuilt: what the model saw, and what it did.
 *
 * Kept beside the document rather than in it — none of this is printed,
 * and a document is what gets saved. `pageId` is what ties it to the
 * sheet on the canvas, and it is re-keyed whenever pages are merged, so
 * the reference shown above a page is always that page's own.
 */
export interface PageRun {
  pageId: string;
  /** What the model was shown, as a data URL. */
  reference: string;
  referenceName: string;
  template: { id: string; name: string; areas: string[] };
  ground: string;
  /** Measured out of the PDF, or read off the picture. See `ReproduceReply`. */
  grid: { source: 'pdf' | 'model'; columns: number; rows: number; fit: number | null };
  casting: { slotId: string; offerId: string; role: string; why: string }[];
  source: { id: string; name: string; reason: string };
  offersInFeed: number;
  poolSize: number;
  rejected: number;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

/**
 * How many pages a run will cost, before it is paid for.
 *
 * A page is a model call — see `matchPages` in `@incitio/match` — so
 * "1-40" typed into a PDF row is forty of them. The cap is here rather
 * than in the endpoint because this is where a person can still be told
 * about it, in the panel, before they press the button.
 *
 * Forty, which is a whole avis. It was 24 while a row stood at one page
 * by default and a long file was something you opted into page by page;
 * now the row arrives holding the whole document, and a cap that trims
 * a 30-page book to 24 drops six pages for a reason that is about this
 * constant rather than about the work. What guards the spend is the
 * line under the button — pages, minutes, and the cap when it bites —
 * not a number low enough to be hit by an ordinary week's leaflet.
 */
export const MAX_REFERENCE_PAGES = 40;

/**
 * A page spec as the pages it names: "2,5-7" is 2, 5, 6, 7.
 *
 * Typed order is kept rather than sorted — someone who writes "7,1"
 * wants page seven first — and duplicates are dropped, because asking
 * for the same page twice costs a model call and prints the same grid
 * with different products, which nobody means.
 */
export function pageNumbers(spec: string): number[] {
  const out: number[] = [];
  for (const chunk of spec.split(',')) {
    const trimmed = chunk.trim();
    const range = /^(\d{1,3})\s*[-\u2013]\s*(\d{1,3})$/.exec(trimmed);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let page = Math.min(from, to); page <= Math.max(from, to); page += 1) out.push(page);
      continue;
    }
    if (/^\d{1,3}$/.test(trimmed)) out.push(Number(trimmed));
  }
  return [...new Set(out.filter((page) => page >= 1 && page <= 400))];
}

/**
 * The page spec that means "all of it", for a file of this length.
 *
 * `"1"` when the length is unknown, which is the old behaviour and the
 * safe one: a range built on a guess would ask the server for pages the
 * file does not have, and each of those is a failed model call.
 */
export function wholeDocument(pageCount: number | null): string {
  if (pageCount === null || pageCount < 1) return '1';
  return pageCount === 1 ? '1' : `1-${pageCount}`;
}

/**
 * A count and the noun that agrees with it — "1 side", "4 sider".
 *
 * Small, and worth having: this panel counts pages in half a dozen
 * places, and a parenthesised plural in a product an editor uses every
 * week reads as software that was not finished.
 */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One job per page: what is actually sent, one request each. */
export interface ReferenceJob {
  /** The row it came from, so a page that failed can stay on screen. */
  refId: string;
  name: string;
  base64: string;
  pageNumber?: number;
}

/** Every reference flattened into the pages it asks for, in order. */
export function referenceJobs(references: ReferenceFile[]): ReferenceJob[] {
  const jobs: ReferenceJob[] = [];
  for (const reference of references) {
    if (!reference.isPdf) {
      jobs.push({ refId: reference.id, name: reference.name, base64: reference.base64 });
      continue;
    }
    const pages = pageNumbers(reference.pages);
    for (const page of pages.length > 0 ? pages : [1]) {
      jobs.push({
        refId: reference.id,
        name: `${reference.name} s. ${page}`,
        base64: reference.base64,
        pageNumber: page,
      });
    }
  }
  return jobs.slice(0, MAX_REFERENCE_PAGES);
}

export interface StudioState {
  brands: api.BrandSummary[];
  brandId: string | null;
  brand: Brand | null;
  /** The formats this chain delivers; the first is the default. */
  sources: api.BrandSource[];
  feed: { text: string; source: string } | null;
  document: CatalogDocument | null;
  /**
   * This chain's saved catalogues, newest first.
   *
   * Kept in state so the toolbar can offer yesterday's work without a
   * round trip on every render. Refreshed whenever something is saved,
   * which is the only thing that changes it.
   */
  catalogues: api.CatalogSummary[];

  curationReady: boolean;
  /** Whether the server holds a GEMINI_API_KEY. Mood artwork needs one. */
  decorReady: boolean;
  /** The image model that will be billed, named on screen beside the button. */
  decorModel: string;
  /** Direction for the motif choice — the decor step's own brief. */
  decorNote: string;
  /**
   * The editor's own words for the image model, added to every prompt.
   *
   * Separate from `decorNote` because they reach different models:
   * `decorNote` decides WHAT a page depicts and never leaves the text
   * step; this decides HOW it is drawn and never reaches the text step.
   */
  decorStyle: string;
  busy: string | null;
  error: string | null;
  note: string | null;

  /*
   * Rebuilding published pages, which is how a catalogue is made here:
   * you hand in the pages you want, one file each, and get them back
   * carrying this week's products.
   *
   * `references` is what the user picked, held as base64 because that
   * is what the endpoint takes and a `File` cannot survive a state
   * update. `reproductions` is what came back — the pages are in
   * `document` like any others, and these are everything ABOUT them:
   * what was shown to the model, what it put where, and what it cost.
   */
  reproduceOpen: boolean;
  references: ReferenceFile[];
  reproduceNote: string;
  /** Add the new pages to the catalogue already open instead of replacing it. */
  reproduceAppend: boolean;
  reproductions: PageRun[];

  /* ------------------------------------------------ varerne, som liste */

  /**
   * Every product in the uploaded feed, read but not yet used.
   *
   * The upload used to be a string nobody could look into: it was held
   * until something was generated from it, and the first sight of what
   * was in the file came several minutes and one model call later. This
   * is the same file run through the chain's own reader — free, instant
   * and no model — so a feed can be inspected, searched and dealt onto
   * pages by hand like a deck of cards.
   */
  feedOffers: Offer[];
  /** Which reader ran, and how many of the products carry a photograph. */
  feedReading: { source: api.FeedReading['source']; withImage: number } | null;
  libraryOpen: boolean;
  librarySearch: string;
  /**
   * The products ticked in the library, in the order they were ticked.
   *
   * Ordered rather than a Set because the order is the answer to "which
   * cell does each of these land in": the first one ticked takes the
   * most prominent free cell.
   */
  librarySelection: string[];
  /**
   * The groups that are folded away, by name.
   *
   * Closed rather than open is what is stored, so a feed with forty
   * categories opens showing all of them and a person folds away what
   * they are not working on — the other way round, a new category next
   * week would arrive already hidden.
   */
  libraryClosedGroups: string[];
  /**
   * The page a product lands on when nothing else says which.
   *
   * Follows the selection — clicking a tile makes its page the active
   * one — so the common gesture is "click a page, tick some products,
   * add". Null until there is a document.
   */
  activePageId: string | null;

  /* --------------------------------------------- en udgivelse, via link */

  publicationUrl: string;
  /** "4", "1-6" or "2,5,9". Empty means the whole publication. */
  publicationPages: string;
  /** Add the pages behind what is open instead of replacing it. */
  publicationAppend: boolean;
  /** Take the layout WITH the publication's own products, or empty. */
  publicationWithOffers: boolean;

  /* ------------------------------------------------- et tegnet layout */

  /** How many product cells to ask the image model for. */
  layoutCells: number;
  /** The editor's own words for the image model. */
  layoutNote: string;
  /** Add the drawn page behind what is open instead of replacing it. */
  layoutAppend: boolean;

  selectedOfferId: string | null;
  /**
   * Which of the chain's own pictures is in hand, if any.
   *
   * A decoration is painted BEHIND the grid — that is what makes it
   * atmosphere rather than a fifth product — so on a page full of tiles
   * the pointer lands on a tile every time and the picture cannot be
   * grabbed at all. Arming it first is what gives it back: a selected
   * decoration lifts above the grid and takes the pointer; every other
   * one stays exactly as inert as it is in print.
   *
   * The same bargain the tiles make. You select a tile before you drag
   * its parts, and for the same reason.
   */
  selectedDecorId: string | null;
  /**
   * Which single box of the selected tile is in hand.
   *
   * `null` is the tile as a whole, and it is not the same as "no
   * selection": with nothing named, dragging still pans the artwork,
   * which is the gesture that was here before boxes were addressable
   * and the one people reach for first.
   */
  selectedPart: TilePart | null;
  /**
   * Which product of a cluster is in hand, by its place in the pack.
   *
   * A tile whose offer covers three variants draws three photographs,
   * and this is how one of them is addressed. Always a variant OF the
   * artwork box, so it is set alongside `selectedPart: 'media'` rather
   * than instead of it — the box is outlined and the product inside it
   * is outlined harder.
   */
  selectedPack: number | null;
  /**
   * What is needed to compose a cluster BY HAND, when there is one.
   *
   * The image model is billing-gated on Google's side. This is the way
   * round it that does not involve waiting: the prompt and the cutouts,
   * to be pasted and uploaded into Gemini's own app, and a file input to
   * bring the result back. Null until somebody asks for it.
   */
  manual: {
    offerId: string;
    prompt: string;
    files: { index: number; name: string; url: string; bytes: number }[];
  } | null;
  /**
   * The composed pictures the page's clusters were stood up from, each
   * drawn over its own tile — see `Reference`.
   *
   * A list, because a whole sheet is stood up in one go: six clusters
   * means six proofs, and an editor comparing the page with what they
   * asked for wants them all at once. Named for what it draws rather
   * than for the word on the button, because `references` in this store
   * is already the chain's own printed pages.
   */
  ghosts: Ghost[];
  /**
   * The prompts and cutouts for every cluster on one sheet.
   *
   * The page-sized version of `manual`, and the reason it exists: doing
   * this a tile at a time means selecting a tile, waiting, copying,
   * going to Gemini, coming back, dropping — six times over for a
   * sheet. Prepared together, an editor takes the whole page into
   * Gemini in one sitting and drops the results back in one go.
   */
  manualPage: {
    pageId: string;
    tiles: {
      offerId: string;
      name: string;
      prompt: string;
      files: { index: number; name: string; url: string; bytes: number }[];
    }[];
  } | null;
  /**
   * Which of a page's own lines is in hand, and whose page it is.
   *
   * Carries the page id because a heading is addressed by PAGE — unlike
   * a tile's box, which is reached through the selected offer. Nothing
   * has to be selected on a page for its heading to be movable, and a
   * catalogue has as many headings as it has sheets.
   *
   * Never set at the same time as a tile or a picture: the arrow keys
   * would have two things to move and the inspector two things to
   * describe.
   */
  selectedText: { pageId: string; part: PagePart } | null;
  maxPages: number;

  /** Undo history of whole documents. Small, and the editor is small. */
  past: CatalogDocument[];
  future: CatalogDocument[];

  start: () => Promise<void>;
  signInAs: (brandId: string) => Promise<void>;
  /** Read this week's file and show what is in it. Free; no model. */
  uploadFeed: (name: string, text: string) => Promise<void>;
  /** Re-read the saved list. Cheap, and never a model call. */
  refreshCatalogues: () => Promise<void>;
  /**
   * Put a saved catalogue back on the canvas.
   *
   * Free, and that is the point: a rebuilt page cost a model call once
   * and is an ordinary document from then on. Checking what last week's
   * run looked like, or what a stylesheet change did to it, must not
   * cost that call a second time.
   */
  openCatalogue: (id: string) => Promise<void>;
  /**
   * A plain draft straight from the feed, with no model in the loop.
   *
   * Kept as the fast way to see a feed on paper — and as the thing that
   * still works with no API key. It does NOT curate: the way to get a
   * page worth printing is to hand in a page, which is `reproduce`.
   */
  build: (options?: { fresh?: boolean }) => Promise<void>;
  save: () => Promise<void>;
  downloadPdf: () => Promise<void>;

  setReproduceOpen: (open: boolean) => void;
  /** Add pages to rebuild: images, or PDFs to take pages out of. */
  addReferences: (files: File[]) => Promise<void>;
  /** Which pages of a PDF this reference stands for — "4", "1-6", "2,5,9". */
  setReferencePages: (id: string, spec: string) => void;
  removeReference: (id: string) => void;
  /** Move a reference up or down; the order is the order they print in. */
  moveReference: (id: string, delta: number) => void;
  clearReferences: () => void;
  setReproduceNote: (note: string) => void;
  setReproduceAppend: (append: boolean) => void;
  /** Rebuild every reference with the feed, and put the pages on the canvas. */
  reproduce: () => Promise<void>;
  setDecorNote: (value: string) => void;
  setDecorStyle: (value: string) => void;
  decorate: () => Promise<void>;

  setLibraryOpen: (open: boolean) => void;
  setLibrarySearch: (query: string) => void;
  /** Tick or untick one product. Always a toggle; the list is a basket. */
  toggleLibraryPick: (offerId: string) => void;
  clearLibraryPicks: () => void;
  /** Fold one group of the library away, or open it again. */
  toggleLibraryGroup: (name: string) => void;
  /** Which page the next products land on. */
  setActivePage: (pageId: string | null) => void;
  /**
   * Put products on a page — one, or a handful at once.
   *
   * Three things can happen to the page's layout, in this order of
   * preference, and which one did is visible on the page afterwards:
   *   1. the layout already has empty cells, and they are filled;
   *   2. the chain has a layout at the new count, and the page moves to
   *      it — a shape somebody drew, which is always the better page;
   *   3. the page's own grid grows a cell, which is the only thing that
   *      can be done for a layout read off one printed sheet.
   */
  addOffersToPage: (pageId: string, offerIds: string[]) => void;
  /**
   * Take a product off a page without deleting it.
   *
   * It goes to the bench — every offer in the document that no page
   * shows — so it can be dealt out again, here or on another page. The
   * cell it leaves stays empty rather than the page reflowing: a page
   * somebody is editing should not rearrange itself under their hands.
   */
  removeOfferFromPage: (pageId: string, offerId: string) => void;
  /**
   * Put a selection of products into ONE cell the page already has.
   *
   * The other way to add a product — `addOffersToPage` — gives each one
   * a cell of its own and grows the grid to find them. That is right
   * when the page is yours to shape and wrong when it is a layout read
   * off a printed sheet: the whole point of that layout is that it does
   * not move.
   *
   * So this changes what is IN a cell rather than how many cells there
   * are. Several products become one "frit valg" tile — one price, one
   * headline, every product photographed together, which is how a
   * printed leaflet puts six cheeses in the space of one offer. See
   * `groupOffers` for what is resolved downwards to keep the tile true.
   *
   * Whatever was in the cell goes to the bench, not to the bin.
   */
  fillSlot: (
    pageId: string,
    slotId: string,
    offerIds: string[],
    options?: {
      /**
       * Ask the image model for ONE photograph of the products standing
       * together, instead of laying the cutouts out side by side.
       *
       * The trade, stated once: a composed photograph looks like a
       * printed page and cannot be edited product by product; the
       * cutouts can be moved one at a time and look like cutouts. Both
       * are right, for different cells.
       */
      compose?: boolean;
    },
  ) => Promise<void>;
  /** The editor's own steer for how the products should sit together. */
  arrangeNote: string;
  setArrangeNote: (note: string) => void;
  /**
   * The cells of a page, in the order a reader meets them, with what is
   * in each — for a picker that has to say "which cell".
   */
  pageSlots: (pageId: string) => { slotId: string; label: string }[];

  setPublicationUrl: (url: string) => void;
  setPublicationPages: (spec: string) => void;
  setPublicationAppend: (append: boolean) => void;
  setPublicationWithOffers: (withOffers: boolean) => void;
  /**
   * Rebuild a published leaflet from its own link.
   *
   * The one way into a page here that costs nothing and gives the same
   * answer twice: a published page states its own grid, so there is no
   * model in the loop at all.
   */
  importPublication: () => Promise<void>;

  setLayoutCells: (cells: number) => void;
  setLayoutNote: (note: string) => void;
  setLayoutAppend: (append: boolean) => void;
  /**
   * A page whose layout is drawn rather than handed in.
   *
   * The image model draws the shape of the page; the casting model reads
   * that drawing and decides which product sits in which cell. The
   * drawing is never printed — it is scaffolding, and what lands on the
   * sheet is the chain's own tiles.
   */
  generateLayout: () => Promise<void>;

  select: (offerId: string | null) => void;
  /** Arm a picture for dragging, or put it back down. */
  selectDecor: (decorId: string | null) => void;
  selectPart: (part: TilePart | null) => void;
  /** Fetch the prompt and the cutouts for a grouped tile, to run by hand. */
  prepareCluster: (offerId: string) => Promise<void>;
  /**
   * Stand the tile's own cutouts up the way a composed picture stands.
   *
   * The picture is read and thrown away. An image model redraws pixels,
   * and what it redraws worst is small type — a brand name, a fat
   * percentage, the print on a lid — so its LAYOUT is worth having and
   * its pixels are not. What prints is the artwork the chain supplied,
   * standing where the composition put it.
   */
  applyClusterLayout: (offerId: string, file: File) => Promise<void>;
  /** Put the panel away. */
  closeManual: () => void;
  /** Draw one cluster's composed picture over it, or take it back off. */
  toggleGhost: (offerId: string) => void;
  /**
   * Fetch the prompt and the cutouts for EVERY cluster on one sheet.
   *
   * The page-sized `prepareCluster` — see `manualPage`.
   */
  prepareClusters: (pageId: string) => Promise<void>;
  /**
   * Stand every cluster on a sheet up, from a handful of pictures.
   *
   * Each picture is read against the whole page's products, which is
   * what says WHICH cluster it is a picture of — so an editor drops the
   * lot in at once and never picks a tile. One write, one undo step.
   */
  applyClusterLayouts: (pageId: string, files: File[]) => Promise<void>;
  /**
   * Stand every cluster on a sheet up without leaving the studio.
   *
   * The same job `applyClusterLayouts` does, with the trip to Gemini's
   * own app folded in: the image model composes each cluster here, the
   * composition is read as a layout, and the chain's own cutouts are
   * moved to match. Nothing the model drew reaches the page.
   */
  standUpClusters: (pageId: string) => Promise<void>;
  /** Put the page's cluster panel away. */
  closeClusters: () => void;
  /**
   * Put one picture on a tile as its whole artwork.
   *
   * What the manual route needs to finish, and useful on its own: a
   * designer with a composed photograph of their own has nowhere to put
   * it otherwise. The pack is cleared, because the tile is now one
   * picture — `members` stays, so the document still says what the
   * price covers.
   */
  setTileImage: (offerId: string, file: File) => Promise<void>;
  /** Take one product of a cluster in hand, or put it down. */
  selectPackItem: (index: number | null) => void;
  /**
   * Move, resize, turn or hide one product of a cluster.
   *
   * The same four gestures every other box answers to, applied to one
   * photograph among several — which is the half of a printed page that
   * is genuinely done by hand. `gesture` coalesces a drag into one undo
   * step, exactly as `updatePart` does.
   */
  updatePackItem: (
    offerId: string,
    index: number,
    patch: Partial<PackOverride>,
    gesture?: string,
  ) => void;
  /** Move one product of a cluster, in page percent. */
  nudgePackItem: (offerId: string, index: number, dx: number, dy: number) => void;
  scalePackItem: (offerId: string, index: number, delta: number) => void;
  /** Turn it a few degrees — the one box besides a decoration that may. */
  turnPackItem: (offerId: string, index: number, delta: number) => void;
  /** Back where the arrangement put it, and back on the page. */
  resetPackItem: (offerId: string, index: number) => void;
  /** Take one product of a cluster off the page, or put it back. */
  setPackItemHidden: (offerId: string, index: number, hidden: boolean) => void;
  /** Take one of a page's own lines in hand, or put it down. */
  selectPageText: (pageId: string, part: PagePart | null) => void;
  swapPlacements: (
    from: { pageId: string; slotId: string },
    to: { pageId: string; slotId: string },
  ) => void;
  setMaxPages: (pages: number) => void;
  /**
   * Change one tile's hand-made corrections.
   *
   * `gesture` coalesces history: a drag that pans an image fires on
   * every pointer move, and without it a single nudge would cost fifty
   * presses of Cmd+Z. Pass the same string for the whole gesture and
   * call `endGesture` when the pointer goes up.
   */
  updateOverrides: (
    offerId: string,
    patch: Partial<PlacementOverrides>,
    gesture?: string,
  ) => void;
  endGesture: () => void;
  /**
   * Change where one box of a tile sits, how big it is, whether it
   * prints, and what it says.
   *
   * Every direct manipulation in the editor ends up here — the pan that
   * used to be the artwork's alone, the arrow keys, the drag of a
   * headline. The artwork is not special-cased in this file: `partPatch`
   * routes `media` to the three fields that have always held it.
   */
  updatePart: (
    offerId: string,
    part: TilePart,
    patch: Partial<PartOverride>,
    gesture?: string,
  ) => void;
  /** Move a box, in its own units. Clamped to what the schema accepts. */
  nudgePart: (offerId: string, part: TilePart, dx: number, dy: number) => void;
  scalePart: (offerId: string, part: TilePart, delta: number) => void;
  /** Back to where the template put it, and back on the page. */
  resetPart: (offerId: string, part: TilePart) => void;
  /** Take a box off the page, or put it back. */
  setPartHidden: (offerId: string, part: TilePart, hidden: boolean) => void;
  /** Put every box of a tile back where the composer had it. */
  resetTile: (offerId: string) => void;
  /**
   * Change where one of a page's lines sits, how big it is, and whether
   * it prints.
   *
   * The wording is NOT here: `setPageTitle`/`setPageSubtitle` own the
   * strings, they owned them before a heading was movable, and two
   * homes for one string is how an edit goes missing. Same split the
   * tile's headline makes — see `PartOverride.text`.
   */
  updatePageText: (
    pageId: string,
    part: PagePart,
    patch: Partial<PageTextOverride>,
    gesture?: string,
  ) => void;
  /** Move a line, in page percent. Clamped to what the schema accepts. */
  nudgePageText: (pageId: string, part: PagePart, dx: number, dy: number) => void;
  scalePageText: (pageId: string, part: PagePart, delta: number) => void;
  /** Back where the masthead put it, and back on the page. */
  resetPageText: (pageId: string, part: PagePart) => void;
  /** Take a line off the page, or put it back. */
  setPageTextHidden: (pageId: string, part: PagePart, hidden: boolean) => void;
  movePage: (pageId: string, delta: number) => void;
  /**
   * Put a whole-sheet picture into the book at this position — an ad, a
   * campaign page, a back cover. `at` is the index it lands on.
   */
  addImagePage: (at: number, file: File) => Promise<void>;
  /** Swap the picture on an image page for another. */
  replaceImagePage: (pageId: string, file: File) => Promise<void>;
  /** Take a page out of the book. */
  removePage: (pageId: string) => void;
  /**
   * Put one of the chain's own pictures on a page.
   *
   * The files are the chain's — its grapes, its almonds — so this is an
   * upload and not a generation. What lands on the page is an ordinary
   * `PageDecoration`, the same record `npm run decorate` writes, so the
   * renderer, the editor and the printer need to know nothing new.
   *
   * The picture arrives as it left the designer's folder: nothing is
   * keyed out of it. A chain's own artwork is already cut out where it
   * needs to be, and a filter that guesses at that does more damage on
   * the photographs than it saves on the packshots.
   */
  addPageImage: (pageId: string, file: File) => Promise<void>;
  updatePageImage: (
    pageId: string,
    decorId: string,
    patch: Partial<PageDecoration>,
    /** Coalesces a drag into one undo step, like `updatePart`. */
    gesture?: string,
  ) => void;
  removePageImage: (pageId: string, decorId: string) => void;

  /**
   * Lay one of the chain's own pictures under the whole sheet.
   *
   * The same upload route as `addPageImage` — the file is stored as it
   * was handed in, corners and all. What lands on the page is a
   * `PageBackground`: one per page, replacing whatever was there.
   */
  addPageBackground: (pageId: string, file: File) => Promise<void>;
  /**
   * Change how the background meets the sheet, or take it off.
   *
   * `null` removes it. A patch changes fit, opacity or crop — and takes
   * a gesture for the same reason `updatePageImage` does: dragging a
   * slider fires on every pixel and must be one undo step.
   */
  setPageBackground: (
    pageId: string,
    patch: Partial<PageBackground> | null,
    gesture?: string,
  ) => void;

  setPageTitle: (pageId: string, title: string) => void;
  /**
   * The theme line under the heading — "i det lune efterår".
   *
   * Editable for the same reason the heading is, only more so: it is the
   * one line on the page the model writes to a brief rather than from
   * the data, so it is the one most likely to be nearly right.
   */
  setPageSubtitle: (pageId: string, subtitle: string) => void;
  /**
   * This page's own ground colour, or `null` to hand it back to the
   * chain's rotation.
   *
   * A page-level edit rather than a brand-level one on purpose: the
   * chain's palette is its identity and is not the editor's to rewrite,
   * but the field of ONE page rebuilt from a printed reference is a
   * property of that page. See `CatalogPage.ground`.
   */
  setPageGround: (pageId: string, ground: string | null) => void;
  /**
   * Lay this page out differently.
   *
   * The offers stay and keep their corrections; only the shape they
   * sit in changes. Their prominence order is carried across — see
   * `reseat` — so the offer that led the page still leads it.
   */
  setPageTemplate: (pageId: string, templateId: string) => void;
  /** The next of this brand's layouts at the same offer count. */
  shufflePage: (pageId: string) => void;
  /**
   * How many offers this page carries.
   *
   * Fewer sends the weakest ones to the bench; more takes them back.
   * The bench is every offer in the document that is not on a page —
   * `benched` below — so nothing is destroyed by turning a six-up page
   * into a three-up one, and turning it back finds them again.
   */
  setPageCount: (pageId: string, count: number) => void;
  /** Move an offer into this page's leading slot. */
  focusOffer: (pageId: string, offerId: string) => void;
  /** Offers built into this document that no page is currently showing. */
  benched: () => Offer[];
  undo: () => void;
  redo: () => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The chain, carrying layouts that are not part of its vocabulary.
 *
 * A page rebuilt from a reference sits on a grid nobody drew for the
 * chain. It travels inside the document — which is what makes it
 * survive a save and a print — but the editor's own template lookups
 * (`resolveTemplate`, reseating, the layout picker) go through the
 * brand, so the brand it renders with has to know about them too.
 *
 * First wins, so a run's own layouts resolve before the chain's.
 */
function withTemplates(brand: Brand, templates: PageTemplate[]): Brand {
  const all = new Map<string, PageTemplate>();
  for (const template of [...templates, ...brand.templates]) {
    if (!all.has(template.id)) all.set(template.id, template);
  }
  return { ...brand, templates: [...all.values()] };
}

/**
 * Bytes as base64, in chunks.
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-liner and it throws
 * on anything bigger than the argument limit — which a 4 MB page scan
 * comfortably is. 32k at a time is well under it and costs nothing.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return window.btoa(binary);
}

/**
 * Wait until an uploaded picture can actually be fetched back.
 *
 * The file is on the server's disk the moment the reply lands —
 * `writeFileSync` returns before the route does — but it reaches the
 * EDITOR through the dev server's static root, and that tree needs a
 * beat to notice a path it has never served. Measured: the request made
 * immediately after the upload 404s and the same URL is fine a moment
 * later.
 *
 * Retried rather than failed, because the file is genuinely there; and
 * probed at all rather than trusted, because an `<img>` that fails once
 * never retries a `src` it has already failed. Without this the page
 * keeps a picture that is permanently a broken box on screen — while
 * the PDF, which reads the same file off disk, prints it perfectly. A
 * defect that exists only in the editor is the worst kind to chase.
 *
 * The cache-buster is what makes the retry mean anything: a browser
 * that has just cached a 404 for this exact URL would otherwise answer
 * every later attempt from that cache.
 */
async function reachable(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(true);
      probe.onerror = () => resolve(false);
      probe.src = attempt === 0 ? url : `${url}?t=${Date.now()}`;
    });
    if (ok) return true;
    await new Promise((wait) => { setTimeout(wait, 150 * (attempt + 1)); });
  }
  return false;
}

/** The degrees in a CSS `rotate` property — "6deg", or "none". */
function spin(value: string): number {
  const match = /(-?[\d.]+)deg/.exec(value);
  return match ? Number.parseFloat(match[1]!) : 0;
}

/**
 * One product of a cluster as it is actually DRAWN, not as its box.
 *
 * The distinction is the whole point. Every product in a cluster is an
 * `img` filling its own track with `object-fit: contain`, so its
 * element is as wide as the track and the artwork inside it is
 * letterboxed — a tall bottle in a wide track draws at a fraction of
 * its element's width. Measuring the element and calling that the
 * product is how a composition read off a picture came back with the
 * tall things tiny.
 *
 * The centre needs no such care: the axis-aligned box the browser
 * reports for a transformed rectangle is centred on that rectangle's
 * own centre, whatever turned it and around which point — and `contain`
 * centres the artwork in the element.
 */
function measurePack(
  node: Element | null,
  already: PackOverride,
  /** Where the product sits inside its own picture — see `inkOf`. */
  ink: InkBox,
): MeasuredProduct | null {
  if (!(node instanceof HTMLImageElement)) return null;
  if (node.naturalWidth === 0 || node.naturalHeight === 0) return null;
  const aspect = node.naturalWidth / node.naturalHeight;

  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || node.offsetWidth === 0) return null;

  /*
   * The arrangement's own transform AND the corrections, which are
   * written as the individual `scale`/`rotate` properties precisely so
   * they compose with it — see `OfferTile`. Both have to be read, and
   * the layout size has to come from `offsetWidth`, because a rotated
   * element's reported box is bigger than the element.
   */
  const style = window.getComputedStyle(node);
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? '' : style.transform);
  const own = style.scale === 'none' ? 1 : (Number.parseFloat(style.scale) || 1);
  const drawn = Math.min(
    node.offsetWidth * Math.hypot(matrix.a, matrix.b) * own,
    node.offsetHeight * Math.hypot(matrix.c, matrix.d) * own * aspect,
  );
  if (drawn <= 0 || ink.width <= 0 || ink.height <= 0) return null;

  /*
   * The PRODUCT, not the picture it came in.
   *
   * The model measures the pack; this has to measure the same thing or
   * the two are not comparable — see `ink.ts`. Both the size and the
   * centre move: a product sitting off-centre in its own file is off
   * its element's centre by the same fraction, at whatever size the
   * page happens to draw it.
   */
  const height = drawn / aspect;
  const driftX = (ink.left + ink.width / 2 - 0.5) * drawn;
  const driftY = (ink.top + ink.height / 2 - 0.5) * height;
  return {
    cx: rect.left + rect.width / 2 + driftX,
    cy: rect.top + rect.height / 2 + driftY,
    width: drawn * ink.width,
    driftX,
    driftY,
    rotate: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + spin(style.rotate),
    // The product's own proportions, which is what decides how tall a
    // box the composition needs for it.
    aspect: (aspect * ink.width) / ink.height,
    already,
  };
}

/**
 * The uploaded picture's proportions.
 *
 * Read from the file, never assumed: the composition prompt ASKS for
 * the cell's aspect ratio and the image model answers with whatever it
 * renders. 1 on anything unreadable, which is the shape it usually is.
 */
async function pictureAspect(file: File): Promise<number> {
  try {
    const bitmap = await createImageBitmap(file);
    const aspect = bitmap.width / bitmap.height;
    bitmap.close();
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  } catch {
    return 1;
  }
}

/**
 * The products behind a cluster's pictures, in the pack's own order.
 *
 * The pack is not the member list. `groupOffers` deduplicates the
 * pictures — two variants of one product very often carry the same
 * photograph — and drops members that have none, so `imagePack[2]` is
 * not reliably `members[2]`. Everything that reads a composition
 * addresses products by their place in the PACK (`data-pack="2"` is a
 * picture, not a member), so the list handed to a model has to be the
 * pack's, or product three's position gets applied to product four's
 * cutout and the tile comes out scrambled with no error anywhere.
 */
function packMembers(offer: Offer, document: CatalogDocument): Offer[] {
  const members = offer.members
    .map((id) => document.offers.find((entry) => entry.id === id))
    .filter((entry): entry is Offer => Boolean(entry));
  if (offer.imagePack.length === 0) return members;
  return offer.imagePack.map((url, index) => (
    members.find((member) => member.imageUrl === url) ?? members[index] ?? members[0]!
  ));
}

/**
 * A composed picture, laid over the cluster it was read from.
 *
 * Here and not in the document, deliberately. It is a PROOF, not a
 * layer of the page: it must never print, never be saved and never
 * survive a reload — and a person looking at it has to be able to
 * answer "did it use my picture?" without reading a number.
 */
export interface Ghost {
  offerId: string;
  url: string;
  /** The picture's rectangle, in fractions of the artwork box. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Whether it is being drawn. Kept when hidden, so it can come back. */
  shown: boolean;
  /** What the arithmetic did, line by line — see `standUpCluster`. */
  report: string[];
}

/** What one picture does to one tile, before anything is written down. */
interface StoodUp {
  offerId: string;
  patches: Map<number, PackPatch>;
  frame: GhostFrame | null;
  report: string[];
  /** Products of this tile the picture did not hold. */
  missing: number;
  /** What is wrong with the arrangement — see `reviewCluster`. */
  complaints: Complaint[];
}

/**
 * One composition, applied to one cluster — as arithmetic.
 *
 * Everything from the page's own geometry to the corrections, and
 * nothing written anywhere: the store decides what to do with it. That
 * separation is what lets a whole page be stood up in one go — the same
 * routine runs per tile and the results are written together, so a
 * sheet of six clusters is one undo step and not six.
 */
async function standUpCluster(args: {
  offerId: string;
  members: Offer[];
  overrides: PlacementOverrides;
  /** The same-origin copies of the cutouts, by their 1-based place. */
  copies: { index: number; url: string }[];
  /** What the model read, numbered within THIS tile's pack. */
  placed: PlacedProduct[];
  /** The picture's own proportions, width over height. */
  picture: number;
}): Promise<StoodUp | { error: string }> {
  const { offerId, members, overrides, placed } = args;

  /*
   * First the cutouts' own margins.
   *
   * Read from the copies `prepareCluster` put on this server rather
   * than from the chain's image host, because a canvas may not read
   * another origin's pixels — see `inkOf`. Awaited before the page is
   * measured, not after: everything below has to describe one layout.
   */
  const inks = await Promise.all(members.map((_, index) => {
    const copy = args.copies.find((entry) => entry.index === index + 1);
    return copy ? inkOf(copy.url) : Promise.resolve(WHOLE);
  }));

  /*
   * Measured on the PAGE.
   *
   * The composition comes back as fractions of a picture, and to turn
   * those into a move for a real cutout we need to know where that
   * cutout is now — which only the browser knows, because it is the
   * browser that laid the cluster out.
   */
  const tile = window.document.querySelector(`[data-offer-id="${CSS.escape(offerId)}"]`);
  const media = tile?.querySelector('.tile__media')?.getBoundingClientRect();
  const page = tile?.closest('.page')?.getBoundingClientRect();
  if (!media || !page || media.width === 0 || page.width === 0) {
    return { error: `${tileName(members)}: flisen skal være synlig på siden` };
  }

  const now = members.map((_, index) => measurePack(
    tile?.querySelector(`[data-pack="${index}"]`) ?? null,
    packOverride(overrides, index),
    inks[index] ?? WHOLE,
  ));

  /*
   * What each pack says it holds, for the review below — never for the
   * placement. See `readPackSize`: the feed's own field is empty in
   * every SuperBrugsen offer, and the sentence carries the number.
   */
  const sizes = members.map((member) => {
    const said = readPackSize(member.description ?? '') ?? readPackSize(member.name ?? '');
    return said ? said.value : null;
  });

  const { patches, frame, complaints } = planCluster({
    media, page, picture: args.picture, placed, measured: now, sizes,
  });

  /*
   * The whole calculation, in words.
   *
   * Cheap to build and the only thing that can settle a tile that comes
   * out wrong: the numbers are the difference between "it ignored my
   * picture" and "product three was measured in the wrong place".
   */
  const report = [
    `felt ${media.width.toFixed(0)}×${media.height.toFixed(0)}`
    + ` · side ${page.width.toFixed(0)}×${page.height.toFixed(0)}`
    + ` · billede ${args.picture.toFixed(2)}:1`
    + ` · ${members.length} varer, ${now.filter(Boolean).length} målt`
    + `${frame ? '' : ' · ingen ramme'}`,
    ...members.map((member, index) => {
      const stands = now[index];
      const read = placed.find((product) => product.index - 1 === index);
      const patch = patches.get(index);
      const name = `${index}. ${(member.brand ? `${member.brand} ` : '') + member.name}`
        .slice(0, 44);
      if (!stands) return `${name}: ingen billedkasse på siden — sprunget over`;
      const margin = inks[index] ?? WHOLE;
      const at = `står ${((stands.cx - media.left) / media.width).toFixed(2)}`
        + `/${((stands.cy - media.top) / media.height).toFixed(2)}`
        + ` b${(stands.width / media.width).toFixed(2)}`
        + (margin.width < 0.97 || margin.height < 0.97
          ? ` (udklip ${Math.round(margin.width * 100)}% fyldt)` : '');
      if (!read) return `${name}: ${at} · ikke fundet i billedet`;
      if (!patch) return `${name}: ${at} · læst ${read.cx.toFixed(2)} men ingen rettelse`;
      const limit = [
        Math.abs(patch.offsetX) >= PACK_LIMITS.offset
          || Math.abs(patch.offsetY) >= PACK_LIMITS.offset ? 'FLYT-GRÆNSE' : '',
        patch.scale <= PACK_LIMITS.minScale
          || patch.scale >= PACK_LIMITS.maxScale ? 'SKALA-GRÆNSE' : '',
      ].filter(Boolean).join(' ');
      return `${name}: ${at} · læst ${read.cx.toFixed(2)}/${read.cy.toFixed(2)}`
        + ` b${read.width.toFixed(2)} ↓${(read.bottom ?? 0).toFixed(3)}`
        + ` · retter ${patch.offsetX.toFixed(1)}`
        + `/${patch.offsetY.toFixed(1)}% ×${patch.scale.toFixed(2)}${limit ? ` · ${limit}` : ''}`;
    }),
  ];

  /*
   * The review, in the same words the panel shows. It corrects nothing
   * — a composition an editor asked for is theirs — but a tool that
   * cannot say "this one covers half of that one" is a tool nobody can
   * trust to run unattended.
   */
  if (complaints.length > 0) {
    report.push(...complaints.map((entry) => (entry.index === null
      ? `⚠ ${entry.said}`
      : `⚠ ${entry.index}. ${(members[entry.index]?.name ?? '').slice(0, 30)}: ${entry.said}`)));
  }

  return {
    offerId,
    patches,
    frame,
    report,
    missing: members.length - patches.size,
    complaints,
  };
}

/** What to call a cluster on screen: its products, not its id. */
function tileName(members: Offer[]): string {
  return members.map((member) => member.name.split(/[,(]/)[0]!.trim()).join(' · ').slice(0, 60);
}

/** Write one tile's corrections into the document. */
function withPatches(
  document: CatalogDocument,
  stood: StoodUp[],
): CatalogDocument {
  const byOffer = new Map(stood.map((entry) => [entry.offerId, entry.patches]));
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      placements: page.placements.map((placement) => {
        const patches = byOffer.get(placement.offerId);
        if (!patches) return placement;
        return {
          ...placement,
          overrides: {
            ...placement.overrides,
            pack: [...patches.entries()].reduce(
              (all, [index, patch]) => ({
                ...all,
                [String(index)]: { ...packOverride(placement.overrides, index), ...patch },
              }),
              placement.overrides.pack,
            ),
          },
        };
      }),
    })),
  };
}

/**
 * The picture itself, kept where it can be SEEN.
 *
 * Stored on the server only so the tile has a URL to draw — it never
 * enters the document, so it cannot print and cannot be saved. Uncut:
 * the white field is what `mix-blend-mode: multiply` disappears, and a
 * keyed-out one would hide the very edges being compared. A failed
 * upload costs the proof and not the placement, which has already
 * happened.
 */
async function keepGhost(
  brandId: string,
  stood: StoodUp,
  bytes: Uint8Array,
  name: string,
): Promise<Ghost | null> {
  if (!stood.frame) return null;
  try {
    const { url } = await api.uploadImage(brandId, toBase64(bytes), name);
    return {
      offerId: stood.offerId,
      url,
      ...stood.frame,
      shown: true,
      report: stood.report,
    };
  } catch {
    return null;
  }
}

/** One ghost per tile: a second picture of the same cluster replaces it. */
function withGhost(list: Ghost[], ghost: Ghost | null): Ghost[] {
  if (!ghost) return list;
  return [...list.filter((entry) => entry.offerId !== ghost.offerId), ghost];
}

/**
 * The tiles on one sheet that can be ONE photograph each, and why the
 * others cannot.
 *
 * Asked before anything is fetched or paid for. A tile holding washing
 * powder, frozen croquettes and rye bread is three offers that share a
 * price, and handing that list to an image model buys a picture of a
 * scene nobody would print — see `notOnePhotograph`. The skipped ones
 * are named, with their reason, because "del flisen op" is something an
 * editor can act on and "skipped" is not.
 */
function pagePhotographs(
  page: CatalogPage,
  document: CatalogDocument,
): { clusters: { offer: Offer; members: Offer[] }[]; skipped: string[] } {
  const clusters: { offer: Offer; members: Offer[] }[] = [];
  const skipped: string[] = [];
  for (const placement of page.placements) {
    const offer = document.offers.find((entry) => entry.id === placement.offerId);
    if (!offer || offer.members.length < 2) continue;
    const members = packMembers(offer, document);
    const why = notOnePhotograph(members);
    if (why) skipped.push(`${tileName(members)}: ${why}`);
    else clusters.push({ offer, members });
  }
  return { clusters, skipped };
}

/** A placement nobody has corrected yet. */
const FRESH: PlacementOverrides = {
  pinned: false,
  arrangement: null,
  displayName: null,
  description: null,
  imageScale: 1,
  imageOffsetX: 0,
  imageOffsetY: 0,
  parts: {},
  pack: {},
};

/**
 * This page's placements in prominence order — lead first.
 *
 * Read off the template the page is currently using, so "the weakest
 * offer" means the one in the least prominent slot rather than the one
 * that happens to be last in the array. A placement naming a slot the
 * template does not have is a stale edit and sorts to the end.
 */
function seatOrder(page: CatalogPage, brand: Brand): Placement[] {
  const template = resolveTemplate(brand, page.templateId);
  if (!template) return page.placements;
  const rank = new Map(slotAssignmentOrder(template).map((slot, i) => [slot.id, i]));
  return [...page.placements].sort(
    (a, b) => (rank.get(a.slotId) ?? 99) - (rank.get(b.slotId) ?? 99),
  );
}

/**
 * Put a page's offers into a different template's slots.
 *
 * Prominence is carried across rather than slot ids: the offer leading
 * the old layout leads the new one, whatever the two layouts happen to
 * have called their cells. Matching on slot id instead would work only
 * while two templates share a naming convention, and would silently
 * scatter the page the first time they did not.
 *
 * Corrections travel with the offer. Someone who nudged a packshot and
 * then tried three layouts should not lose the nudge to the second one.
 */
function reseat(page: CatalogPage, brand: Brand, next: PageTemplate): Placement[] {
  const slots = slotAssignmentOrder(next);
  return seatOrder(page, brand)
    .slice(0, slots.length)
    .map((placement, index) => ({ ...placement, slotId: slots[index]!.id }));
}

export const useStudio = create<StudioState>((set, get) => {
  /*
   * The open gesture, if one is running. Not part of the public state:
   * it is bookkeeping for the undo stack, and a component that read it
   * would be reaching into how history is kept.
   */
  let gesture: string | null = null;
  let idle: number | undefined;

  /**
   * Keep a keyboard gesture open while the key repeats.
   *
   * Held arrow keys are one movement to the person holding them, so
   * they have to be one entry in history — but there is no key-up to
   * close the gesture on when the user simply stops. A short idle
   * window is what separates "still nudging" from "done".
   */
  function repeating(name: string): string {
    window.clearTimeout(idle);
    idle = window.setTimeout(() => { gesture = null; }, 600);
    return name;
  }

  /**
   * Run a feed through the chain's own reader and put the products in
   * the library.
   *
   * Shared by the upload and by the sample the chain ships, because the
   * difference between the two is only how loudly it is announced: an
   * upload is something somebody just did and gets a line about what was
   * in the file; the sample is simply what the editor opens with, and
   * saying "1235 varer" about it every time the page reloads is noise.
   *
   * Failure never costs the feed. The plain draft and the rebuild both
   * take the raw text and run their own reader, and one of them may yet
   * be pointed at the right source by hand — so a file this could not
   * read stays loaded, and only the library is empty.
   */
  async function loadFeed(
    brandId: string, name: string, text: string, announce: boolean,
  ): Promise<void> {
    if (announce) set({ busy: 'Læser feedet…' });
    try {
      const reading = await api.readFeed(brandId, text, name);
      set({
        feedOffers: reading.offers,
        feedReading: { source: reading.source, withImage: reading.withImage },
        librarySelection: [],
        ...(announce
          ? {
            libraryOpen: true,
            busy: null,
            note: [
              reading.source.name,
              count(reading.offers.length, 'vare', 'varer'),
              `${reading.withImage} med billede`,
            ].join(' · '),
          }
          : {}),
      });
    } catch (error) {
      set({
        feedOffers: [],
        feedReading: null,
        ...(announce
          ? { busy: null, error: `${name} kunne ikke læses: ${message(error)}` }
          : {}),
      });
    }
  }

  /** One placement's corrections, or undefined if it is not on a page. */
  function overridesOf(offerId: string) {
    return get().document?.pages
      .flatMap((page) => page.placements)
      .find((placement) => placement.offerId === offerId)
      ?.overrides;
  }

  function pageById(pageId: string): CatalogPage | undefined {
    return get().document?.pages.find((page) => page.id === pageId);
  }

  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

  /**
   * Push the current document onto the undo stack before mutating it.
   *
   * Naming a gesture that is already open skips the push, so the whole
   * drag lands in history as the one change the user perceives.
   */
  function mutate(
    change: (document: CatalogDocument) => CatalogDocument,
    name?: string,
  ): void {
    const { document, past } = get();
    if (!document) return;
    const continues = name !== undefined && name === gesture;
    gesture = name ?? null;
    set({
      ...(continues ? {} : { past: [...past.slice(-29), document], future: [] }),
      document: change(document),
    });
  }

  return {
    brands: [],
    brandId: null,
    brand: null,
    sources: [],
    feed: null,
    document: null,
    catalogues: [],
    curationReady: false,
    decorReady: false,
    decorModel: '',
    decorNote: '',
    decorStyle: '',
    busy: null,
    error: null,
    note: null,
    reproduceOpen: false,
    references: [],
    reproduceNote: '',
    reproduceAppend: false,
    reproductions: [],
    feedOffers: [],
    feedReading: null,
    libraryOpen: false,
    librarySearch: '',
    librarySelection: [],
    libraryClosedGroups: [],
    arrangeNote: '',
    activePageId: null,
    publicationUrl: '',
    publicationPages: '',
    publicationAppend: false,
    publicationWithOffers: true,
    layoutCells: 6,
    layoutNote: '',
    layoutAppend: false,
    selectedOfferId: null,
    selectedDecorId: null,
    selectedPart: null,
    selectedPack: null,
    manual: null,
    ghosts: [],
    manualPage: null,
    selectedText: null,
    maxPages: 6,
    past: [],
    future: [],

    async start() {
      try {
        const brands = await api.fetchBrands();
        set({ brands });
        const remembered = rememberedBrand();
        const chosen = brands.find((b) => b.id === remembered) ?? brands[0];
        if (chosen) await get().signInAs(chosen.id);
      } catch (error) {
        set({ error: `Kunne ikke nå API-serveren — kør \`npm run dev:api\`. (${message(error)})` });
      }
    },

    /*
     * Switching chain is a full reset, not a filter.
     *
     * Everything in the editor belongs to one chain — its feed, its
     * layouts, its catalogue — so carrying any of it across would be the
     * exact mixing this system is meant to prevent. Cheaper and safer to
     * throw it all away and load the other chain from scratch.
     */
    async signInAs(brandId: string) {
      set({
        busy: 'Skifter kæde…',
        error: null,
        note: null,
        document: null,
        feed: null,
        brand: null,
        sources: [],
        // The products belong to one chain as much as the feed they
        // came out of does — see the note above.
        feedOffers: [],
        feedReading: null,
        librarySelection: [],
        libraryClosedGroups: [],
        activePageId: null,
        selectedOfferId: null,
        selectedPart: null,
        selectedText: null,
        past: [],
        future: [],
        catalogues: [],
        // Reference pages and their rebuilds belong to one chain as
        // much as a feed does — see the note above.
        references: [],
        reproductions: [],
        reproduceOpen: false,
      });
      try {
        window.localStorage.setItem(BRAND_KEY, brandId);
      } catch { /* private browsing; the picker still works for this session */ }

      try {
        const profile = await api.fetchBrandProfile(brandId);
        /*
         * The file the editor opens with, which is not the same
         * question as which reader an unlabelled upload belongs to.
         * A chain says which one by marking it — see `FeedSource.sample`
         * — and otherwise the first one that ships a file will do. A
         * chain with no shipped sample simply starts empty and waits
         * for an upload.
         */
        const sample = profile.sources.find((source) => source.path && source.sample)
          ?? profile.sources.find((source) => source.path);
        const [curationReady, decor, text] = await Promise.all([
          api.fetchCurationStatus(brandId),
          api.fetchDecorStatus(brandId),
          sample?.path ? api.fetchFeed(sample.path) : Promise.resolve(null),
        ]);
        void get().refreshCatalogues();
        set({
          brandId,
          brand: profile.brand,
          sources: profile.sources,
          curationReady,
          decorReady: decor.configured,
          decorModel: decor.imageModel,
          feed: text && sample?.path
            ? { text, source: sample.path.split('/').pop() ?? sample.path }
            : null,
          busy: null,
        });
        // The shipped sample fills the library too, quietly: it is what
        // the editor opens with, not something somebody just did.
        if (text && sample?.path) {
          void loadFeed(brandId, sample.path.split('/').pop() ?? sample.path, text, false);
        }
      } catch (error) {
        set({ busy: null, brandId, error: message(error) });
      }
    },

    async uploadFeed(name, text) {
      const { brandId } = get();
      set({ feed: { text, source: name }, error: null, note: null });
      if (!brandId) return;
      /*
       * Read straight away, and never quietly.
       *
       * The file used to be stored as a string and nothing more, so a
       * feed in the wrong format — or one this chain's reader does not
       * recognise — looked exactly like a good one until a rebuild had
       * been paid for. This runs the chain's own reader immediately, for
       * free and with no model, and what comes back is both the answer
       * to "did it parse" and the library of products.
       */
      await loadFeed(brandId, name, text, true);
    },

    async build(options = {}) {
      const { brandId, feed, maxPages } = get();
      if (!brandId || !feed) return;

      set({ busy: 'Bygger…', error: null, note: null });

      try {
        const reply = await api.buildCatalogue(brandId, {
          feed: feed.text,
          maxPages,
          skipCuration: true,
          // A fresh seed on every click: pressing the button again is a
          // request for another take, and with a fixed seed the second
          // click returns the first click's pages.
          ...(options.fresh ? { seed: String(Date.now()) } : {}),
        });

        const notes = [
          reply.source.name,
          `${reply.document.pages.length} sider af ${reply.offerCount} tilbud`,
          'kategorisortering — ingen model',
          ...(reply.dropped > 0 ? [`${reply.dropped} tilbud kunne ikke være med`] : []),
          ...(reply.substitutions.length > 0
            ? [`${reply.substitutions.length} sider fik en anden skabelon`]
            : []),
        ];

        set({
          document: reply.document,
          past: [],
          future: [],
          // The library deals onto a page, and a fresh document needs
          // one named or the first click would have nowhere to land.
          activePageId: reply.document.pages[0]?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          busy: null,
          // The canvas now shows a plain draft, not rebuilt pages, so
          // the comparison strips have nothing left to compare.
          reproductions: [],
          note: notes.join(' · '),
          ...(reply.curationError ? { error: reply.curationError } : {}),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async save() {
      const { brandId, document } = get();
      if (!brandId || !document) return;
      set({ busy: 'Gemmer…', error: null });
      try {
        await api.saveCatalogue(brandId, document, 'manuel');
        set({ busy: null, note: 'Gemt' });
        await get().refreshCatalogues();
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async refreshCatalogues() {
      const { brandId } = get();
      if (!brandId) return;
      try {
        set({ catalogues: await api.fetchCatalogues(brandId) });
      } catch {
        // A list that cannot be read is not worth interrupting anyone
        // over; the editor works without it and the next save retries.
      }
    },

    async openCatalogue(id) {
      const { brandId } = get();
      if (!brandId || !id) return;
      set({ busy: 'Åbner…', error: null, note: null });
      try {
        const document = await api.fetchCatalogue(brandId, id);
        if (!document) {
          set({ busy: null, error: 'Den avis findes ikke længere' });
          return;
        }
        set({
          document,
          busy: null,
          past: [],
          future: [],
          activePageId: document.pages[0]?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          /*
           * The comparison strips do not come back, and cannot: what the
           * model was shown is a picture, and a document carries the
           * catalogue rather than the session that produced it. The
           * pages — the part that cost money — do come back.
           */
          reproductions: [],
          note: `Åbnede ${document.name} · ${count(document.pages.length, 'side', 'sider')}`,
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    /*
     * Save, then print. The endpoint renders what is STORED, so printing
     * an unsaved edit would hand back the previous version — silently,
     * and only visible once someone compared the PDF to the screen.
     */
    async downloadPdf() {
      const { brandId, document } = get();
      if (!brandId || !document) return;
      set({ busy: 'Printer PDF…', error: null });
      try {
        await api.saveCatalogue(brandId, document, 'før print');
        const blob = await api.fetchCataloguePdf(brandId, document.id);
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${document.id}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        set({ busy: null, note: 'PDF hentet' });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },


    setReproduceOpen: (open) => set({ reproduceOpen: open, error: null }),

    /*
     * The files, read once and kept as base64.
     *
     * Appended rather than replaced: picking four files and then
     * remembering a fifth is the normal way this list is built, and a
     * picker that threw the first four away would be a trap. A file
     * that cannot be read is reported by name and the rest still land.
     */
    async addReferences(files: File[]) {
      if (files.length === 0) return;
      set({ busy: files.length > 1 ? `Læser ${files.length} filer…` : 'Læser referencen…', error: null });
      const added: ReferenceFile[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          // Read from the bytes, not the name: what matters is whether a
          // page has to be picked out of it.
          const isPdf = String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
          const pageCount = isPdf ? await countPages(bytes) : null;
          added.push({
            id: `ref-${Date.now().toString(36)}-${added.length}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            base64: toBase64(bytes),
            isPdf,
            pageCount,
            /*
             * The whole file, not its first page.
             *
             * A chain hands in last week's avis as one PDF, and a row
             * that defaults to "1" reads as a tool that can only see the
             * front page — which is what it looked like. The field is
             * still the editor's: it is filled in, not locked, and
             * nothing is spent until the run button is pressed. What a
             * long file costs is on the button itself, in pages and
             * minutes, beside the cap.
             */
            pages: wholeDocument(pageCount),
          });
        } catch (error) {
          failed.push(`${file.name} (${message(error)})`);
        }
      }
      const references = [...get().references, ...added];
      set({
        references,
        busy: null,
        ...(failed.length > 0 ? { error: `Kunne ikke læse ${failed.join(', ')}` } : {}),
        note: added.length > 0
          ? `${count(referenceJobs(references).length, 'side', 'sider')} klar til at blive genskabt`
          : null,
      });
    },

    setReferencePages: (id, spec) => set({
      references: get().references.map((reference) => (reference.id === id
        // Kept as typed, not as parsed: a half-typed "1-" has to stay
        // on screen long enough to become "1-6".
        ? { ...reference, pages: spec.slice(0, 40) }
        : reference)),
    }),

    removeReference: (id) => set({
      references: get().references.filter((reference) => reference.id !== id),
    }),

    moveReference(id, delta) {
      const references = [...get().references];
      const at = references.findIndex((reference) => reference.id === id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= references.length) return;
      const [moved] = references.splice(at, 1);
      references.splice(to, 0, moved!);
      set({ references });
    },

    clearReferences: () => set({ references: [], error: null }),

    setReproduceNote: (note) => set({ reproduceNote: note }),
    setReproduceAppend: (append) => set({ reproduceAppend: append }),

    /*
     * The rebuilt pages arrive as ordinary documents, so everything the
     * editor already does — dragging a tile, nudging a price, saving,
     * printing — works on them unchanged.
     *
     * One request per page, in order, and the reason is worth keeping:
     *
     *  - each page is told which offers the pages before it used, so a
     *    catalogue does not print the same coffee on four spreads;
     *  - the canvas grows a page at a time, so a run of eight is
     *    something you can watch rather than a spinner for six minutes;
     *  - a reference the model cannot read costs that one page, not the
     *    seven that already worked.
     *
     * The loop lives here rather than on the server because a single
     * request carrying eight model calls would be cut off by the
     * server's own request timeout long before it answered. The pieces
     * that must not differ between this and the terminal's `matchPages`
     * — what is excluded, and how pages are merged — are shared.
     *
     * The brand is replaced by the one the replies carry, extended with
     * every layout in the run. A page read off a reference sits on a
     * grid that is not in the chain's set, and without it the canvas
     * renders "ukendt skabelon" over a page that is perfectly valid.
     */
    async reproduce() {
      const { brandId, feed, references, reproduceNote, reproduceAppend } = get();
      const jobs = referenceJobs(references);
      if (!brandId || jobs.length === 0) return;

      /*
       * Adding to what is open, or starting again.
       *
       * Appending is how a whole avis gets built here: four pages, look
       * at them, two more. The document already on the canvas becomes
       * the first part of the merge — hand edits included — and its
       * offers join the exclusion list so the new pages bring new goods.
       */
      const base = reproduceAppend ? get().document : null;
      const parts: CatalogDocument[] = base ? [base] : [];
      const spent = base ? base.offers.map((offer) => offer.id) : [];

      /*
       * Merging renumbers pages by position, so a run that appends
       * moves the ids the old runs were keyed by. Re-keyed here, or the
       * reference shown above page five would be page two's.
       */
      let runs: PageRun[] = base
        ? (() => {
            const moved = new Map(base.pages.map((page, index) => [page.id, `page-${index + 1}`]));
            return get().reproductions.map((run) => ({
              ...run,
              pageId: moved.get(run.pageId) ?? run.pageId,
            }));
          })()
        : [];

      /*
       * A name of its own, so this run does not overwrite the last one.
       *
       * Every run is saved when it finishes — see the end of this
       * function — and a fixed id would mean each rebuilt page quietly
       * replaced the previous one in the store. The whole point of
       * keeping them is that a page cost a model call once.
       *
       * Appending keeps the open catalogue's id: adding two pages to an
       * avis is the same avis, not a new one.
       */
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12);
      const catalogId = base ? base.id : `${brandId}-${stamp}`;
      const catalogName = base
        ? base.name
        : `${get().brand?.name ?? brandId} · ${new Date().toLocaleString('da-DK', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}`;

      const failures: { refId: string; name: string; message: string }[] = [];
      const cost = { inputTokens: 0, outputTokens: 0 };
      const started = Date.now();
      set({ busy: 'Claude læser siden…', error: null, note: null, reproduceOpen: false });

      for (const [index, job] of jobs.entries()) {
        set({
          busy: jobs.length > 1
            ? `Claude læser side ${index + 1} af ${jobs.length}…`
            : 'Claude læser siden…',
        });
        try {
          const reply = await api.reproducePage(brandId, {
            file: job.base64,
            feed: feed?.text ?? '',
            referenceName: job.name,
            ...(job.pageNumber ? { pageNumber: job.pageNumber } : {}),
            ...(reproduceNote.trim() ? { note: reproduceNote.trim() } : {}),
            ...(spent.length > 0 ? { exclude: spent } : {}),
          });

          parts.push(reply.document);
          spent.push(...reply.document.offers.map((offer) => offer.id));
          cost.inputTokens += reply.usage.inputTokens;
          cost.outputTokens += reply.usage.outputTokens;

          const document = mergeCatalogDocuments(parts, {
            id: catalogId,
            name: catalogName,
          });
          const landed = document.pages[document.pages.length - 1];
          runs = [...runs, {
            pageId: landed?.id ?? `page-${document.pages.length}`,
            reference: reply.reference,
            referenceName: job.name,
            template: reply.template,
            ground: reply.ground,
            grid: reply.grid,
            casting: reply.casting,
            source: reply.source,
            offersInFeed: reply.offersInFeed,
            poolSize: reply.poolSize,
            rejected: reply.rejected,
            usage: reply.usage,
            elapsedMs: reply.elapsedMs,
          }];

          /*
           * Set after every page, not at the end: the pages appear as
           * they are built. History is cleared rather than appended to
           * — the run is one action, and undoing it a page at a time
           * would leave a catalogue nobody asked for.
           */
          set({
            document,
            brand: withTemplates(reply.brand, document.templates),
            reproductions: runs,
            past: [],
            future: [],
            activePageId: document.pages[document.pages.length - 1]?.id ?? null,
            selectedOfferId: null,
            selectedPart: null,
            selectedPack: null,
            selectedText: null,
          });
        } catch (error) {
          failures.push({ refId: job.refId, name: job.name, message: message(error) });
        }
      }

      const built = runs.length - (base ? base.pages.length : 0);
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      const spend = (cost.inputTokens * 5 + cost.outputTokens * 25) / 1e6;

      /*
       * What worked leaves the list; what did not stays in it.
       *
       * Otherwise the next run silently rebuilds the pages you already
       * have — and with "læg til" ticked, pays for them twice. A
       * reference that failed is left where it is, because the usual
       * answer to a page the model could not read is to try that one
       * again, not to find the file again.
       */
      /*
       * Saved here rather than left to the Gem button.
       *
       * These pages cost a model call each. Leaving them unsaved means a
       * reload, a chain switch or a second run throws away something
       * that was paid for — and the only way back is to pay again. A
       * failure to save is reported but does not fail the run: the
       * pages are on the canvas either way.
       */
      if (built > 0) {
        const made = get().document;
        if (made) {
          try {
            await api.saveCatalogue(brandId, made, 'genskabt');
            await get().refreshCatalogues();
          } catch (error) {
            failures.push({ refId: '', name: 'gem', message: message(error) });
          }
        }
      }

      const stuck = new Set(failures.map((failure) => failure.refId));
      set({
        busy: null,
        references: get().references.filter((reference) => stuck.has(reference.id)),
        // The run built something, so adding to it is the next likely
        // move; it was opt-in for a run that replaces what is open.
        reproduceAppend: built > 0,
        // Every page failed: there is nothing to look at, so the reason
        // is the whole message rather than a footnote under a result.
        ...(built === 0
          ? { error: failures[0]?.message ?? 'ingen sider kunne genskabes' }
          : {
            error: failures.length > 0
              ? `${count(failures.length, 'side', 'sider')} kunne ikke genskabes: ${failures.map((f) => `${f.name} — ${f.message}`).join(' · ')}`
              : null,
            note: [
              `${count(built, 'side', 'sider')} genskabt`,
              `${seconds}s`,
              `≈ $${spend.toFixed(2)}`,
            ].join(' · '),
          }),
      });
    },

    setDecorNote: (value) => set({ decorNote: value }),
    setDecorStyle: (value) => set({ decorStyle: value }),

    /**
     * Paint mood artwork behind the offers on every page.
     *
     * Pushed onto the history like any other edit, so it is one ⌘Z — the
     * whole point of returning a document rather than patching pages.
     * Nothing else about the catalogue moves: decoration runs over a
     * finished layout and touches no placement.
     *
     * The note says how many pages were deliberately left plain, because
     * that is the number people query. A page with no motif looks like a
     * failure and is usually the model correctly refusing to put a
     * photograph of toilet paper behind the toilet paper.
     */
    async decorate() {
      const { brandId, document, decorNote, decorStyle, past } = get();
      if (!brandId || !document) return;

      set({ busy: 'Gemini tegner…', error: null, note: null });
      try {
        const reply = await api.decorateDocument(brandId, document, {
          brief: decorNote,
          style: decorStyle,
        });
        set({
          document: reply.document,
          past: [...past.slice(-29), document],
          future: [],
          busy: null,
          note: [
            `${count(reply.drawn, 'side', 'sider')} fik et stemningsbillede`,
            ...(reply.cached > 0 ? [`${reply.cached} fra cache`] : []),
            ...(reply.skipped > 0 ? [`${reply.skipped} bevidst uden`] : []),
          ].join(' · '),
          // Reported, not thrown: pages that DID get artwork are kept.
          ...(reply.errors.length > 0
            ? { error: reply.errors.map((e) => e.message).join(' · ') }
            : {}),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    /*
     * Choosing a tile drops whatever box was in hand.
     *
     * Carrying "the kilo price" across to the next tile means the first
     * arrow key after a click moves a line nobody was looking at. A new
     * tile starts on the tile itself, which is the artwork.
     */
    select: (offerId) => set(
      offerId === get().selectedOfferId
        // A picture and a tile are never both in hand: the arrow keys
        // would have two things to move and the inspector two things to
        // describe.
        ? { selectedOfferId: offerId, selectedDecorId: null, selectedText: null }
        : {
          selectedOfferId: offerId,
          selectedPart: null,
          // Another tile's variant index means nothing on this one.
          selectedPack: null,
          selectedDecorId: null,
          selectedText: null,
        },
    ),

    selectDecor: (decorId) => set({
      selectedDecorId: decorId,
      ...(decorId
        ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedText: null }
        : {}),
    }),

    selectPart: (part) => set({
      selectedPart: part,
      // Leaving the artwork box leaves whatever variant of it was in
      // hand: a nudge with a stale index would move a product nobody is
      // looking at.
      ...(part === 'media' ? {} : { selectedPack: null }),
    }),

    selectPageText: (pageId, part) => set(
      part === null
        ? { selectedText: null }
        // A line and a tile are never both in hand, for the same reason
        // a picture and a tile are not: one selection, one thing the
        // arrow keys move.
        : {
          selectedText: { pageId, part },
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedDecorId: null,
        },
    ),

    /*
     * Exchange two tiles, on the same page or across pages.
     *
     * The offer and its hand-made corrections travel together: an
     * editor who rewrote a headline and then moved the tile expects the
     * headline to follow it, not to stay behind on the slot. Dropping
     * onto an empty slot moves rather than swaps.
     */
    swapPlacements(from, to) {
      if (from.pageId === to.pageId && from.slotId === to.slotId) return;

      mutate((document) => {
        const find = (at: { pageId: string; slotId: string }) =>
          document.pages
            .find((page) => page.id === at.pageId)
            ?.placements.find((p) => p.slotId === at.slotId);

        const source = find(from);
        if (!source) return document;
        const target = find(to);

        const pages = document.pages.map((page) => {
          if (page.id !== from.pageId && page.id !== to.pageId) return page;

          const placements = page.placements
            .map((placement) => {
              const here = { pageId: page.id, slotId: placement.slotId };
              if (here.pageId === from.pageId && here.slotId === from.slotId) {
                // Nothing to take back from an empty target: this slot
                // is emptied, and the filter below removes it.
                return target
                  ? { ...placement, offerId: target.offerId, overrides: target.overrides }
                  : null;
              }
              if (here.pageId === to.pageId && here.slotId === to.slotId) {
                return { ...placement, offerId: source.offerId, overrides: source.overrides };
              }
              return placement;
            })
            .filter((placement): placement is NonNullable<typeof placement> => placement !== null);

          // A move onto a slot that held nothing has to create it.
          if (page.id === to.pageId && !target) {
            placements.push({
              offerId: source.offerId,
              slotId: to.slotId,
              overrides: source.overrides,
            });
          }
          return { ...page, placements };
        });

        return { ...document, pages };
      });
    },
    setMaxPages: (pages) => set({ maxPages: Math.max(1, Math.min(60, pages)) }),

    endGesture() { gesture = null; },

    async prepareCluster(offerId) {
      const { brandId, document, brand } = get();
      if (!brandId || !document || !brand) return;

      const offer = document.offers.find((entry) => entry.id === offerId);
      if (!offer) return;
      /*
       * The MEMBERS, not the pack's image URLs: the prompt names image
       * N after product N, so it needs the products — their names and
       * their pack sizes — and not merely a list of pictures.
       */
      const members = packMembers(offer, document);
      if (members.length < 2) {
        set({ error: 'flisen er ikke sat sammen af flere varer' });
        return;
      }

      // The cell's own proportions, so the picture comes back the shape
      // it has to fill — the same number the automatic route sends.
      const seat = document.pages
        .flatMap((page) => page.placements.map((placement) => ({ page, placement })))
        .find((entry) => entry.placement.offerId === offerId);
      const template = seat
        ? resolveTemplate(brand, seat.page.templateId)
          ?? document.templates.find((t) => t.id === seat.page.templateId)
        : undefined;
      const cell = template && seat
        ? slotCells(template, brand.pageAspect).get(seat.placement.slotId)
        : undefined;

      set({ busy: 'Henter prompt og udklip…', error: null, note: null });
      try {
        const ready = await api.prepareCluster(brandId, {
          offers: members,
          ...(cell?.aspect ? { aspect: cell.aspect } : {}),
          ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
        });
        /*
         * Said, not enforced.
         *
         * The page-wide buttons refuse a tile that is three offers
         * sharing a price — see `pagePhotographs`. This one was pressed
         * at a named tile by somebody who meant it, so it runs, and the
         * warning goes where it can still change their mind.
         */
        const doubt = notOnePhotograph(members);
        set({
          manual: { offerId, prompt: ready.prompt, files: ready.files },
          busy: null,
          note: [`${count(ready.files.length, 'udklip', 'udklip')} klar`, doubt]
            .filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async applyClusterLayout(offerId, file) {
      const { brandId, document } = get();
      if (!brandId || !document) return;

      const offer = document.offers.find((entry) => entry.id === offerId);
      const members = offer ? packMembers(offer, document) : [];
      if (!offer || members.length < 2) {
        set({ error: 'flisen er ikke sat sammen af flere varer' });
        return;
      }

      set({ busy: 'Læser opstillingen…', error: null, note: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const reading = await api.readClusterLayout(brandId, {
          file: toBase64(bytes),
          offers: members,
        });

        const stood = await standUpCluster({
          offerId,
          members,
          overrides: document.pages.flatMap((entry) => entry.placements)
            .find((entry) => entry.offerId === offerId)?.overrides ?? { ...FRESH },
          copies: get().manual?.offerId === offerId ? get().manual?.files ?? [] : [],
          placed: reading.products,
          /*
           * The picture's own proportions, read from the file rather
           * than assumed from the prompt: the cell's aspect ratio is
           * ASKED for and the image model answers with whatever it
           * renders, usually a square.
           */
          picture: await pictureAspect(file),
        });
        if ('error' in stood) {
          set({ busy: null, error: stood.error });
          return;
        }
        if (stood.patches.size === 0) {
          set({ busy: null, error: 'ingen af varerne kunne genfindes i billedet' });
          return;
        }

        gesture = null;
        mutate((doc) => withPatches(doc, [stood]));

        const ghost = await keepGhost(brandId, stood, bytes, file.name);
        set({
          busy: null,
          manual: null,
          ghosts: withGhost(get().ghosts, ghost),
          note: [
            `${count(stood.patches.size, 'vare', 'varer')} stillet op efter billedet`,
            reading.missing.length > 0
              ? `${reading.missing.length} kunne ikke genfindes og står som før`
              : '',
            stood.complaints.length > 0
              ? `${count(stood.complaints.length, 'advarsel', 'advarsler')} — se tallene i panelet`
              : '',
            ghost ? 'referencen ligger over flisen' : '',
          ].filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async prepareClusters(pageId: string) {
      const { brandId, document, brand } = get();
      if (!brandId || !document || !brand) return;
      const page = document.pages.find((entry) => entry.id === pageId);
      if (!page) return;

      /*
       * Every cluster on the sheet, in the order they are read.
       *
       * The point of doing them together: the prompts and the cutouts
       * for a whole page are one errand, so an editor takes the lot
       * into Gemini in one sitting instead of coming back to the studio
       * between every tile.
       */
      const { clusters, skipped } = pagePhotographs(page, document);
      if (clusters.length === 0) {
        set({
          error: skipped.length > 0
            ? skipped.join(' · ')
            : 'der er ingen sammensatte fliser på siden',
        });
        return;
      }

      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId);
      const cells = template ? slotCells(template, brand.pageAspect) : undefined;

      set({ busy: `Henter prompter og udklip til ${clusters.length} klynger…`, error: null, note: null });
      try {
        const ready = [];
        for (const { offer, members } of clusters) {
          const slot = page.placements.find((entry) => entry.offerId === offer.id)?.slotId;
          const aspect = slot ? cells?.get(slot)?.aspect : undefined;
          // One at a time: each fetches every cutout in the cluster from
          // the chain's image host, and a page of six would otherwise
          // open forty connections at once.
          // eslint-disable-next-line no-await-in-loop
          const made = await api.prepareCluster(brandId, {
            offers: members,
            ...(aspect ? { aspect } : {}),
            ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
          });
          ready.push({
            offerId: offer.id,
            name: tileName(members),
            prompt: made.prompt,
            files: made.files,
          });
        }
        set({
          manualPage: { pageId, tiles: ready },
          manual: null,
          busy: null,
          note: [
            `${count(ready.length, 'klynge', 'klynger')} klar`
            + ' — kør dem i Gemini og læg billederne ind samlet',
            ...skipped,
          ].join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async applyClusterLayouts(pageId: string, files: File[]) {
      const { brandId, document } = get();
      if (!brandId || !document || files.length === 0) return;
      const page = document.pages.find((entry) => entry.id === pageId);
      if (!page) return;

      const clusters = pagePhotographs(page, document).clusters
        .map((entry) => ({ offerId: entry.offer.id, members: entry.members }));
      if (clusters.length === 0) {
        set({ error: 'der er ingen fliser på siden der kan være ét fotografi' });
        return;
      }

      /*
       * Every product on the sheet, named once, with a note of whose it
       * is.
       *
       * This is what makes dropping a folder of compositions work: each
       * picture is read against the WHOLE page rather than against a
       * tile somebody had to pick first. The products it finds say
       * which cluster it is a picture of, and the same answer carries
       * the geometry — so matching the picture to the tile costs no
       * extra call.
       */
      const roll = clusters.flatMap(({ offerId, members }) => members.map((member, index) => (
        { offerId, packIndex: index, member }
      )));

      const stoodUp: StoodUp[] = [];
      const ghosts: Ghost[] = [];
      const notes: string[] = [];
      const done = new Set<string>();

      set({ busy: `Læser ${count(files.length, 'billede', 'billeder')}…`, error: null, note: null });
      try {
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          const bytes = new Uint8Array(await file.arrayBuffer());
          // eslint-disable-next-line no-await-in-loop
          const reading = await api.readClusterLayout(brandId, {
            file: toBase64(bytes),
            offers: roll.map((entry) => entry.member),
          });

          // Whose picture is this? The cluster most of its products
          // belong to — a picture of three cheeses names three members
          // of one tile and nothing else.
          const votes = new Map<string, typeof reading.products>();
          for (const product of reading.products) {
            const owner = roll[product.index - 1];
            if (!owner) continue;
            const list = votes.get(owner.offerId) ?? [];
            list.push({ ...product, index: owner.packIndex + 1 });
            votes.set(owner.offerId, list);
          }
          const winner = [...votes.entries()].sort((a, b) => b[1].length - a[1].length)[0];
          if (!winner || winner[1].length < 2) {
            notes.push(`${file.name}: ingen af sidens klynger blev genkendt`);
            continue;
          }
          const [offerId, placed] = winner;
          if (done.has(offerId)) {
            notes.push(`${file.name}: ${tileName(
              clusters.find((entry) => entry.offerId === offerId)!.members,
            )} var allerede stillet op`);
            continue;
          }

          const cluster = clusters.find((entry) => entry.offerId === offerId)!;
          // eslint-disable-next-line no-await-in-loop
          const stood = await standUpCluster({
            offerId,
            members: cluster.members,
            overrides: page.placements.find((entry) => entry.offerId === offerId)?.overrides
              ?? { ...FRESH },
            copies: get().manualPage?.tiles.find((entry) => entry.offerId === offerId)?.files ?? [],
            placed,
            // eslint-disable-next-line no-await-in-loop
            picture: await pictureAspect(file),
          });
          if ('error' in stood) {
            notes.push(stood.error);
            continue;
          }
          if (stood.patches.size === 0) {
            notes.push(`${file.name}: ingen af varerne kunne genfindes`);
            continue;
          }

          done.add(offerId);
          stoodUp.push(stood);
          // eslint-disable-next-line no-await-in-loop
          const ghost = await keepGhost(brandId, stood, bytes, file.name);
          if (ghost) ghosts.push(ghost);
          notes.push(`${tileName(cluster.members)}: ${
            count(stood.patches.size, 'vare', 'varer')} stillet op${
            stood.complaints.length > 0
              ? `, ${count(stood.complaints.length, 'advarsel', 'advarsler')}` : ''}`);
        }

        if (stoodUp.length === 0) {
          set({ busy: null, error: notes.join(' · ') || 'ingen af billederne kunne bruges' });
          return;
        }

        /*
         * One write for the whole sheet, so the page is one undo step.
         * Six clusters stood up together were arranged together.
         */
        gesture = null;
        mutate((doc) => withPatches(doc, stoodUp));

        set({
          busy: null,
          manualPage: null,
          ghosts: ghosts.reduce(withGhost, get().ghosts),
          note: notes.join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    closeManual: () => set({ manual: null }),

    async standUpClusters(pageId: string) {
      const { brandId, document, brand } = get();
      if (!brandId || !document || !brand) return;
      const page = document.pages.find((entry) => entry.id === pageId);
      if (!page) return;

      const { clusters, skipped } = pagePhotographs(page, document);
      if (clusters.length === 0) {
        set({
          error: skipped.length > 0
            ? skipped.join(' · ')
            : 'der er ingen sammensatte fliser på siden',
        });
        return;
      }

      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId);
      const cells = template ? slotCells(template, brand.pageAspect) : undefined;
      const note = get().arrangeNote.trim();

      const stoodUp: StoodUp[] = [];
      const ghosts: Ghost[] = [];
      const notes: string[] = [...skipped];

      try {
        for (const { offer, members } of clusters) {
          const name = tileName(members);
          const slot = page.placements.find((entry) => entry.offerId === offer.id)?.slotId;
          const aspect = slot ? cells?.get(slot)?.aspect : undefined;

          /*
           * The cutouts are copied onto this server first, and not only
           * because the composition needs them: a canvas may not read
           * another origin's pixels, so these copies are also the only
           * way to measure how much of each file is product — see
           * `inkOf`. No model is paid for this step.
           */
          set({ busy: `${name}: henter udklip…`, error: null, note: null });
          // eslint-disable-next-line no-await-in-loop
          const ready = await api.prepareCluster(brandId, {
            offers: members,
            ...(aspect ? { aspect } : {}),
            ...(note ? { note } : {}),
          });

          set({ busy: `${name}: billedmodellen sætter varerne op…` });
          // eslint-disable-next-line no-await-in-loop
          const drawn = await api.composeCluster(brandId, {
            offers: members,
            ...(aspect ? { aspect } : {}),
            ...(note ? { note } : {}),
          });

          set({ busy: `${name}: læser opstillingen…` });
          // The composition arrives keyed out and trimmed; a reader
          // needs it on white — see `onWhite`.
          // eslint-disable-next-line no-await-in-loop
          const bytes = await onWhite(drawn.url);
          // eslint-disable-next-line no-await-in-loop
          const reading = await api.readClusterLayout(brandId, {
            file: toBase64(bytes), offers: members,
          });

          // eslint-disable-next-line no-await-in-loop
          const stood = await standUpCluster({
            offerId: offer.id,
            members,
            overrides: page.placements.find((entry) => entry.offerId === offer.id)?.overrides
              ?? { ...FRESH },
            copies: ready.files,
            placed: reading.products,
            // eslint-disable-next-line no-await-in-loop
            picture: await pictureAspect(new File([bytes as BlobPart], 'composed.png')),
          });
          if ('error' in stood) { notes.push(stood.error); continue; }
          if (stood.patches.size === 0) {
            notes.push(`${name}: ingen af varerne kunne genfindes i kompositionen`);
            continue;
          }

          stoodUp.push(stood);
          // eslint-disable-next-line no-await-in-loop
          const ghost = await keepGhost(brandId, stood, bytes, 'komposition.png');
          if (ghost) ghosts.push(ghost);
          notes.push(`${name}: ${count(stood.patches.size, 'vare', 'varer')} stillet op${
            reading.missing.length > 0 ? `, ${reading.missing.length} ikke genfundet` : ''}${
            stood.complaints.length > 0
              ? `, ${count(stood.complaints.length, 'advarsel', 'advarsler')}` : ''}`);
        }

        if (stoodUp.length === 0) {
          set({ busy: null, error: notes.join(' · ') || 'ingen af klyngerne kunne stilles op' });
          return;
        }

        gesture = null;
        mutate((doc) => withPatches(doc, stoodUp));
        set({
          busy: null,
          manualPage: null,
          ghosts: ghosts.reduce(withGhost, get().ghosts),
          note: notes.join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    closeClusters: () => set({ manualPage: null }),

    toggleGhost: (offerId) => set((state) => ({
      ghosts: state.ghosts.map((entry) => (entry.offerId === offerId
        ? { ...entry, shown: !entry.shown }
        : entry)),
    })),

    async setTileImage(offerId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Skærer baggrunden fra ${file.name}…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        /*
         * Cut on the way in, and this is the one upload in the studio
         * that is.
         *
         * A composed cluster is drawn to a prompt that demands white to
         * all four edges precisely so it can be keyed out, and a white
         * rectangle on SuperBrugsen's yellow reads as a rendering bug.
         * Every other upload here is a designer's own photograph and is
         * stored untouched — a flood fill on one of those takes the sky.
         */
        const { url, cut } = await api.uploadImage(brandId, toBase64(bytes), file.name, true);
        // The dev server's static tree needs a beat to notice a path it
        // has never served — see `reachable`.
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        gesture = null;
        mutate((document) => ({
          ...document,
          offers: document.offers.map((offer) => (offer.id === offerId
            /*
             * One picture, so the pack goes. `members` stays: the
             * document still has to be able to say what the price
             * covers, even though the page no longer shows them apart.
             */
            ? { ...offer, imageUrl: url, imagePack: [] }
            : offer)),
          pages: document.pages.map((page) => ({
            ...page,
            // The per-variant corrections described products that are
            // no longer drawn separately. Left behind they would be
            // applied to whatever happened to land on those indices.
            placements: page.placements.map((placement) => (placement.offerId === offerId
              ? { ...placement, overrides: { ...placement.overrides, pack: {} } }
              : placement)),
          })),
        }));
        /*
         * Said out loud when the fill found nothing.
         *
         * `kept` near 1 means the picture had no white field to remove —
         * a model that drew a room, a table, a gradient. The file is on
         * the tile either way, because it is the editor's file and
         * refusing it would be worse; but they are told, because the
         * alternative is discovering a white rectangle on a coloured
         * page at the proof stage.
         */
        const uncut = cut !== undefined && cut.kept > 0.97;
        set({
          busy: null,
          manual: null,
          selectedPack: null,
          note: uncut ? null : `${file.name} lagt på flisen · baggrunden skåret fra`,
          error: uncut
            ? `${file.name} har ingen hvid baggrund at skære fra — den lagt på som den er.`
              + ' Bed modellen om ren hvid bund helt ud til kanten.'
            : null,
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    selectPackItem(index) {
      // Naming a variant names its box too: everything downstream asks
      // "which box" first, and a cluster is always inside the artwork.
      set({ selectedPack: index, ...(index === null ? {} : { selectedPart: 'media' as const }) });
    },

    updatePackItem(offerId, index, patch, name) {
      const current = overridesOf(offerId);
      if (!current) return;
      get().updateOverrides(offerId, packPatch(current, index, patch), name);
    },

    nudgePackItem(offerId, index, dx, dy) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { reach } = packLimits();
      get().updatePackItem(offerId, index, {
        offsetX: clamp(now.offsetX + dx, -reach, reach),
        offsetY: clamp(now.offsetY + dy, -reach, reach),
      }, repeating(`nudge:${offerId}:pack${index}`));
    },

    scalePackItem(offerId, index, delta) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { minScale, maxScale } = packLimits();
      get().updatePackItem(offerId, index, {
        scale: clamp(now.scale + delta, minScale, maxScale),
      }, repeating(`scale:${offerId}:pack${index}`));
    },

    turnPackItem(offerId, index, delta) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { turn } = packLimits();
      get().updatePackItem(offerId, index, {
        rotate: clamp(now.rotate + delta, -turn, turn),
      }, repeating(`turn:${offerId}:pack${index}`));
    },

    resetPackItem(offerId, index) {
      gesture = null;
      get().updatePackItem(offerId, index, {
        offsetX: 0, offsetY: 0, scale: 1, rotate: 0, hidden: false,
      });
    },

    setPackItemHidden(offerId, index, hidden) {
      gesture = null;
      get().updatePackItem(offerId, index, { hidden });
    },

    updatePart(offerId, part, patch, name) {
      const current = overridesOf(offerId);
      if (!current) return;
      get().updateOverrides(offerId, partPatch(current, part, patch), name);
    },

    nudgePart(offerId, part, dx, dy) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = partOverride(current, part);
      const { reach } = partLimits(part);
      get().updatePart(offerId, part, {
        offsetX: clamp(now.offsetX + dx, -reach, reach),
        offsetY: clamp(now.offsetY + dy, -reach, reach),
      }, repeating(`nudge:${offerId}:${part}`));
    },

    scalePart(offerId, part, delta) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = partOverride(current, part);
      const { minScale, maxScale } = partLimits(part);
      get().updatePart(offerId, part, {
        scale: clamp(now.scale + delta, minScale, maxScale),
      }, repeating(`scale:${offerId}:${part}`));
    },

    /*
     * Geometry and visibility, not wording.
     *
     * "Nulstil" on a box that someone both moved and renamed means put
     * it back, not un-say what they wrote — the words are a separate
     * decision with its own undo, and silently discarding them here is
     * the kind of loss nobody notices until the PDF.
     */
    resetPart(offerId, part) {
      gesture = null;
      get().updatePart(offerId, part, {
        offsetX: 0, offsetY: 0, scale: 1, hidden: false,
      });
    },

    setPartHidden(offerId, part, hidden) {
      gesture = null;
      get().updatePart(offerId, part, { hidden });
    },

    resetTile(offerId) {
      gesture = null;
      get().updateOverrides(offerId, {
        imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, parts: {}, pack: {},
      });
    },

    updatePageText(pageId, part, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, ...pageTextPatch(page, part, patch) }
          : page)),
      }), name);
    },

    nudgePageText(pageId, part, dx, dy) {
      const page = pageById(pageId);
      if (!page) return;
      const now = pageTextOverride(page, part);
      const { reach } = pageTextLimits();
      get().updatePageText(pageId, part, {
        offsetX: clamp(now.offsetX + dx, -reach, reach),
        offsetY: clamp(now.offsetY + dy, -reach, reach),
      }, repeating(`text-nudge:${pageId}:${part}`));
    },

    scalePageText(pageId, part, delta) {
      const page = pageById(pageId);
      if (!page) return;
      const now = pageTextOverride(page, part);
      const { minScale, maxScale } = pageTextLimits();
      get().updatePageText(pageId, part, {
        scale: clamp(now.scale + delta, minScale, maxScale),
      }, repeating(`text-scale:${pageId}:${part}`));
    },

    /*
     * Geometry and visibility, not wording — the same line `resetPart`
     * draws. Putting a heading back where the masthead had it must not
     * silently un-say what somebody typed into it.
     */
    resetPageText(pageId, part) {
      gesture = null;
      get().updatePageText(pageId, part, {
        offsetX: 0, offsetY: 0, scale: 1, hidden: false,
      });
    },

    setPageTextHidden(pageId, part, hidden) {
      gesture = null;
      get().updatePageText(pageId, part, { hidden });
    },

    updateOverrides(offerId, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => ({
          ...page,
          placements: page.placements.map((placement) =>
            placement.offerId === offerId
              ? { ...placement, overrides: { ...placement.overrides, ...patch } }
              : placement),
        })),
      }), name);
    },

    async addImagePage(at, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} ind i avisen…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({ busy: null, note: `${file.name} lagt ind som side ${at + 1}` });
        mutate((document) => {
          const pages = [...document.pages];
          pages.splice(Math.max(0, Math.min(at, pages.length)), 0, CatalogPage.parse({
            id: `img-${Date.now().toString(36)}`,
            kind: 'image',
            background: {
              imageUrl: url,
              subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
              fit: 'cover',
              opacity: 1,
              focusX: 50,
              focusY: 50,
            },
            placements: [],
          }));
          return { ...document, pages };
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async replaceImagePage(pageId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Skifter billedet på siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);
        set({ busy: null, note: `${file.name} lagt på siden` });
        get().setPageBackground(pageId, {
          imageUrl: url,
          subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    removePage(pageId) {
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.filter((page) => page.id !== pageId),
      }));
    },

    movePage(pageId, delta) {
      mutate((document) => {
        const index = document.pages.findIndex((p) => p.id === pageId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= document.pages.length) return document;
        const pages = [...document.pages];
        const [moved] = pages.splice(index, 1);
        pages.splice(target, 0, moved!);
        return { ...document, pages };
      });
    },

    async addPageImage(pageId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} på siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);

        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({ busy: null, note: `${file.name} lagt på siden` });
        mutate((document) => ({
          ...document,
          pages: document.pages.map((page) => (page.id === pageId
            ? {
              ...page,
              /*
               * Capped at three by the schema, and the cap is the design
               * — a page that is mostly filler has stopped being a
               * leaflet. Adding a fourth replaces the oldest rather than
               * failing the save three actions later.
               */
              decorations: [...page.decorations, {
                id: `img-${Date.now().toString(36)}`,
                imageUrl: url,
                subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
                offerId: null,
                anchor: 'bottom-right' as DecorAnchor,
                scale: 0.26,
                rotate: 0,
                opacity: 1,
                offsetX: 0,
                offsetY: 0,
              }].slice(-3),
            }
            : page)),
        }));
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    updatePageImage(pageId, decorId, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? {
            ...page,
            decorations: page.decorations.map((d) => (d.id === decorId ? { ...d, ...patch } : d)),
          }
          : page)),
      }), name ?? `image:${decorId}`);
    },

    removePageImage(pageId, decorId) {
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, decorations: page.decorations.filter((d) => d.id !== decorId) }
          : page)),
      }));
    },

    async addPageBackground(pageId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} bag siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({ busy: null, note: `${file.name} lagt bag siden` });
        mutate((document) => ({
          ...document,
          pages: document.pages.map((page) => (page.id === pageId
            ? {
              ...page,
              background: {
                imageUrl: url,
                subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
                fit: 'cover' as const,
                opacity: 1,
                focusX: 50,
                focusY: 50,
              },
            }
            : page)),
        }));
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    setPageBackground(pageId, patch, name) {
      if (patch === null) gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => {
          if (page.id !== pageId) return page;
          if (patch === null) return { ...page, background: null };
          // A patch with no picture to patch is a no-op, not a
          // half-built background the schema would reject on save.
          if (!page.background) return page;
          return { ...page, background: { ...page.background, ...patch } };
        }),
      }), patch === null ? undefined : name ?? `background:${pageId}`);
    },

    setPageTitle(pageId, title) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, title } : page)),
      }));
    },

    setPageSubtitle(pageId, subtitle) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, subtitle } : page)),
      }));
    },

    setPageGround(pageId, ground) {
      // Six hex digits or nothing. A half-typed "#ff" in the field must
      // not reach the document: the schema rejects it on save, and the
      // rejection would surface three actions later as "invalid
      // document" with no mention of a colour.
      const value = ground === null ? null
        : /^#[0-9a-fA-F]{6}$/.test(ground) ? ground.toLowerCase()
          : undefined;
      if (value === undefined) return;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, ground: value } : page)),
      // One gesture, one undo step: dragging a colour wheel fires on
      // every pixel, exactly like panning artwork.
      }), `ground:${pageId}`);
    },

    setLibraryOpen: (open) => set({ libraryOpen: open }),
    setLibrarySearch: (query) => set({ librarySearch: query }),

    toggleLibraryPick(offerId) {
      const picked = get().librarySelection;
      set({
        librarySelection: picked.includes(offerId)
          ? picked.filter((id) => id !== offerId)
          // Appended rather than prepended: the order of ticking is the
          // order the products are dealt into the page's free cells.
          : [...picked, offerId],
      });
    },

    clearLibraryPicks: () => set({ librarySelection: [] }),

    setArrangeNote: (note) => set({ arrangeNote: note }),

    toggleLibraryGroup(name) {
      const closed = get().libraryClosedGroups;
      set({
        libraryClosedGroups: closed.includes(name)
          ? closed.filter((other) => other !== name)
          : [...closed, name],
      });
    },

    setActivePage: (pageId) => set({ activePageId: pageId }),

    addOffersToPage(pageId, offerIds) {
      const { brand, document, feedOffers } = get();
      if (!brand || !document) return;
      const page = document.pages.find((p) => p.id === pageId);
      if (!page || page.kind !== 'offers') return;

      const onPage = new Set(page.placements.map((placement) => placement.offerId));
      const wanted = [...new Set(offerIds)].filter((id) => !onPage.has(id));
      if (wanted.length === 0) return;

      /*
       * A product picked out of the library may not be in the document
       * yet — the library also lists what is merely in the feed. It is
       * copied in here, because a document embeds the offers it prints:
       * a catalogue that could only be re-rendered while this week's
       * file was still open would not be reproducible.
       */
      const known = new Map(document.offers.map((offer) => [offer.id, offer]));
      const library = new Map(feedOffers.map((offer) => [offer.id, offer]));
      const missing = wanted.filter((id) => !known.has(id) && !library.has(id));
      if (missing.length > 0) {
        set({ error: `${count(missing.length, 'vare', 'varer')} findes hverken i avisen eller i feedet` });
        return;
      }
      const incoming = wanted
        .filter((id) => !known.has(id))
        .map((id) => library.get(id)!);

      const current = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      if (!current) return;

      const open = freeSlots(page, current).map((slot) => slot.id);
      const needed = page.placements.length + wanted.length;

      let templateId = page.templateId;
      let templates = document.templates;
      let placements = page.placements;
      let seats = open;

      if (open.length < wanted.length) {
        /*
         * A shape somebody drew beats a shape we grew, every time — so
         * the chain's own set is asked first, and only a page whose
         * layout is already the chain's may move within it. A page read
         * off a printed sheet has a grid describing that sheet; swapping
         * it for a brand layout would throw away the very thing the
         * import was for.
         *
         * Asked of the DOCUMENT, not of the brand. `state.brand` carries
         * the document's own layouts folded in — that is what makes them
         * renderable and re-seatable — so `resolveTemplate` answers yes
         * for both kinds and cannot tell them apart. The document's list
         * can: a template in it is one that travelled with these pages
         * and belongs to them.
         */
        const ownLayout = document.templates.some((t) => t.id === page.templateId);
        const designed = ownLayout ? undefined : templatesForCount(brand, needed)[0];

        if (designed) {
          const slots = slotAssignmentOrder(designed);
          placements = reseat(page, brand, designed);
          templateId = designed.id;
          seats = slots.slice(placements.length).map((slot) => slot.id);
        } else {
          const grown = growTemplate(
            current, wanted.length - open.length, grownId(pageId, needed),
          );
          if (!grown) {
            set({ error: 'siden kan ikke bære flere varer — læg dem på en ny side' });
            return;
          }
          templateId = grown.template.id;
          templates = [
            ...document.templates.filter((t) => t.id !== grown.template.id),
            grown.template,
          ];
          seats = [...open, ...grown.added];
        }
      }

      gesture = null;
      mutate((doc) => ({
        ...doc,
        offers: [...doc.offers, ...incoming],
        templates,
        pages: doc.pages.map((p) => (p.id === pageId ? {
          ...p,
          templateId,
          placements: [
            ...placements,
            ...wanted.map((offerId, index) => ({
              offerId,
              slotId: seats[index]!,
              overrides: FRESH,
            })).filter((placement) => placement.slotId),
          ],
        } : p)),
      }));

      set({
        librarySelection: get().librarySelection.filter((id) => !wanted.includes(id)),
        note: `${count(wanted.length, 'vare', 'varer')} lagt på siden`,
        error: null,
      });
    },

    removeOfferFromPage(pageId, offerId) {
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? {
          ...page,
          placements: page.placements.filter((placement) => placement.offerId !== offerId),
        } : page)),
      }));
      if (get().selectedOfferId === offerId) {
        set({ selectedOfferId: null, selectedPart: null, selectedPack: null });
      }
    },

    async fillSlot(pageId, slotId, offerIds, options = {}) {
      const { brand, document, feedOffers } = get();
      if (!brand || !document) return;
      const page = document.pages.find((p) => p.id === pageId);
      if (!page || page.kind !== 'offers') return;

      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      const slot = template?.slots.find((entry) => entry.id === slotId);
      if (!template || !slot) return;

      /*
       * Looked up in the document first and in the week's file second,
       * because a product picked out of the library may be either: what
       * is already in the catalogue, or what is merely in the feed.
       */
      const known = new Map([
        ...document.offers.map((offer) => [offer.id, offer] as const),
        ...feedOffers.map((offer) => [offer.id, offer] as const),
      ]);
      const picked = [...new Set(offerIds)]
        .map((id) => known.get(id))
        .filter((offer): offer is Offer => Boolean(offer));
      if (picked.length === 0) return;
      if (picked.length > 8) {
        set({ error: 'en plads kan bære otte varer — vælg færre' });
        return;
      }

      /*
       * How they sit together is asked, not assumed.
       *
       * The stylesheet's own rule draws the arrangement from the
       * offer's id: stable between renders, varied across a page, and
       * blind to what the products actually look like. That is the
       * right default for a tile nobody chose and a poor answer for one
       * an editor has just assembled — six upright bottles fan and six
       * flat trays do not, and the difference is in the photographs.
       *
       * So the model is shown the packshots and answers with an order,
       * one of four arrangement names and the two lines of Danish the
       * tile prints. It never returns geometry: the cell is where it
       * was and the stylesheet still draws the page.
       *
       * One product needs none of this, and a failure costs nothing —
       * `arrangeGroup` answers with the stylesheet's own choice and
       * says so with `model: null`.
       */
      const cell = slotCells(template, brand.pageAspect).get(slotId);
      let seated = picked;
      let arrangement: TileArrangement | null = null;
      let wording: { heading: string; support: string } | null = null;
      let by: string | null = null;

      if (picked.length > 1 && get().brandId) {
        set({ busy: 'Modellen sætter varerne sammen…', error: null, note: null });
        try {
          const said = await api.arrangeGroup(get().brandId!, {
            offers: picked,
            cell: {
              role: slot.role,
              aspect: cell?.aspect ?? 1,
              width: cell?.width ?? 0.5,
            },
            ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
          });
          const order = new Map(said.order.map((id, index) => [id, index]));
          seated = [...picked].sort(
            (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
          );
          arrangement = said.arrangement;
          by = said.model;
          if (said.heading) wording = { heading: said.heading, support: said.support };
        } catch (error) {
          // The drop lands anyway. A tile that could not be assembled
          // because an API was unreachable is a worse product than one
          // that assembles it the plain way and says so.
          set({ error: `varerne blev sat sammen uden model: ${message(error)}` });
        }
        set({ busy: null });
      }

      /*
       * Named after the cell it fills, so filling the same cell twice
       * replaces the tile rather than leaving the first one behind in
       * the document. It is also what keeps the cluster's arrangement
       * steady between renders when no model chose one — `packStyle`
       * draws it from the id.
       */
      let assembled = seated.length === 1
        ? seated[0]!
        : groupOffers(seated, `group/${pageId}/${slotId}`);

      /*
       * One photograph instead of a row of cutouts.
       *
       * The image model is handed the cutouts and asked to photograph
       * them standing together — shared floor, one hero in front, the
       * rest overlapping at the edges. What comes back replaces the
       * pack: the tile draws one picture, exactly as it does for a
       * published "frit valg" tile, whose photograph is also one image
       * of several products.
       *
       * `members` survives it, so the document still says what the
       * price covers even though the page no longer shows them apart.
       * The cost is stated where the button is: a composed tile cannot
       * be edited product by product.
       */
      if (options.compose && seated.length > 1) {
        set({ busy: 'Billedmodellen sætter varerne op…', error: null, note: null });
        try {
          const drawn = await api.composeCluster(get().brandId!, {
            offers: seated,
            ...(cell?.aspect ? { aspect: cell.aspect } : {}),
            ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
          });
          assembled = { ...assembled, imageUrl: drawn.url, imagePack: [] };
          by = drawn.model;
        } catch (error) {
          set({ busy: null, error: message(error) });
          return;
        }
        set({ busy: null });
      }

      const overrides: PlacementOverrides = {
        ...FRESH,
        arrangement,
        // Written onto the PLACEMENT rather than into the offer, the
        // same way every other hand correction is: the assembled record
        // keeps the feed's own facts, and the page keeps what somebody
        // decided to print. Rewriting either survives the other.
        displayName: wording?.heading ?? null,
        description: wording?.support ?? null,
      };

      gesture = null;
      mutate((doc) => ({
        ...doc,
        /*
         * The members travel with the document as well as the group.
         *
         * They are what the tile is showing, and a catalogue that
         * carried only the assembled record could not say what the
         * price covers once this week's file was gone. `benched` knows
         * they are on the page — see the note there.
         *
         * The group itself is rewritten rather than appended: filling
         * the same cell twice replaces its tile, and two offers under
         * one id is how a placement ends up pointing at last week's.
         */
        offers: [
          ...doc.offers.filter((offer) => offer.id !== assembled.id),
          ...seated.filter((member) => member.id !== assembled.id
            && !doc.offers.some((offer) => offer.id === member.id)),
          assembled,
        ],
        pages: doc.pages.map((p) => (p.id === pageId ? {
          ...p,
          placements: [
            // Whatever stood here goes to the bench: it stays in the
            // document, it is simply no longer on a page.
            ...p.placements.filter((placement) => placement.slotId !== slotId),
            { offerId: assembled.id, slotId, overrides },
          ],
        } : p)),
      }));

      set({
        librarySelection: [],
        selectedOfferId: assembled.id,
        selectedPart: null,
        selectedPack: null,
        note: seated.length === 1
          ? 'Varen lagt i pladsen'
          : [
            `${count(seated.length, 'vare', 'varer')} samlet i én plads`,
            options.compose ? 'som ét fotografi' : '',
            by ? `sat op af ${by}` : 'sat op uden model',
          ].filter(Boolean).join(' · '),
      });
    },

    pageSlots(pageId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      if (!brand || !document || !page || page.kind !== 'offers') return [];
      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      if (!template) return [];

      const names = new Map(document.offers.map((offer) => [offer.id, offer.name]));
      // Reading order, which is the order the cells are drawn in — a
      // picker numbered by the template's declaration order would count
      // differently from the page in front of the person using it.
      return slotAssignmentOrder(template).map((slot, index) => {
        const sitting = page.placements.find((placement) => placement.slotId === slot.id);
        const name = sitting ? names.get(sitting.offerId) ?? sitting.offerId : 'tom';
        return { slotId: slot.id, label: `${index + 1} · ${name.slice(0, 28)}` };
      });
    },

    setPublicationUrl: (url) => set({ publicationUrl: url }),
    setPublicationPages: (spec) => set({ publicationPages: spec }),
    setPublicationAppend: (append) => set({ publicationAppend: append }),
    setPublicationWithOffers: (withOffers) => set({ publicationWithOffers: withOffers }),

    async importPublication() {
      const { brandId, publicationUrl, publicationPages, publicationAppend } = get();
      if (!brandId || !publicationUrl.trim()) return;

      set({ busy: 'Henter udgivelsen…', error: null, note: null });
      try {
        const pages = pageNumbers(publicationPages);
        const reply = await api.importPublication(brandId, {
          url: publicationUrl.trim(),
          withOffers: get().publicationWithOffers,
          ...(pages.length > 0 ? { pages } : {}),
        });

        /*
         * Appending keeps the open catalogue's id and name, exactly as
         * a rebuild does: adding six pages to an avis is the same avis.
         */
        const base = publicationAppend ? get().document : null;
        const document = base
          ? mergeCatalogDocuments([base, reply.document], { id: base.id, name: base.name })
          : reply.document;

        const read = reply.readings.filter((reading) => !reading.skipped).length;
        const skipped = reply.readings.length - read;

        set({
          document,
          brand: get().brand ? withTemplates(get().brand!, document.templates) : get().brand,
          // The pages arrived whole; there is nothing to compare them
          // against, so the reproduction strip stays as it was.
          past: [],
          future: [],
          activePageId: document.pages[0]?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          busy: null,
          note: [
            `${count(read, 'side', 'sider')} hentet fra udgivelsen`,
            skipped > 0 ? `${skipped} uden gitter` : '',
            `${document.offers.length} varer`,
            'ingen modelkald',
          ].filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    setLayoutCells: (cells) => set({ layoutCells: cells }),
    setLayoutNote: (note) => set({ layoutNote: note }),
    setLayoutAppend: (append) => set({ layoutAppend: append }),

    async generateLayout() {
      const { brandId, feed, layoutCells, layoutNote, layoutAppend } = get();
      if (!brandId || !feed) return;

      const base = layoutAppend ? get().document : null;
      const spent = base ? base.offers.map((offer) => offer.id) : [];

      set({ busy: 'Gemini tegner et layout…', error: null, note: null });
      try {
        const reply = await api.generateLayout(brandId, {
          feed: feed.text,
          cells: layoutCells,
          ...(layoutNote.trim() ? { note: layoutNote.trim() } : {}),
          ...(spent.length > 0 ? { exclude: spent } : {}),
        });

        const document = base
          ? mergeCatalogDocuments([base, reply.document], { id: base.id, name: base.name })
          : reply.document;
        const landed = document.pages[document.pages.length - 1];

        /*
         * Kept in the reproduction strip like any other rebuilt page.
         *
         * What is shown there is the DRAWING, which never reaches the
         * sheet — it is the layout the casting step read, and the only
         * way to judge whether it read it right is to see the two side
         * by side.
         */
        const run: PageRun = {
          pageId: landed?.id ?? `page-${document.pages.length}`,
          reference: reply.reference,
          referenceName: `tegnet layout · ${reply.imageModel}`,
          template: reply.template,
          ground: reply.ground,
          grid: reply.grid,
          casting: reply.casting,
          source: reply.source,
          offersInFeed: reply.offersInFeed,
          poolSize: reply.poolSize,
          rejected: reply.rejected,
          usage: reply.usage,
          elapsedMs: reply.elapsedMs,
        };

        set({
          document,
          brand: withTemplates(reply.brand, document.templates),
          reproductions: base ? [...get().reproductions, run] : [run],
          past: [],
          future: [],
          activePageId: landed?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          layoutAppend: true,
          busy: null,
          note: [
            'Layout tegnet og fyldt',
            `${(reply.drawnInMs / 1000).toFixed(0)}s tegning`,
            `${(reply.elapsedMs / 1000).toFixed(0)}s casting`,
            reply.rejected > 0 ? `${reply.rejected} plads(er) tomme` : '',
          ].filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    benched() {
      const { document } = get();
      if (!document) return [];
      const placed = new Set(document.pages.flatMap((p) => p.placements).map((p) => p.offerId));
      /*
       * A product inside a placed group is ON the page, even though no
       * placement names it: the tile shows its photograph and the price
       * covers it. Counting it as bench would tell the editor there are
       * six spare products waiting when in fact they are printed.
       */
      const shown = new Set(document.offers
        .filter((offer) => placed.has(offer.id))
        .flatMap((offer) => offer.members));
      return document.offers.filter(
        (offer) => !placed.has(offer.id) && !shown.has(offer.id),
      );
    },

    setPageTemplate(pageId, templateId) {
      const { brand } = get();
      const next = brand ? resolveTemplate(brand, templateId) : null;
      if (!brand || !next) return;
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, templateId: next.id, placements: reseat(page, brand, next) }
          : page)),
      }));
    },

    /*
     * The next layout at this page's own offer count, wrapping round.
     *
     * A button rather than a menu because the question it answers is
     * "show me another one", not "I want that specific one" — and with
     * two to four shapes per count, cycling is faster than reading a
     * list. The menu is still there for when it is the other question.
     */
    shufflePage(pageId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      if (!brand || !page) return;
      const options = templatesForCount(brand, page.placements.length);
      if (options.length < 2) return;
      const here = options.findIndex((t) => t.id === page.templateId);
      const next = options[(here + 1) % options.length];
      if (next) get().setPageTemplate(pageId, next.id);
    },

    setPageCount(pageId, count) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      if (!brand || !document || !page) return;

      /*
       * A layout at the new count, preferring one whose shape is
       * closest to the current page's — a six-up that becomes a
       * three-up should not also swap its hero for a flat row unless
       * the brand has nothing else.
       */
      const options = templatesForCount(brand, count);
      const here = resolveTemplate(brand, page.templateId);
      const next = options.find((t) => t.slots[0]?.role === here?.slots[0]?.role) ?? options[0];
      if (!next) return;

      const bench = get().benched();
      // Strongest first, so dropping takes from the bottom of the page
      // and adding fills the weakest slots.
      const ordered = seatOrder(page, brand);
      const offers = ordered.slice(0, count).map((p) => p.offerId);
      for (const offer of bench) {
        if (offers.length >= count) break;
        offers.push(offer.id);
      }
      if (offers.length === 0) return;

      gesture = null;
      const kept = new Map(page.placements.map((p) => [p.offerId, p]));
      const slots = slotAssignmentOrder(next).slice(0, offers.length);

      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((p) => (p.id === pageId ? {
          ...p,
          templateId: next.id,
          placements: slots.map((slot, index) => {
            const offerId = offers[index]!;
            const before = kept.get(offerId);
            // An offer coming off the bench has no corrections yet;
            // one that was already here keeps the ones it has.
            return before
              ? { ...before, slotId: slot.id }
              : { offerId, slotId: slot.id, overrides: FRESH };
          }),
        } : p)),
      }));
    },

    focusOffer(pageId, offerId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      const template = brand && page ? resolveTemplate(brand, page.templateId) : null;
      if (!page || !template) return;

      const lead = slotAssignmentOrder(template)[0];
      const here = page.placements.find((p) => p.offerId === offerId);
      if (!lead || !here || here.slotId === lead.id) return;

      gesture = null;
      /*
       * A swap, not an insert: the offer that was leading takes the
       * promoted one's old slot. Anything else would either drop an
       * offer off the page or leave two placements on one slot.
       */
      get().swapPlacements(
        { pageId, slotId: here.slotId },
        { pageId, slotId: lead.id },
      );
    },

    undo() {
      // A history move ends whatever was open; otherwise the next
      // pointer move would coalesce into the restored document.
      gesture = null;
      const { past, future, document } = get();
      const previous = past[past.length - 1];
      if (!previous || !document) return;
      set({ past: past.slice(0, -1), document: previous, future: [document, ...future] });
    },

    redo() {
      gesture = null;
      const { past, future, document } = get();
      const next = future[0];
      if (!next || !document) return;
      set({ past: [...past, document], document: next, future: future.slice(1) });
    },
  };
});
