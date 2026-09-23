import { create } from 'zustand';
import type {
  Brand, CatalogDocument, CatalogWeek, DecorAnchor, Offer, PageBackground, PageDecoration, PageNote,
  PagePart, PageTemplate, PageTextOverride,
  FrameLine, PackOverride, Placement, PartOverride, PlacementOverrides, SlotRole, TemplateSlot, TileArrangement, TilePart,
} from '@incitio/schema';
import {
  CatalogDocument as CatalogDocumentSchema,
  CatalogPage, mergeCatalogDocuments, pageTextLimits, pageTextOverride, pageTextPatch,
  packLimits, packOverride, packPatch,
  partLimits, partOverride, partPatch, slotAssignmentOrder, slotCells,
} from '@incitio/schema';
import { groupOffers, notOnePhotograph, readPackSize } from '@incitio/schema';
import { nextWeek, weekName, weekOf } from '@incitio/schema';
import { bySeverity, measureFindings, readFindings, type Finding } from './findings.js';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import { packStyle } from '@incitio/renderer';
import { freeSlots, growTemplate, grownId } from './grid.js';
import * as api from './api.js';
import { countPages } from './pdf.js';
import {
  PACK_LIMITS, planCluster,
  type Complaint, type GhostFrame, type MeasuredProduct, type PackPatch, type PlacedProduct,
} from './cluster-layout.js';
import { inkOf, onWhite, WHOLE, type InkBox } from './ink.js';
import { pool } from './pool.js';
import { MOTIF_SUBJECT, measurePage, motifDecoration } from './backdropMeasure.js';
import { chooseBackdrop, measureBackdrop } from './backdrop.js';
import { placePrompt, type PlacePromptId } from '@incitio/curator/place-prompt';

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
 * The week the studio is working on, kept across reloads.
 *
 * Asked once — see `askWeek` — and then it is simply the answer. A
 * studio that asked again after every reload would be the same
 * question fifteen times, which is how "Hentet udgivelse" happened in
 * the first place.
 */
const WEEK_KEY = 'incitio.week';

function rememberedWeek(): CatalogWeek | null {
  try {
    const raw = window.localStorage.getItem(WEEK_KEY);
    if (!raw) return null;
    const said = JSON.parse(raw) as { year?: unknown; week?: unknown };
    if (typeof said.year !== 'number' || typeof said.week !== 'number') return null;
    return { year: said.year, week: said.week };
  } catch {
    return null;
  }
}

/**
 * The week to suggest when nobody has said.
 *
 * Next week, not this one: a leaflet is made before it runs, and by
 * the time anyone opens the studio on Monday the week on the shelf is
 * already printed. Being one click from right beats being right on
 * Sunday afternoon.
 */
export function suggestedWeek(now = new Date()): CatalogWeek {
  return nextWeek(weekOf(now));
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

/** The three things that used to be strips above the page. */
export type PanelKey = 'trin' | 'stemning' | 'sider';

/**
 * Which of the two screens is showing.
 *
 * `bog` is the whole avis as printed spreads — where you land, where
 * problems are marked on the page they belong to, and where pages are
 * reordered by dragging. `side` is one sheet, large, with the tray
 * still docked so filling an empty cell is the same gesture it was on
 * the overview.
 *
 * The editor had only the second view before, as one long column of
 * sheets: to see whether the book worked you scrolled, and to compare
 * page three with page four you could not.
 */
export type StudioView = 'bog' | 'side';

/** Spreads, the way it prints — or one page at a time. */
export type BookView = 'opslag' | 'sider';

export interface StudioState {
  brands: api.BrandSummary[];
  brandId: string | null;
  brand: Brand | null;
  /** The formats this chain delivers; the first is the default. */
  sources: api.BrandSource[];
  feed: { text: string; source: string } | null;
  document: CatalogDocument | null;
  /**
   * Which week is being made.
   *
   * The question the studio never asked, and the reason fifteen saved
   * catalogues were all called the same thing. Everything downstream
   * is derived from it: the name, the validity dates, which offers in
   * the feed are even candidates, and the line on screen that says
   * "gælder 21.–27. september".
   *
   * Session state rather than document state — the document carries
   * its own `week`, which is the durable copy. This is "the week I am
   * working on", and opening last week's avis moves it.
   */
  week: CatalogWeek | null;
  setWeek: (week: CatalogWeek) => void;
  /**
   * The work waiting on an answer.
   *
   * Set when somebody asks for pages before saying which week: the
   * request is held, the question is asked once, and the same request
   * runs the moment it is answered. A gate and not a nag — once the
   * week is known this is never set again.
   */
  askWeek: { then: () => void } | null;
  closeAskWeek: () => void;
  /** Whether the library hides offers that do not run in the week. */
  weekOnly: boolean;
  setWeekOnly: (only: boolean) => void;
  /**
   * What is missing, as a list somebody can work through.
   *
   * Kept in the store rather than in the panel, because the toolbar
   * shows the count and the panel shows the lines, and two components
   * measuring the same pages separately is two answers.
   */
  /**
   * Which fold-out panel is open, if any.
   *
   * These three used to be permanent strips stacked between the
   * toolbar and the first sheet — a step indicator, the mood-artwork
   * controls and the two other ways into a page. Folded away they
   * still cost a hundred pixels of chrome above the thing the whole
   * screen is for, every session, including the ones that never touch
   * any of them.
   *
   * So they are buttons now, and what they open lies OVER the canvas
   * rather than pushing it down. One at a time: two of these open at
   * once is the stack again, and nothing in any of them needs another
   * one on screen.
   *
   * Not remembered across reloads, unlike the folds they replace. A
   * panel that reopens itself on every reload is the strip it was
   * meant to remove.
   */
  panel: PanelKey | null;
  /** Which screen: the whole avis, or one page of it. */
  view: StudioView;
  /** The page `view: 'side'` is showing. */
  openPageId: string | null;
  /** Open a page, or go back to the book with null. */
  openPage: (pageId: string | null) => void;
  /**
   * The page the canvas should scroll to, once. Set by `openPage` and
   * the stepper; cleared by the canvas when it has scrolled there.
   */
  scrollToPageId: string | null;
  clearScrollTo: () => void;
  /**
   * The page scrolled into view — the header follows it, but nothing
   * scrolls, because the person already did.
   */
  seePage: (pageId: string) => void;
  /** Step to the page before or after the open one. */
  stepPage: (delta: number) => void;
  /** Spreads or singles, in the book view. */
  bookView: BookView;
  setBookView: (bookView: BookView) => void;
  /** Whether the four ways into a page are showing. */
  addPagesOpen: boolean;
  setAddPagesOpen: (open: boolean) => void;
  /** The category the tray is filtered to, or null for all of them. */
  trayFilter: string | null;
  setTrayFilter: (category: string | null) => void;
  /** When the open avis was last saved, for the header's quiet line. */
  savedAt: string | null;
  /** Open it, or close it if it is the one already open. */
  togglePanel: (panel: PanelKey) => void;
  closePanel: () => void;
  /**
   * The tiles an arrangement is running on right now.
   *
   * Offer ids, and its own field rather than a second meaning for
   * `busy`: putting products in a cell is instant and free — the
   * arrangement that follows is a model call, and blocking the whole
   * studio behind it made the fast half feel as slow as the slow one.
   * The tile says it is working; everything else stays usable.
   */
  standingUp: string[];
  findings: Finding[];
  /** Whether the list is showing. Remembered: it is a habit, not a step. */
  findingsOpen: boolean;
  setFindingsOpen: (open: boolean) => void;
  /** Re-read the document and re-measure the rendered pages. */
  refreshFindings: () => void;
  /** Go and stand at the tile a finding is about. */
  goToFinding: (finding: Finding) => void;
  /** Select a product where it sits, and scroll the sheet to it. */
  goToOffer: (offerId: string) => void;
  /**
   * This chain's saved catalogues, newest first.
   *
   * Kept in state so the toolbar can offer yesterday's work without a
   * round trip on every render. Refreshed whenever something is saved,
   * which is the only thing that changes it.
   */
  catalogues: api.CatalogSummary[];

  curationReady: boolean;
  /**
   * Whether anything can draw: the server's own key, or the editor's.
   *
   * Every button that spends the image model reads this one flag, so
   * it has to mean "a key will be sent", not "the server has one in
   * its environment" — `serverKey` is that narrower fact.
   */
  decorReady: boolean;
  /** Whether the SERVER holds a GEMINI_API_KEY of its own. */
  serverKey: boolean;
  /**
   * The last four characters of the key kept in this browser, or ''.
   *
   * Never the key itself. Nothing in the studio needs to read it back
   * — `api` puts it in the header — and it is shown only so a person
   * can see WHICH key is in without it being readable over a shoulder.
   */
  imageKeyTail: string;
  /** The image model that will be billed, named on screen beside the button. */
  decorModel: string;
  /**
   * How a cluster is stood up: by asking for numbers, or by drawing.
   *
   * Two ways to the same answer, and the difference is what is paid
   * for. `koordinater` shows one vision model the cutouts and asks
   * where each should stand — one call, no image model, nothing behind
   * a Google billing account. `rundtur` pays an image model to
   * photograph the products standing together and a second model to
   * measure that photograph; it composes like a photographer and costs
   * several times as much.
   *
   * Remembered, because it is a standing preference about money rather
   * than a decision about this tile.
   */
  clusterWay: ClusterWay;
  setClusterWay: (way: ClusterWay) => void;
  /**
   * Which image model the round trip draws with.
   *
   * Empty means the server's own default. The choice is a price — see
   * the note on the route's `model` field.
   */
  clusterImageModel: string;
  setClusterImageModel: (model: string) => void;
  /**
   * Which vision model decides the arrangement.
   *
   * Empty means the server's own default. Measured on a three-product
   * tile: both of the two below answer in about thirteen seconds, and
   * the stronger one puts the hero centre-front where the quicker one
   * fans all three. The choice is real, so it is the editor's.
   */
  clusterPlaceModel: string;
  setClusterPlaceModel: (model: string) => void;
  /**
   * Whether the named model is the only one allowed to answer.
   *
   * On by default in the studio, and off on the API, and the split is
   * deliberate. A batch nobody is watching is better served by an
   * answer from the next model than by no answer; somebody sitting in
   * front of one tile judging a model is not served by it at all.
   * Measured: two runs asking for `gemini-3.8-flash` came back in 49 s
   * and 67 s and both were answered by `gemini-3.5-flash-lite`, so the
   * model being judged had not run once.
   */
  placeStrict: boolean;
  setPlaceStrict: (strict: boolean) => void;
  /**
   * The editor's own version of the placement prompt, or '' for the
   * standing one.
   *
   * Kept in the browser and sent with the call. The prompt is where
   * this feature's quality actually lives — one line about relative
   * sizes is worth more than any amount of code around it — so it
   * belongs in front of the person looking at the tile, not only in
   * the repository.
   */
  clusterPrompt: string;
  setClusterPrompt: (prompt: string) => void;
  /**
   * Which of the standing prompts a run is sent with.
   *
   * Two ways of saying the same craft — see `PLACE_PROMPTS` — and
   * which one produces the better tile is a question only a tile can
   * answer. So it is a switch and not a decision taken once in the
   * repository, and choosing the other one cannot lose the first.
   *
   * `clusterPrompt` still beats both: what somebody typed into the box
   * is theirs, and a picker that silently overwrote it would be the
   * opposite of what the box is for.
   */
  clusterPromptId: PlacePromptId;
  setClusterPromptId: (id: PlacePromptId) => void;
  /** The last few runs, newest first — see `PromptRun`. */
  promptRuns: PromptRun[];
  /**
   * What the last run actually did, for the panel.
   *
   * Not a log and not a toast: the one thing an editor asks after
   * pressing the button is "did it place them all, what did it cost,
   * and how long did it take" — and until now the answer was a
   * sentence that scrolled away.
   */
  clusterRun: ClusterRun | null;
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
  /** The free text on a page that is in hand — see `PageNote`. */
  selectedNoteId: string | null;
  /** The page whose cells are being dragged to size, if any. */
  layoutEditPageId: string | null;
  setLayoutEdit: (pageId: string | null) => void;
  /**
   * Give a page a layout of its own, with every cell in a box of its own
   * — the boxes measured off the page as it is drawn, so nothing moves
   * when editing begins. A layout the chain owns is copied, never
   * changed: other pages and other weeks use it.
   */
  ownLayout: (pageId: string, rects: Record<string, { x: number; y: number; w: number; h: number }>) => void;
  setCellRect: (pageId: string, slotId: string, rect: { x: number; y: number; w: number; h: number }, gesture?: string) => void;
  /** A new empty cell on the page, where there is room. */
  addCell: (pageId: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** Take a cell off the page; its product goes to the reserve. */
  removeCell: (pageId: string, slotId: string) => void;
  /**
   * Give a crowded cell the room of an empty neighbour: the two boxes
   * become one and the empty cell goes. Needs the page's cells in boxes
   * — see `ownLayout`, which the caller runs first.
   */
  mergeCells: (pageId: string, slotId: string, emptyId: string) => void;
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
  /**
   * Keep an image-model key in this browser, or forget it with ''.
   *
   * The key never reaches the repo, the document or the server's disk:
   * it sits in this browser's own storage and rides along as a header
   * on the requests that draw. For the ordinary case where the person
   * with the key is not the person who started the server.
   */
  setImageKey: (key: string) => void;
  /**
   * Draw mood artwork. The motif is chosen from each page's own
   * products by a text model — nobody has to write a prompt. Pass page
   * ids to draw only those.
   */
  decorate: (pageIds?: string[]) => Promise<void>;
  /**
   * Paint each page's background picture — the page's own colour, a
   * motif around the products and the words — and lay it under the
   * whole sheet. Measured off the page as drawn, so the pages must be
   * open. One undo for the lot.
   */
  drawBackdrops: (pageIds: string[]) => Promise<void>;

  setLibraryOpen: (open: boolean) => void;
  setLibrarySearch: (query: string) => void;
  /**
   * Where each product already is, keyed by offer id — "s. 2".
   *
   * Every product any page shows, INCLUDING the ones inside a placed
   * cluster: a tile that photographs six cheeses is showing all six,
   * and a library that offered them again would deal the same cheese
   * onto two pages. Derived, never stored.
   */
  placedAt: () => Map<string, string>;
  /**
   * Tick or untick one product. Always a toggle; the list is a basket.
   *
   * A product that already has a place in the avis cannot be ticked.
   * Two cells printing the same product is not an edit anybody makes
   * on purpose, and the way to move one is to take it off the page it
   * is on — which is what the card's own page number is for.
   */
  toggleLibraryPick: (offerId: string) => void;
  clearLibraryPicks: () => void;
  /** Fold one group of the library away, or open it again. */
  toggleLibraryGroup: (name: string) => void;
  /**
   * The chain's own pictures — balloons, flags, a paper texture.
   *
   * Uploaded by whoever makes this chain's avis and kept for the next
   * one. Not brand data: nothing here is the chain's IDENTITY in the
   * sense `CatalogDocument` refuses to copy, it is a drawer of files
   * somebody put there, scoped to the chain that put them there.
   */
  uploads: api.LibraryImage[];
  /** Which drawer the left panel is showing. */
  drawer: 'varer' | 'billeder';
  setDrawer: (drawer: 'varer' | 'billeder') => void;
  refreshUploads: () => Promise<void>;
  /** Put a file in the drawer without putting it on a page. */
  addToLibrary: (file: File) => Promise<void>;
  /** Take one out of the drawer. The file stays; pages keep printing it. */
  removeFromLibrary: (ref: string) => Promise<void>;
  /**
   * Put a picture from the drawer on a page.
   *
   * `hvor` is chosen before the click, not after: a background and a
   * picture lying on the sheet are two different things — one is under
   * everything and fills the page, the other is pinned in a corner at
   * a quarter of its width — and a control that landed the file and
   * then asked would be asking too late.
   */
  placeFromLibrary: (pageId: string, ref: string, hvor: 'baggrund' | 'på siden') => void;
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
      /**
       * Ask the model how they should sit, before anything is drawn.
       *
       * On by default, and right for a drop that ENDS here: the
       * stylesheet's own arrangement is drawn from the offer's id and
       * is blind to what the products look like, so a tile nobody
       * touches afterwards is better for having been looked at.
       *
       * Off for `composeSlot`, where a placement call decides every
       * position a moment later. There the arrangement is overwritten
       * before anybody sees it, and waiting fifteen seconds for an
       * answer that is about to be replaced is fifteen seconds of
       * spinner for nothing.
       */
      arrange?: boolean;
    },
  ) => Promise<void>;
  /**
   * The whole cluster job in one press.
   *
   * Put the chosen products in the cell, let the image model photograph
   * them standing together, read that photograph as a layout, and move
   * the chain's OWN cutouts to match. Four steps that used to be four
   * decisions — group, fetch, compose, drop — and were never anything
   * but one intention.
   *
   * What prints is still the chain's artwork: the composition is read
   * for its geometry and kept only as the proof laid over the tile, so
   * no label is ever a redrawn one. And because the cutouts are what
   * stands there, every product can still be moved by hand afterwards.
   */
  composeSlot: (pageId: string, slotId: string, offerIds: string[]) => Promise<void>;
  /**
   * A cluster to look at, from nothing, in one press.
   *
   * Every test of this feature starts the same way: build a draft,
   * open the library, find three products that have photographs, drop
   * them in a cell, run the arrangement. Five steps, none of them the
   * thing being tested. This does all five — and nothing else, so what
   * comes out is comparable between runs: the first products in the
   * feed that carry a picture, in the page's first cell.
   */
  testCluster: () => Promise<void>;
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
  /** Take a note in hand, or put it down. */
  selectNote: (noteId: string | null) => void;
  /** Lay a new note on a page, in the middle, and take it in hand. */
  addNote: (pageId: string) => void;
  updateNote: (pageId: string, noteId: string, patch: Partial<PageNote>, gesture?: string) => void;
  removeNote: (pageId: string, noteId: string) => void;
  selectPart: (part: TilePart | null) => void;
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
  /** Draw one cluster's composed picture over it, or take it back off. */
  toggleGhost: (offerId: string) => void;
  /**
   * Stand every cluster on a sheet up, in the studio.
   *
   * Gemini decides each arrangement — as numbers, or by drawing a
   * photograph that is then measured — and the chain's own cutouts
   * are moved to match. Nothing the model drew reaches the page. One
   * write, one undo step.
   */
  standUpClusters: (pageId: string) => Promise<void>;
  /**
   * The same, for every sheet in the book at once.
   *
   * The reason it is a separate button and not a checkbox: an editor
   * who has settled the layout wants the whole publication composed
   * while they do something else, and the run is long enough that
   * being asked about it a page at a time is the actual cost. The
   * tiles are composed a few at a time — see `CLUSTER_AT_ONCE` — and
   * written once, so the whole book is one undo step.
   */
  standUpAllClusters: () => Promise<void>;
  /**
   * Stand ONE tile up, the way the panel is set to.
   *
   * The same engine as the page and the book — see `standUpClusters` —
   * pointed at a single cluster, because the inspector is where
   * somebody iterates on one tile: try the cheap way, look, try the
   * round trip, look again.
   */
  standUpOneCluster: (offerId: string) => Promise<void>;
  /**
   * One packshot of several variants — three bottles in one picture —
   * cut into one product per variant, then stood up like any cluster.
   * The variants become members of the offer, so nothing about its
   * price or its place on the page changes; only the artwork can now
   * be arranged product by product.
   */
  splitAndStandUp: (offerId: string) => Promise<void>;
  /**
   * Put one picture on a tile as its whole artwork.
   *
   * For a designer with a photograph of their own: a
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
  /**
   * Put this page's backdrop under other pages too.
   *
   * The thing that makes a background a page setting rather than a
   * chore: an avis has one look, and setting it a page at a time is a
   * file picker, four sliders and a scroll, six times over. Copies the
   * whole record — the picture AND what was decided about it — so the
   * other pages get the fit and the strength that were tuned here.
   *
   * Never onto an image page: there `background` IS the page's own
   * artwork, and writing over it would replace the picture somebody
   * put in the book rather than decorating it.
   */
  spreadBackground: (pageId: string, reach: 'alle' | 'resten') => void;
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
  setPageCount: (pageId: string, count: number, templateId?: string) => void;
  /**
   * Put a page on one of the standard layouts — see `standardLayouts`.
   * The layout travels with the document, like any layout it uses that
   * the chain does not own.
   */
  applyLayout: (pageId: string, template: PageTemplate) => void;
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
/**
 * A variant cut out of, or taken from, one offer's pictures so the tile
 * can be stood up — see `splitAndStandUp`. It is part of that offer's
 * artwork, never a product of its own: it has no page, no reserve and no
 * place in the list.
 */
export function isVariantPiece(offerId: string): boolean {
  return /~v\d+$/.test(offerId);
}

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
 * A cutout's own proportions — the PRODUCT's, not the file's.
 *
 * A packshot arrives in a frame with margin around it, and the frame
 * is not the product: a bottle in a square JPEG would report 1:1 and
 * be placed as wide as it is tall. `inkOf` has already scanned where
 * the ink actually is, for the placement arithmetic, and this is the
 * same scan read for a different number.
 */
async function cutoutAspect(url: string): Promise<number> {
  const [ink, frame] = await Promise.all([inkOf(url), frameAspect(url)]);
  const aspect = frame * (ink.width / ink.height);
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/** The file's own width over height. */
async function frameAspect(url: string): Promise<number> {
  return new Promise((done) => {
    const probe = new Image();
    probe.onload = () => done(
      probe.naturalHeight > 0 ? probe.naturalWidth / probe.naturalHeight : 1,
    );
    probe.onerror = () => done(1);
    probe.src = url;
  });
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

/**
 * The products of one cluster, back to front.
 *
 * Read off what the arrangement actually did rather than off the
 * model's prose: a product standing lower on the page stands in
 * front, which is how a printed group reads and how `planCluster`
 * stacks them. Hidden ones are left out — they are not in the
 * photograph at all.
 */
function backToFront(stood: StoodUp, members: Offer[]): string[] {
  return [...stood.patches.entries()]
    .sort((a, b) => a[1].offsetY - b[1].offsetY)
    .map(([index]) => members[index]?.name ?? `vare ${index + 1}`);
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

/**
 * How many clusters are composed at the same time.
 *
 * Every cluster is an image-model call of half a minute or more, and
 * they have nothing to say to each other — so a sheet of six is six
 * minutes done one at a time and about a minute and a half done four
 * at a time. Four and not sixteen because each one is also a paid call
 * against a per-minute quota, and a whole book fired off in one breath
 * is how a 429 is met. Raise it when the key's quota allows.
 */
const CLUSTER_AT_ONCE = Number(
  (typeof localStorage !== 'undefined' && localStorage.getItem('incitio.clusterAtOnce')) || 4,
) || 4;

/** The two ways a cluster can be stood up — see `clusterWay`. */
export type ClusterWay = 'koordinater' | 'rundtur';

/** Remembered across reloads: it is a standing preference, not a step. */
const WAY_KEY = 'incitio.clusterWay';
const IMAGE_MODEL_KEY = 'incitio.clusterImageModel';
const PLACE_MODEL_KEY = 'incitio.clusterPlaceModel';
/** Whether a run may be answered by a model nobody asked for. */
const STRICT_KEY = 'incitio.placeStrict';
const PROMPT_KEY = 'incitio.clusterPrompt';
/** Which standing prompt is chosen. A preference, so it is remembered. */
const PROMPT_ID_KEY = 'incitio.clusterPromptId';
/** Whether the checklist is open. A habit, so it survives a reload. */
const CHECKS_KEY = 'incitio.checks.open';

function remembered<T extends string>(key: string, fallback: T): T {
  try {
    return (window.localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* private browsing; it holds for this session */ }
}

/**
 * What one run of the cluster machinery did.
 *
 * Reported rather than summarised: which way it went, which model
 * answered, how long it took, how many products it actually placed and
 * in which order they stand. Everything here is measured — nothing is
 * an estimate dressed up as a fact, and there is no price, because the
 * only honest price is the one on the bill.
 */
export interface ClusterRun {
  way: ClusterWay;
  /** The model that decided the arrangement. */
  model: string;
  /** The one that was asked for, when it was busy and another answered. */
  insteadOf: string | null;
  /** The image model, when one drew. */
  drawnBy: string | null;
  elapsedMs: number;
  tokens: number | null;
  /**
   * The two halves, kept apart.
   *
   * A price needs them: reading six cutouts is input and forty
   * numbers is output, and the two are charged at rates an order of
   * magnitude apart — so a single total cannot be turned back into
   * kroner. `tokens` stays because it is what the line says when
   * nobody cares about the money.
   */
  inputTokens: number;
  outputTokens: number;
  /** Products placed, out of how many the tile holds. */
  placed: number;
  of: number;
  /** Back to front, as they now stand. */
  order: string[];
  /** What the review complained about, if anything. */
  complaints: string[];
  /**
   * Whether the group was stood on a floor or laid out flat.
   *
   * The placing call chooses it from how the cutouts were
   * photographed — see `PLACE_SYSTEM` — and it is the one decision in
   * the answer that is not a number, so it is worth showing.
   */
  view: 'side' | 'top' | null;
}

/**
 * One run, kept so the next one can be compared with it.
 *
 * The prompt is the feature, and a prompt is improved by changing a
 * line and looking — which only works if you can still see what the
 * line before it produced. Everything here is what the panel already
 * showed and then threw away: the words that were sent, the model
 * that answered and how much of the tile it actually placed.
 *
 * The prompt is stored in full. It is a few thousand characters and
 * five of them fit in the browser's storage many times over; keeping
 * a hash would save nothing and give back nothing to restore.
 */
export interface PromptRun {
  at: string;
  /** What the tile was called, so a list of runs can be read. */
  tile: string;
  /** '' when a standing prompt was used — `promptId` says which. */
  prompt: string;
  /**
   * Which shipped prompt the run used.
   *
   * Optional, because runs kept in this browser from before there was
   * more than one carry no answer, and inventing one for them would
   * be a claim about a run nobody can check.
   */
  promptId?: PlacePromptId;
  model: string;
  elapsedMs: number;
  placed: number;
  of: number;
}

/** How many are kept. Five is two afternoons of iterating. */
const PROMPT_RUNS = 5;
const RUNS_KEY = 'incitio.promptRuns';

function rememberedRuns(): PromptRun[] {
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    const said = raw ? JSON.parse(raw) as unknown : null;
    return Array.isArray(said) ? said.slice(0, PROMPT_RUNS) as PromptRun[] : [];
  } catch {
    return [];
  }
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
/** A cell's size on the page, in shares of it, and what it is for. */
export type CellSize = { w: number; h: number; role: SlotRole };

function cellSize(brand: Brand, templates: PageTemplate[], templateId: string, slotId: string): CellSize | null {
  const template = templates.find((t) => t.id === templateId) ?? resolveTemplate(brand, templateId);
  const slot = template?.slots.find((entry) => entry.id === slotId);
  if (!template || !slot) return null;
  if (slot.rect) return { w: slot.rect.w, h: slot.rect.h, role: slot.role };
  const cell = slotCells(template, brand.pageAspect).get(slotId);
  if (!cell) return null;
  return { w: cell.width, h: (cell.width * brand.pageAspect) / cell.aspect, role: slot.role };
}

/**
 * A tile's own corrections, carried into a cell of another size.
 *
 * The products in a cluster are nudged in PAGE percent while the
 * pictures themselves grow and shrink with the cell — so a tile moved to
 * a bigger cell kept its nudges and lost its arrangement: the products
 * grew, their offsets did not, and they slid over each other. Scaling
 * the offsets by the change in the cell's size keeps every product where
 * it was relative to the tile.
 *
 * The base arrangement is pinned for the same reason. Left to itself it
 * is picked by the cell's ROLE, so a tile moved from a hero cell to an
 * ordinary one changed its whole arrangement under the nudges laid on it.
 */
export function carryOverrides(
  overrides: Placement['overrides'],
  offer: Offer | undefined,
  from: CellSize | null,
  to: CellSize | null,
): Placement['overrides'] {
  if (!from || !to || from.w <= 0 || from.h <= 0) return overrides;
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const pack = Object.fromEntries(Object.entries(overrides.pack ?? {}).map(([key, item]) => [key, {
    ...item, offsetX: clamp(item.offsetX * sx, 100), offsetY: clamp(item.offsetY * sy, 100),
  }]));
  const parts = Object.fromEntries(Object.entries(overrides.parts ?? {}).map(([key, part]) => [key, {
    ...part, offsetX: clamp(part.offsetX * sx, 25), offsetY: clamp(part.offsetY * sy, 25),
  }]));
  const touched = Object.keys(overrides.pack ?? {}).length > 0;
  const count = offer?.imagePack.length ?? 0;
  const arrangement = overrides.arrangement
    ?? (touched && offer && count > 1 ? packStyle(offer.id, count, from.role) : null);
  return { ...overrides, pack, parts, arrangement } as Placement['overrides'];
}

/**
 * A chain layout laid into a page that was read off a publication.
 *
 * Such a page has its cells in measured boxes, under the publication's
 * own headline and banner, and each cell carries the publication's own
 * design for the tile in it — where the packshot, the price mark and the
 * words sit (`TemplateSlot.frame`). Swapped for a chain layout as it
 * stands, the grid started at the top of the sheet, over the headline,
 * every tile fell back to the chain's own design, and the lead became
 * the chain's red feature band — the page stopped looking like itself.
 *
 * So the chain's layout is drawn INTO the area the page's cells already
 * use, and every product takes its own design with it: a frame is in
 * shares of its cell, so it fits a cell of any size. A product arriving
 * in a cell with no frame of its own borrows the page's commonest one.
 * The result is a layout of the page's own, like one shaped by hand.
 */
function fitLayout(
  document: CatalogDocument,
  brand: Brand,
  page: CatalogPage,
  next: PageTemplate,
  placements: Placement[],
): { template: PageTemplate; placements: Placement[]; notes: CatalogPage['notes']; decorations: CatalogPage['decorations'] } | null {
  const current = document.templates.find((t) => t.id === page.templateId);
  if (!current || !current.slots.every((slot) => slot.rect)) return null;
  const rects = current.slots.map((slot) => slot.rect!);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  // Kept on the paper even when a measured hero ran off it.
  const box = { x: Math.max(0.02, x0), y: Math.max(0.02, y0), w: 0, h: 0 };
  box.w = Math.min(0.98, x1) - box.x;
  box.h = Math.min(0.98, y1) - box.y;

  const columns = next.areas[0]!.split(' ').length;
  const rows = next.areas.length;
  const gap = 0.014;
  const cw = (box.w - gap * (columns - 1)) / columns;
  const rh = (box.h - gap * (rows - 1)) / rows;
  const grid = next.areas.map((row) => row.split(' '));

  // Frames by the product that wore them — with the cell they were
  // measured in — and the page's commonest one.
  type Worn = { frame: NonNullable<TemplateSlot['frame']>; rect: NonNullable<TemplateSlot['rect']> };
  const worn = (slot: TemplateSlot | undefined): Worn | undefined =>
    slot?.frame && slot.rect ? { frame: slot.frame, rect: slot.rect } : undefined;
  const frameOf = new Map(page.placements.map((placement) => [
    placement.offerId,
    worn(current.slots.find((slot) => slot.id === placement.slotId)),
  ]));
  // Every frame the document's own layouts carry — this page's first, then
  // the rest of the publication's, which share its design.
  const frames = [
    ...current.slots.map(worn),
    ...document.templates.filter((t) => t.id !== current.id).flatMap((t) => t.slots.map(worn)),
  ].filter((entry): entry is Worn => Boolean(entry));
  const common = frames[Math.floor(Math.min(frames.length, current.slots.length) / 2)];

  /*
   * A frame is drawn for a SHAPE. A hero's — packshot on the left, words in
   * a narrow column on the right — squeezed into a square cell put the
   * words in a sliver and the products in a corner. So a product keeps its
   * own frame only while the new cell is roughly the shape it was made
   * for; otherwise it borrows the page's frame whose cell is the nearest
   * shape, which is how that page lays out a cell like this one.
   */
  // Width over height as printed, for a cell in shares of the page.
  const printed = (rect: { w: number; h: number }) => (rect.w / rect.h) * brand.pageAspect;
  // The shape a frame was drawn for: stated, or read off its words — set
  // beside the packshot is a frame for a wide cell, beneath it a square one.
  const designed = (entry: Worn) => {
    const f = entry.frame;
    if (f.shape) return f.shape;
    const beside = f.words && f.words.x >= f.media.x + f.media.w * 0.7;
    return beside ? 2 : 1.1;
  };
  const shapeGap = (entry: Worn, rect: { w: number; h: number }) =>
    Math.abs(Math.log(designed(entry) / printed(rect)));
  const frameFor = (own: Worn | undefined, rect: { w: number; h: number }): Worn | undefined => {
    if (own && shapeGap(own, rect) < Math.log(1.35)) return own;
    const nearest = [...frames].sort((a, b) => shapeGap(a, rect) - shapeGap(b, rect))[0];
    if (!nearest) return own ?? common;
    if (own && shapeGap(own, rect) <= shapeGap(nearest, rect)) return own;
    return nearest;
  };

  /*
   * The frame's type is set in shares of the PAGE, so in a smaller cell
   * the price and the words stayed their old size and burst out of it.
   * Scaled by the change in the cell's area — not its tighter side, which
   * shrank the copy a little further at every change of layout — the
   * copy keeps its proportion to the tile, and grows back with it.
   */
  const resized = (entry: Worn, rect: { w: number; h: number }): Worn['frame'] => {
    const k = Math.max(0.45, Math.min(1.6, Math.sqrt((rect.w * rect.h) / (entry.rect.w * entry.rect.h))));
    if (Math.abs(k - 1) < 0.02) return entry.frame;
    const line = (l: FrameLine): FrameLine => ({
      ...l,
      size: Math.min(0.5, l.size * k),
      ...(l.margin ? { margin: l.margin.map((m) => m * k) } : {}),
      ...(typeof l.width === 'number' ? { width: Math.min(1, l.width * k) } : {}),
    });
    const f = entry.frame;
    return {
      ...f,
      ...(f.type ? { type: { name: f.type.name * k, body: f.type.body * k, figure: Math.min(0.5, f.type.figure * k), pack: f.type.pack * k } } : {}),
      ...(f.priceLines ? { priceLines: f.priceLines.map(line) } : {}),
      ...(f.badges ? { badges: f.badges.map((b) => ({ ...b, lines: b.lines.map(line) })) } : {}),
    };
  };

  const slots = next.slots.map((slot) => {
    let c0 = Infinity; let c1 = -1; let r0 = Infinity; let r1 = -1;
    grid.forEach((row, r) => row.forEach((id, c) => {
      if (id !== slot.id) return;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }));
    const rect = {
      x: box.x + c0 * (cw + gap),
      y: box.y + r0 * (rh + gap),
      w: (c1 - c0 + 1) * cw + (c1 - c0) * gap,
      h: (r1 - r0 + 1) * rh + (r1 - r0) * gap,
    };
    const offerId = placements.find((placement) => placement.slotId === slot.id)?.offerId;
    const own = offerId ? frameOf.get(offerId) : undefined;
    const borrowed = frameFor(own, rect);
    /*
     * A borrowed frame lends its LAYOUT; the price mark stays the
     * product's own — "Ugens køb" on its red roundel is what the offer
     * is, and it should not turn into the next cell's white bubble.
     */
    const source = borrowed && own && borrowed !== own
      ? {
        ...borrowed,
        frame: {
          ...borrowed.frame,
          splash: own.frame.splash,
          priceInk: own.frame.priceInk,
          priceLines: own.frame.priceLines,
          priceStack: own.frame.priceStack,
          ...(own.frame.type && borrowed.frame.type
            ? { type: { ...borrowed.frame.type, figure: own.frame.type.figure * Math.sqrt((borrowed.rect.w * borrowed.rect.h) / (own.rect.w * own.rect.h)), pack: own.frame.type.pack * Math.sqrt((borrowed.rect.w * borrowed.rect.h) / (own.rect.w * own.rect.h)) } }
            : {}),
        },
      }
      : borrowed;
    const frame = source ? { ...resized(source, rect), shape: designed(borrowed!) } : undefined;
    return {
      ...slot,
      // The chain's red band is its own furniture, not this page's.
      role: slot.role === 'feature' ? 'hero' as const : slot.role,
      rect,
      ...(frame ? { frame } : {}),
    };
  });

  /*
   * What the page laid ON a product goes with it: "Storkøb min. 1,3 kg"
   * belongs to the bananas, the splash of fries to the potatoes. A note
   * or a picture whose middle sat in a product's old cell keeps its place
   * relative to that cell in the product's new one; everything else — the
   * headline, the banner — stays where the page put it.
   */
  const moves = page.placements.map((placement) => {
    const from = current.slots.find((slot) => slot.id === placement.slotId)?.rect;
    const to = slots.find((slot) => slot.id === placements.find((p) => p.offerId === placement.offerId)?.slotId)?.rect;
    return from && to ? { from, to } : null;
  }).filter((move): move is NonNullable<typeof move> => Boolean(move));
  const carrierOf = (cx: number, cy: number) => moves.find(({ from }) =>
    cx >= from.x && cx <= from.x + from.w && cy >= from.y && cy <= from.y + from.h);
  const clampPos = (v: number) => Math.min(1.5, Math.max(-0.5, v));
  const notes = (page.notes ?? []).map((note) => {
    if (note.behind) return note;
    const h = note.h ?? 0.03;
    const move = carrierOf(note.x + note.w / 2, note.y + h / 2);
    if (!move) return note;
    const sx = move.to.w / move.from.w;
    const sy = move.to.h / move.from.h;
    const k = Math.sqrt(sx * sy);
    return {
      ...note,
      x: clampPos(move.to.x + (note.x - move.from.x) * sx),
      y: clampPos(move.to.y + (note.y - move.from.y) * sy),
      w: Math.min(2, Math.max(0.02, note.w * k)),
      ...(note.h !== null ? { h: Math.min(2, Math.max(0.01, note.h * k)) } : {}),
      size: Math.min(0.3, Math.max(0.005, note.size * k)),
    };
  });
  const decorations = page.decorations.map((decor) => {
    if (!decor.rect || decor.id.startsWith('pub-masthead')) return decor;
    const r = decor.rect;
    const move = carrierOf(r.x + r.w / 2, r.y + r.h / 2);
    if (!move) return decor;
    const sx = move.to.w / move.from.w;
    const sy = move.to.h / move.from.h;
    const k = Math.sqrt(sx * sy);
    return {
      ...decor,
      rect: {
        x: clampPos(move.to.x + (r.x - move.from.x) * sx),
        y: clampPos(move.to.y + (r.y - move.from.y) * sy),
        w: Math.min(2, Math.max(0.01, r.w * k)),
        h: Math.min(2, Math.max(0.01, r.h * k)),
      },
    };
  });

  const id = `own/${page.id}`;
  const template: PageTemplate = { ...next, id, name: `${next.name} — i sidens egen stil`, slots };
  const templates = [...document.templates.filter((t) => t.id !== id), template];
  return {
    template,
    notes,
    decorations,
    placements: placements.map((placement) => {
      const before = page.placements.find((entry) => entry.offerId === placement.offerId);
      return {
        ...placement,
        overrides: before
          ? carryOverrides(
            before.overrides,
            document.offers.find((offer) => offer.id === placement.offerId),
            cellSize(brand, document.templates, page.templateId, before.slotId),
            cellSize(brand, templates, id, placement.slotId),
          )
          : placement.overrides,
      };
    }),
  };
}

function reseat(
  page: CatalogPage,
  brand: Brand,
  next: PageTemplate,
  document?: CatalogDocument,
): Placement[] {
  const slots = slotAssignmentOrder(next);
  const templates = [...(document?.templates ?? []), next];
  return seatOrder(page, brand)
    .slice(0, slots.length)
    .map((placement, index) => {
      const slotId = slots[index]!.id;
      if (!document) return { ...placement, slotId };
      const offer = document.offers.find((entry) => entry.id === placement.offerId);
      return {
        ...placement,
        slotId,
        overrides: carryOverrides(
          placement.overrides,
          offer,
          cellSize(brand, templates, page.templateId, placement.slotId),
          cellSize(brand, templates, next.id, slotId),
        ),
      };
    });
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
    const next = change(document);
    set({
      ...(continues ? {} : { past: [...past.slice(-29), document], future: [] }),
      document: next,
      ...templatesFollow(document, next),
    });
  }

  /*
   * The chain carries the document's own layouts folded in — that is
   * how a page on one of them renders at all — and the fold is a copy.
   * When an edit changes the document's layouts (a cell dragged to a
   * new size), the chain's copy has to follow or the page keeps drawing
   * the old one.
   */
  function templatesFollow(before: CatalogDocument, after: CatalogDocument): Partial<StudioState> {
    const brand = get().brand;
    if (!brand || before.templates === after.templates) return {};
    return { brand: withTemplates(brand, after.templates) };
  }

  /**
   * The two Danish lines a cluster prints, fetched alongside the
   * arrangement rather than before it.
   *
   * `arrangeGroup` answers with an order, an arrangement name and
   * these two lines. The first two are what `composeSlot` no longer
   * waits for — the placement replaces them — and this is the part
   * that survives: what the tile is CALLED, which no placement can
   * decide and which the feed does not state for an assembled group.
   *
   * Never load-bearing and never noisy: a failure leaves the tile
   * with the name `groupOffers` gave it, and an editor who has
   * already typed their own heading keeps it.
   */
  async function settleGroup(
    pageId: string,
    slotId: string,
    offerId: string,
    /*
     * Whether the order and the arrangement are the model's to
     * decide, or somebody else's.
     *
     * Both, for a cell filled by hand: nothing else has an opinion
     * about how six cheeses stand. Neither, in the compose path,
     * where a placement call a second later gives every product a
     * position in pixels — applying an order here would only scramble
     * the tile on the way past.
     */
    reorder: boolean,
  ): Promise<void> {
    const { brandId, brand, document } = get();
    if (!brandId || !brand || !document) return;
    const page = document.pages.find((entry) => entry.id === pageId);
    const template = page
      ? resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId)
      : undefined;
    const slot = template?.slots.find((entry) => entry.id === slotId);
    const offer = document.offers.find((entry) => entry.id === offerId);
    if (!template || !slot || !offer || offer.members.length < 2) return;

    const cell = slotCells(template, brand.pageAspect).get(slotId);
    try {
      const said = await api.arrangeGroup(brandId, {
        offers: packMembers(offer, document),
        cell: { role: slot.role, aspect: cell?.aspect ?? 1, width: cell?.width ?? 0.5 },
        ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
      });
      /*
       * The cell may not be this cell any more.
       *
       * This runs unawaited, seconds after the products landed, and
       * in those seconds the editor may have filled the cell again,
       * dragged the tile somewhere else or deleted it. Everything
       * below is written only if the same group is still sitting in
       * the same cell.
       */
      const now = overridesOf(offerId);
      const still = pageById(pageId)?.placements
        .some((entry) => entry.slotId === slotId && entry.offerId === offerId);
      if (!now || !still) return;

      /*
       * The order, applied by rebuilding the group.
       *
       * `groupOffers` derives the pack from the member order, so the
       * only way to reorder a tile is to assemble it again — with the
       * SAME id, so the placement goes on pointing at it and every
       * correction on the placement survives.
       *
       * Never over a hand-moved pack: a `pack` override means
       * somebody has already dragged a product in this tile, and
       * reshuffling the pack under them would move the wrong one.
       */
      if (reorder && Object.keys(now.pack).length === 0) {
        const rank = new Map(said.order.map((id, index) => [id, index]));
        const ordered = [...packMembers(offer, get().document!)]
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
        const same = ordered.every((member, index) => member.id === offer.members[index]);
        if (!same) {
          const rebuilt = groupOffers(ordered, offer.id);
          gesture = null;
          mutate((doc) => ({
            ...doc,
            offers: doc.offers.map((entry) => (entry.id === offer.id ? rebuilt : entry)),
          }), `settle/${offer.id}`);
        }
      }

      // Only into a line nobody has written, and an arrangement
      // nobody has chosen. By the time this lands the editor may have
      // typed their own, and overwriting that would be the worst kind
      // of help.
      const after = overridesOf(offerId);
      if (!after) return;
      get().updateOverrides(offerId, {
        ...(reorder && !after.arrangement && said.arrangement
          ? { arrangement: said.arrangement }
          : {}),
        ...(said.heading && !after.displayName && !after.description
          ? {
            displayName: said.heading,
            ...(said.support ? { description: said.support } : {}),
          }
          : {}),
      }, `settle/${offer.id}`);
    } catch {
      /* The tile keeps the name and the order the group was given. */
    }
  }

  /**
   * Stand every cluster on these sheets up, a few at a time.
   *
   * One routine for one page and for the whole book, because the only
   * difference between them is how many tiles go into the same pool —
   * and the pool is the point. Standing a cluster up is a download, an
   * image model and a vision call, the better part of a minute, and
   * none of it needs anything from the cluster next to it. Done one
   * after the other a six-page book is half an hour; done
   * `CLUSTER_AT_ONCE` at a time it is a few minutes.
   *
   * Three other things the loop used to pay for, gone:
   *   - the cutouts were fetched twice per tile, once for the copies
   *     the measurement needs and once for the composition. `copies`
   *     makes the compose call hand back both.
   *   - the server launched a Chromium per flood fill. It keeps one.
   *   - the same cutout was downloaded again on every re-run. The
   *     server holds them for ten minutes.
   *
   * What has NOT changed: one write at the end, so a book stood up in
   * one go is one undo step, and every failure is a line in the note
   * rather than an exception that takes the other tiles with it.
   */
  async function standUpOn(
    pages: CatalogPage[],
    onlyOfferId?: string,
    /*
     * Report on the TILE instead of in the toolbar.
     *
     * One cell somebody just filled is not the same errand as a whole
     * book: the products are already in the cell and printable, the
     * arrangement is an improvement arriving a few seconds later, and
     * a banner that disables every other control while it comes is
     * why a job of a few seconds felt like a wait. A batch of six
     * still takes the banner — there, the waiting IS the errand.
     */
    quiet = false,
  ): Promise<void> {
    const { brandId, document, brand } = get();
    if (!brandId || !document || !brand || pages.length === 0) return;

    const notes: string[] = [];
    const tasks: {
      pageId: string; offerId: string; members: Offer[]; aspect?: number;
    }[] = [];

    for (const page of pages) {
      const { clusters, skipped } = pagePhotographs(page, document);
      notes.push(...skipped);
      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId);
      const cells = template ? slotCells(template, brand.pageAspect) : undefined;
      for (const { offer, members } of clusters) {
        // One tile, when the caller named one: the same engine drives
        // the whole book and a single cluster somebody just assembled.
        if (onlyOfferId && offer.id !== onlyOfferId) continue;
        const slot = page.placements.find((entry) => entry.offerId === offer.id)?.slotId;
        const aspect = slot ? cells?.get(slot)?.aspect : undefined;
        tasks.push({
          pageId: page.id, offerId: offer.id, members, ...(aspect ? { aspect } : {}),
        });
      }
    }

    if (tasks.length === 0) {
      set({
        standingUp: [],
        error: notes.length > 0 ? notes.join(' · ') : 'der er ingen sammensatte fliser på siden',
      });
      return;
    }

    const note = get().arrangeNote.trim();
    const way = get().clusterWay;
    const imageModel = get().clusterImageModel.trim();
    const placeModel = get().clusterPlaceModel.trim();
    /*
     * The words this run is sent with.
     *
     * Whatever is in the box, and otherwise the standing prompt that
     * is chosen — never the server's own default, so what a tile was
     * made with is always the thing the studio is showing.
     *
     * The two are kept apart afterwards: `typed` is what a person
     * wrote and is what the run list offers to put back, while
     * `promptId` merely names which of the shipped prompts was used.
     * Folding them together would make every run look like somebody
     * had hand-written a prompt for it.
     */
    const typed = get().clusterPrompt.trim();
    const promptId = get().clusterPromptId;
    const ownPrompt = typed || placePrompt(promptId);
    const started = Date.now();
    set({
      ...(quiet ? {} : { busy: `0/${tasks.length} klynger stillet op…` }),
      standingUp: tasks.map((task) => task.offerId),
      error: null,
      note: null,
      clusterRun: null,
    });

    try {
      const done = await pool(tasks, CLUSTER_AT_ONCE, async (task) => {
        const page = document.pages.find((entry) => entry.id === task.pageId)!;
        const request = {
          offers: task.members,
          ...(task.aspect ? { aspect: task.aspect } : {}),
          ...(note ? { note } : {}),
        };
        const overrides = page.placements
          .find((entry) => entry.offerId === task.offerId)?.overrides ?? { ...FRESH };

        /*
         * The cheap way: numbers, straight out.
         *
         * No picture is drawn and none is thrown away — one vision
         * call looks at the cutouts and says where each should stand,
         * and everything below is the same arithmetic the round trip
         * feeds. The cell's own proportions stand in for the
         * photograph's, because the numbers are fractions of the cell.
         */
        if (way === 'koordinater') {
          const ready = await api.prepareCluster(brandId, request);

          /*
           * The cell as the page actually draws it, and each cutout's
           * own proportions.
           *
           * Both are the browser's to know and nobody else's — the
           * cell is a rectangle in a laid-out page, and the ink inside
           * a packshot is only visible once the file is decoded. The
           * prompt asks for pixels inside a stated canvas, so handing
           * over the real one is the difference between a size that is
           * right and one that is a few per cent out on every product.
           */
          const tile = window.document
            .querySelector(`[data-offer-id="${CSS.escape(task.offerId)}"]`);
          const box = tile?.querySelector('.tile__media')?.getBoundingClientRect();
          const aspects = await Promise.all(
            ready.files.map((copy) => cutoutAspect(copy.url)),
          );

          const placed = await api.placeCluster(brandId, {
            ...request,
            ...(box && box.width > 0 && box.height > 0
              ? { canvas: { width: Math.round(box.width), height: Math.round(box.height) } }
              : {}),
            aspects,
            offerName: tileName(task.members),
            ...(placeModel ? { model: placeModel } : {}),
            ...(get().placeStrict ? { strict: true } : {}),
            ...(ownPrompt ? { system: ownPrompt } : {}),
          });
          const stood = await standUpCluster({
            offerId: task.offerId,
            members: task.members,
            overrides,
            copies: ready.files,
            placed: placed.products,
            // The canvas the numbers were measured in — the same box,
            // or the template's ideal when it could not be measured.
            picture: box && box.height > 0 ? box.width / box.height : (task.aspect ?? 1),
          });
          if ('error' in stood) return { stood };
          return {
            stood,
            missing: placed.missing.length,
            ghost: null,
            model: placed.model,
            ...(placed.insteadOf ? { insteadOf: placed.insteadOf } : {}),
            drawnBy: null,
            tokens: (placed.usage?.inputTokens ?? 0) + (placed.usage?.outputTokens ?? 0),
            inputTokens: placed.usage?.inputTokens ?? 0,
            outputTokens: placed.usage?.outputTokens ?? 0,
            view: placed.view ?? null,
          };
        }

        /*
         * One call, not two. The compose route returns the same-origin
         * copies the measurement needs alongside the composition —
         * `copies` — so the cutouts cross the wire once. An older
         * server that does not know the flag still answers, and the
         * copies are fetched the old way rather than the tile being
         * measured against nothing.
         */
        const drawn = await api.composeCluster(brandId, {
          ...request,
          copies: true,
          ...(imageModel ? { model: imageModel } : {}),
        });
        const copies = drawn.files
          ?? (await api.prepareCluster(brandId, request)).files;

        /*
         * A file written a second ago is not yet a file the dev server
         * will serve — see `reachable`. Reading it before it is there
         * is how a composed tile ends up showing a broken image.
         */
        if (!await reachable(drawn.url)) {
          throw new Error(`${drawn.url} kunne ikke hentes igen`);
        }

        // The composition arrives keyed out and trimmed; a reader needs
        // it on white — see `onWhite`.
        const bytes = await onWhite(drawn.url);
        const reading = await api.readClusterLayout(brandId, {
          file: toBase64(bytes), offers: task.members,
        });

        const stood = await standUpCluster({
          offerId: task.offerId,
          members: task.members,
          overrides,
          copies,
          placed: reading.products,
          picture: await pictureAspect(new File([bytes as BlobPart], 'composed.png')),
        });
        if ('error' in stood) return { stood };

        return {
          stood,
          missing: reading.missing.length,
          ghost: await keepGhost(brandId, stood, bytes, 'komposition.png'),
          model: reading.model,
          drawnBy: drawn.model,
          tokens: (reading.usage?.inputTokens ?? 0) + (reading.usage?.outputTokens ?? 0),
          inputTokens: reading.usage?.inputTokens ?? 0,
          outputTokens: reading.usage?.outputTokens ?? 0,
        };
      }, (finished, total) => {
        if (!quiet) set({ busy: `${finished}/${total} klynger stillet op…` });
      });

      /*
       * Read back in the order they went in, never in the order they
       * finished: a page whose tiles rearranged themselves by who
       * answered first would be a different page every run.
       */
      const stoodUp: StoodUp[] = [];
      const ghosts: Ghost[] = [];
      for (const [index, result] of done.entries()) {
        const name = tileName(tasks[index]!.members);
        if (!result.ok) { notes.push(`${name}: ${message(result.error)}`); continue; }
        const { stood } = result.value;
        if ('error' in stood) { notes.push(stood.error); continue; }
        if (stood.patches.size === 0) {
          notes.push(`${name}: ingen af varerne kunne genfindes i kompositionen`);
          continue;
        }
        stoodUp.push(stood);
        if (result.value.ghost) ghosts.push(result.value.ghost);
        notes.push(`${name}: ${count(stood.patches.size, 'vare', 'varer')} stillet op${
          result.value.missing ? `, ${result.value.missing} ikke genfundet` : ''}${
          stood.complaints.length > 0
            ? `, ${count(stood.complaints.length, 'advarsel', 'advarsler')}` : ''}`);
      }

      if (stoodUp.length === 0) {
        // The spinner on each tile goes too — a failed run that leaves
        // "stiller op…" behind looks like one still going.
        set({ busy: null, standingUp: [], error: notes.join(' · ') || 'ingen af klyngerne kunne stilles op' });
        return;
      }

      /*
       * What the run did, for the panel.
       *
       * Measured, never estimated: the models that answered, the
       * tokens they reported, the wall clock, and how many products
       * actually moved. The back-to-front order is the tile's own pack
       * order after the arrangement — which is the one thing a person
       * looking at a cluster wants to check without clicking into it.
       */
      const first = done.find((entry) => entry.ok && !('error' in entry.value.stood));
      const answered = first?.ok ? first.value : null;
      const run: ClusterRun = {
        way,
        model: answered && 'model' in answered ? answered.model ?? '' : '',
        insteadOf: answered && 'insteadOf' in answered ? answered.insteadOf ?? null : null,
        drawnBy: answered && 'drawnBy' in answered ? answered.drawnBy ?? null : null,
        elapsedMs: Date.now() - started,
        tokens: done.reduce((total, entry) => (
          entry.ok && 'tokens' in entry.value ? total + (entry.value.tokens ?? 0) : total
        ), 0) || null,
        // Summed over every cluster in the run, because the price is
        // what the run cost and not what its first tile cost.
        inputTokens: done.reduce((total, entry) => (
          entry.ok && 'inputTokens' in entry.value ? total + (entry.value.inputTokens ?? 0) : total
        ), 0),
        outputTokens: done.reduce((total, entry) => (
          entry.ok && 'outputTokens' in entry.value
            ? total + (entry.value.outputTokens ?? 0) : total
        ), 0),
        placed: stoodUp.reduce((total, stood) => total + stood.patches.size, 0),
        of: tasks.reduce((total, task) => total + task.members.length, 0),
        order: stoodUp.length === 1
          ? backToFront(stoodUp[0]!, tasks[0]!.members)
          : [],
        complaints: stoodUp.flatMap((stood) => stood.complaints.map((entry) => entry.said)),
        view: answered && 'view' in answered ? answered.view ?? null : null,
      };

      /*
       * Kept, so the next run can be compared with this one.
       *
       * Only the coordinate way: the round trip's quality is the
       * image model's, and its prompt is not the one anybody is
       * editing here.
       */
      const runs = way === 'koordinater'
        ? [
          {
            at: new Date().toISOString(),
            tile: tileName(tasks[0]?.members ?? []),
            prompt: typed,
            promptId,
            model: run.model,
            elapsedMs: run.elapsedMs,
            placed: run.placed,
            of: run.of,
          },
          ...get().promptRuns,
        ].slice(0, PROMPT_RUNS)
        : get().promptRuns;
      if (runs !== get().promptRuns) {
        try {
          window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
        } catch { /* out of room; the list is a convenience */ }
      }

      gesture = null;
      mutate((doc) => withPatches(doc, stoodUp));
      set({
        busy: null,
        standingUp: [],
        clusterRun: run,
        promptRuns: runs,
        ghosts: ghosts.reduce(withGhost, get().ghosts),
        // How long it took, in front of the person who asked for it —
        // this is the number the parallelism exists for.
        note: [`${count(stoodUp.length, 'klynge', 'klynger')} på ${
          Math.round((Date.now() - started) / 1000)}s`, ...notes].join(' · '),
      });
    } catch (error) {
      set({ busy: null, standingUp: [], error: message(error) });
    }
  }

  /**
   * Hold a request until somebody says which week.
   *
   * Asked at the last possible moment and only once: the studio does
   * not open with a modal, it asks the first time a request would
   * produce pages that have to be called something. The request itself
   * is kept, so answering the question also runs the thing that was
   * asked for — the alternative is a dialog that closes and leaves the
   * person to press the button again.
   */
  function askingWeek(then: () => void): boolean {
    if (get().week) return false;
    set({ askWeek: { then }, busy: null });
    return true;
  }

  /** Where week 39's avis is stored. One avis per week, per chain. */
  function weekId(brandId: string, week: CatalogWeek): string {
    return `${brandId}-${week.year}-u${String(week.week).padStart(2, '0')}`;
  }

  /**
   * Stamp a document that is being created right now.
   *
   * Id, name and week together, because they are one fact: this is
   * week 39's paper for this chain. The id being derived is what makes
   * a second run of week 39 a new VERSION of it — every save appends
   * to the version table — rather than a sixteenth row in the picker
   * with the same name as the other fifteen.
   */
  function forWeek(document: CatalogDocument): CatalogDocument {
    const week = get().week;
    if (!week) return document;
    return {
      ...document,
      id: weekId(document.brandId, week),
      name: weekName(get().brand?.name ?? document.brandId, week),
      week,
    };
  }

  /** The week alone, for a document that keeps the id and name it has. */
  function withWeek(document: CatalogDocument): CatalogDocument {
    const week = get().week;
    return week ? { ...document, week } : document;
  }

  return {
    brands: [],
    brandId: null,
    brand: null,
    sources: [],
    feed: null,
    document: null,
    week: rememberedWeek(),
    askWeek: null,
    weekOnly: false,
    view: 'bog',
    openPageId: null,
    scrollToPageId: null,
    bookView: 'opslag',
    addPagesOpen: false,
    trayFilter: null,
    savedAt: null,
    uploads: [],
    drawer: 'varer',
    panel: null,
    standingUp: [],
    findings: [],
    findingsOpen: remembered(CHECKS_KEY, '1') === '1',
    catalogues: [],
    curationReady: false,
    decorReady: api.hasImageKey(),
    serverKey: false,
    imageKeyTail: api.imageKeyTail(),
    decorModel: '',
    clusterWay: remembered<ClusterWay>(WAY_KEY, 'koordinater'),
    clusterImageModel: remembered(IMAGE_MODEL_KEY, ''),
    clusterPlaceModel: remembered(PLACE_MODEL_KEY, ''),
    placeStrict: remembered(STRICT_KEY, '1') === '1',
    clusterPrompt: remembered(PROMPT_KEY, ''),
    clusterPromptId: remembered<PlacePromptId>(PROMPT_ID_KEY, 'regler'),
    promptRuns: rememberedRuns(),
    clusterRun: null,
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
    selectedNoteId: null,
    layoutEditPageId: null,
    selectedPart: null,
    selectedPack: null,
    ghosts: [],
    selectedText: null,
    maxPages: 6,
    past: [],
    future: [],

    /**
     * The week, answered.
     *
     * Renames the open avis as well as setting the field. Every name
     * this studio has ever produced was generated — "Hentet
     * udgivelse", the chain's own name, a timestamp — so there is no
     * hand-typed title to protect, and a document called last week's
     * name while carrying this week's dates would be worse than the
     * problem this replaces. It is an ordinary edit: ⌘Z takes it back.
     */
    setWeek(week) {
      try {
        window.localStorage.setItem(WEEK_KEY, JSON.stringify(week));
      } catch { /* private browsing; it holds for this session */ }

      const pending = get().askWeek;
      set({ week, askWeek: null });

      if (get().document) {
        const name = weekName(get().brand?.name ?? get().brandId ?? '', week);
        mutate((doc) => ({ ...doc, week, name }));
      }

      pending?.then();
      get().refreshFindings();
    },

    clearScrollTo: () => set({ scrollToPageId: null }),
    seePage: (pageId) => {
      if (get().openPageId === pageId) return;
      set({ openPageId: pageId, activePageId: pageId });
    },

    openPage: (pageId) => set({
      view: pageId ? 'side' : 'bog',
      openPageId: pageId,
      scrollToPageId: pageId,
      // The page you opened is the page the tray deals onto. One idea,
      // not two — see `setActivePage`.
      ...(pageId ? { activePageId: pageId } : {}),
      addPagesOpen: false,
    }),

    stepPage(delta) {
      const { document, openPageId } = get();
      const pages = document?.pages ?? [];
      const at = pages.findIndex((page) => page.id === openPageId);
      const next = pages[at + delta];
      if (next) get().openPage(next.id);
    },

    setBookView: (bookView) => set({ bookView }),
    setAddPagesOpen: (addPagesOpen) => set({ addPagesOpen }),
    setTrayFilter: (trayFilter) => set({ trayFilter }),

    togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
    closePanel: () => set({ panel: null }),

    closeAskWeek: () => set({ askWeek: null }),
    setWeekOnly: (only) => set({ weekOnly: only }),

    setFindingsOpen: (open) => {
      remember(CHECKS_KEY, open ? '1' : '0');
      set({ findingsOpen: open });
    },

    /**
     * Read the document, measure the pages, and put both in one list.
     *
     * Two passes, because they answer two different kinds of question.
     * The document knows what is absent — a product with no
     * photograph, a cell nobody filled, an offer that does not run
     * this week — and it knows it for nothing. The rendered page knows
     * what came out wrong — a price on a name, a line clipped in half
     * — and only the browser can say. `npm run check` has measured the
     * second kind in a terminal all along; this is the same rules,
     * standing next to the sheet they are about.
     */
    refreshFindings() {
      const { document, brand, week } = get();
      const read = readFindings(document, brand, week);
      /*
       * The clusters nobody has positioned.
       *
       * A pack with no `pack` corrections on its placement has never
       * been through a placing model and has never been dragged — so
       * every size in it is whatever the stylesheet made of the
       * photograph, which is the one case worth complaining about.
       * See `measureFindings`.
       */
      const untouched = new Set(
        (document?.pages ?? [])
          .flatMap((page) => page.placements)
          .filter((placement) => Object.keys(placement.overrides.pack ?? {}).length === 0)
          .map((placement) => placement.offerId),
      );
      const measured = document
        ? measureFindings(window.document, document.pages.map((page) => page.id), untouched)
        : [];
      set({ findings: [...read, ...measured].sort(bySeverity) });
    },

    /**
     * Stand at the tile the line is about.
     *
     * The whole point of the list: a complaint you cannot walk to is a
     * report, and people do not act on reports. The page becomes the
     * active one — so the library deals onto it — the tile is selected
     * so the inspector is already open on it, and the sheet is
     * scrolled to.
     */
    goToOffer(offerId) {
      const { document } = get();
      const page = document?.pages.find(
        (entry) => entry.placements.some((placement) => (
          placement.offerId === offerId
          || document.offers.find((offer) => offer.id === placement.offerId)
            ?.members.includes(offerId)
        )),
      );
      if (!page) return;
      // The assembled tile, when what was asked for is inside one: a
      // member has no cell of its own to select.
      const seat = page.placements.find((placement) => placement.offerId === offerId)
        ?? page.placements.find((placement) => document!.offers
          .find((offer) => offer.id === placement.offerId)?.members.includes(offerId));

      set({
        activePageId: page.id,
        selectedOfferId: seat?.offerId ?? null,
        selectedPart: null,
        selectedPack: null,
        selectedText: null,
      });
      window.document
        .querySelector(`[data-offer-id="${CSS.escape(seat?.offerId ?? offerId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    goToFinding(finding) {
      set({
        ...(finding.pageId ? { activePageId: finding.pageId } : {}),
        selectedOfferId: finding.offerId,
        selectedPart: null,
        selectedPack: null,
        selectedText: null,
      });

      const node = finding.offerId
        ? window.document.querySelector(`[data-offer-id="${CSS.escape(finding.offerId)}"]`)
        : finding.pageId
          ? window.document.querySelector(`[data-page-id="${CSS.escape(finding.pageId)}"]`)
          : null;
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Products with no cell are dealt from the library, so open it:
      // the line names the problem and this is the tool for it.
      if (!finding.pageId && finding.kind === 'plads') set({ libraryOpen: true });
    },

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
        void get().refreshUploads();
        const parked = parkedWork(brandId);
        set({
          brandId,
          brand: profile.brand,
          sources: profile.sources,
          curationReady,
          /*
           * The test publication, in the field it belongs in.
           *
           * Only when the editor has not typed their own link: this
           * is a convenience for the machine's own standing test
           * avis, not something that should overwrite what somebody
           * pasted a moment ago.
           */
          ...(profile.testPublication && !get().publicationUrl.trim()
            ? { publicationUrl: profile.testPublication }
            : {}),
          // The server's key OR this browser's — either one draws.
          decorReady: decor.configured || api.hasImageKey(),
          serverKey: decor.configured,
          decorModel: decor.imageModel,
          feed: text && sample?.path
            ? { text, source: sample.path.split('/').pop() ?? sample.path }
            : null,
          /*
           * Back where you were.
           *
           * The studio reloads all day — a save, a stylesheet change,
           * a closed laptop — and each one used to mean building the
           * draft again, grouping the products again and paying for
           * the arrangement again. The open catalogue is parked in
           * this browser as it changes; here is where it comes back.
           *
           * Never over a document that is already open: this runs on
           * picking a chain, and picking the chain you are already in
           * must not undo the last ten minutes.
           */
          ...(!get().document && parked
            ? { document: parked.document, past: [], future: [] }
            : {}),
          busy: null,
          ...(parked && !get().document
            ? {
              note: `Genoptog arbejdet fra ${new Date(parked.at).toLocaleTimeString('da-DK', {
                hour: '2-digit', minute: '2-digit',
              })} — ${parked.document.pages.length} sider`,
            }
            : {}),
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
      // Which week, before anything is built: the draft is named after
      // it and the feed is cut to it. See `askingWeek`.
      if (askingWeek(() => void get().build(options))) return;
      const week = get().week;

      set({ busy: 'Bygger…', error: null, note: null });

      try {
        const reply = await api.buildCatalogue(brandId, {
          feed: feed.text,
          maxPages,
          skipCuration: true,
          // The server drops offers outside the week it is given. While
          // the week filter is off (testing), every product goes in.
          ...(week && get().weekOnly ? { week } : {}),
          // A fresh seed on every click: pressing the button again is a
          // request for another take, and with a fixed seed the second
          // click returns the first click's pages.
          ...(options.fresh ? { seed: String(Date.now()) } : {}),
        });

        const notes = [
          reply.source.name,
          `${reply.document.pages.length} sider af ${reply.offerCount} tilbud`,
          'kategorisortering — ingen model',
          // The number that says the file is the wrong week's.
          ...(reply.outsideWeek > 0
            ? [`${reply.outsideWeek} gælder ikke i ugen og kom ikke med`] : []),
          ...(reply.dropped > 0 ? [`${reply.dropped} tilbud kunne ikke være med`] : []),
          ...(reply.substitutions.length > 0
            ? [`${reply.substitutions.length} sider fik en anden skabelon`]
            : []),
        ];

        const document = forWeek(reply.document);
        set({
          document,
          past: [],
          future: [],
          // The library deals onto a page, and a fresh document needs
          // one named or the first click would have nowhere to land.
          activePageId: document.pages[0]?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          busy: null,
          // The canvas now shows a plain draft, not rebuilt pages, so
          // the comparison strips have nothing left to compare.
          reproductions: [],
          note: notes.join(' · '),
          /*
           * The feed is another week's.
           *
           * The build still happened — a filter that empties the feed
           * falls back to all of it rather than producing an empty
           * avis — so this is a warning and not a failure. It is also
           * the single most useful thing the studio can say: the file
           * that was uploaded does not cover the week that was asked
           * for, and every page on screen is built from the wrong one.
           */
          ...(reply.inWeek === 0
            ? {
              error: `Ingen varer i feedet gælder i uge ${week?.week}`
                + ' — siderne er bygget på hele filen. Upload ugens feed,'
                + ' eller ret ugen i bjælken.',
            }
            : reply.curationError ? { error: reply.curationError } : {}),
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
        set({ busy: null, note: 'Gemt', savedAt: new Date().toISOString() });
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
          /*
           * Opening week 38's avis moves the studio to week 38.
           *
           * The alternative is an editor looking at last week's paper
           * while every control around it is set to this week — and
           * the first thing they do is add a product, which would be
           * checked against the wrong dates. A catalogue from before
           * anyone asked carries no week and leaves the studio's
           * alone; that is the honest answer for those.
           */
          ...(document.week ? { week: document.week } : {}),
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
        get().refreshFindings();
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
      // These pages cost a model call each and are saved the moment
      // they land, so the week has to be known BEFORE the first one.
      if (askingWeek(() => void get().reproduce())) return;
      const week = get().week;

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
      /*
       * The week names it when there is one.
       *
       * The timestamp below is what this used to be, and it is what
       * made the picker unreadable: every run of every week called
       * itself by the minute it happened. With a week, a second run of
       * week 39 is a new VERSION of week 39's avis — every save
       * appends to the version table, so nothing is lost — and the
       * picker has one line per week, which is how the people making
       * the paper think about it.
       */
      const catalogId = base
        ? base.id
        : (week ? weekId(brandId, week) : `${brandId}-${stamp}`);
      const catalogName = base
        ? base.name
        : (week
          ? weekName(get().brand?.name ?? brandId, week)
          : `${get().brand?.name ?? brandId} · ${new Date().toLocaleString('da-DK', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}`);

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

          const document = withWeek(mergeCatalogDocuments(parts, {
            id: catalogId,
            name: catalogName,
          }));
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

    setClusterWay: (way) => {
      remember(WAY_KEY, way);
      set({ clusterWay: way });
    },

    setClusterImageModel: (model) => {
      remember(IMAGE_MODEL_KEY, model);
      set({ clusterImageModel: model });
    },

    setClusterPlaceModel: (model) => {
      remember(PLACE_MODEL_KEY, model);
      set({ clusterPlaceModel: model });
    },

    setPlaceStrict: (strict) => {
      remember(STRICT_KEY, strict ? '1' : '0');
      set({ placeStrict: strict });
    },

    setClusterPrompt: (prompt) => {
      remember(PROMPT_KEY, prompt);
      set({ clusterPrompt: prompt });
    },

    setClusterPromptId: (id) => {
      remember(PROMPT_ID_KEY, id);
      set({ clusterPromptId: id });
    },

    setImageKey: (key) => {
      api.setImageKey(key);
      set({
        imageKeyTail: api.imageKeyTail(),
        decorReady: get().serverKey || api.hasImageKey(),
      });
    },

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
    async drawBackdrops(pageIds) {
      const { brandId, document, decorStyle } = get();
      if (!brandId || !document) return;

      const empty: number[] = [];
      const tasks = pageIds.map((pageId) => {
        const page = document.pages.find((entry) => entry.id === pageId);
        if (!page || page.kind === 'image') return null;
        const measure = measurePage(pageId, page.ground);
        if (!measure) return null;
        const offers = page.placements
          .map((placement) => document.offers.find((entry) => entry.id === placement.offerId))
          .filter((offer): offer is Offer => Boolean(offer));
        if (!measure.spots || measure.spots.length === 0) {
          empty.push(document.pages.indexOf(page) + 1);
          return null;
        }
        return { page, measure, offers };
      }).filter((task): task is NonNullable<typeof task> => Boolean(task));
      if (tasks.length === 0) {
        set({
          error: empty.length > 0
            ? `Side ${empty.join(', ')} har ingen fri plads at tegne i — gør en flise mindre eller fjern en vare`
            : 'fandt ingen sider at tegne til — åbn siden først',
        });
        return;
      }

      let finished = 0;
      set({ busy: `Tegner motiver… 0/${tasks.length}`, error: null, note: null });
      const failures: string[] = [];
      const drawn = await pool(tasks, 3, async (task) => {
        const number = document.pages.indexOf(task.page) + 1;
        // What the page is about: its heading, else its leading offer.
        const about = task.page.title.trim() || task.offers[0]?.name || 'tilbud';
        try {
          const reply = await api.drawBackdrop(brandId, {
            ...task.measure,
            offer: about,
            /*
             * The page's lead product only. Every name on the page made
             * the model show every product — schnitzel, meatballs and a
             * plate of mash on one freezer page. One motif is the point.
             */
            products: task.offers[0] ? [task.offers[0].name] : [],
            ...(decorStyle.trim() ? { style: decorStyle.trim() } : {}),
          });
          const stamp = Date.now().toString(36);
          const under = reply.motifs.length;
          const result = {
            pageId: task.page.id,
            /*
             * Each motif exactly where the model put it — except one
             * that landed under a product anyway, which nobody would see.
             */
            decorations: reply.motifs
              .filter((motif) => {
                const m = motif.spot;
                const area = Math.max(1e-6, (m.x1 - m.x0) * (m.y1 - m.y0));
                const hidden = task.measure.productBoxes.reduce((sum, r) => sum
                  + Math.max(0, Math.min(m.x1, r.x1) - Math.max(m.x0, r.x0))
                  * Math.max(0, Math.min(m.y1, r.y1) - Math.max(m.y0, r.y0)), 0);
                return hidden / area < 0.5;
              })
              .map((motif, index) => motifDecoration(
                motif, task.measure.ratio, `motif-${stamp}-${index}`, `${MOTIF_SUBJECT} ${about}`, 0,
              )),
          };
          // Said, not reported as done: nothing landed where it can be seen.
          if (result.decorations.length === 0) {
            failures.push(`Side ${number}: ${under > 0 ? 'motivet landede under varerne' : 'intet motiv'} — prøv igen`);
            return null;
          }
          return result;
        } catch (error) {
          failures.push(`Side ${number}: ${message(error)}`);
          return null;
        } finally {
          finished += 1;
          set({ busy: `Tegner motiver… ${finished}/${tasks.length}` });
        }
      });

      const done = drawn
        .map((entry) => (entry.ok ? entry.value : null))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (done.length > 0) {
        gesture = null;
        /*
         * Laid on the page as decorations — movable like every other
         * picture. Drawing again replaces the page's earlier motifs
         * rather than piling new ones on them.
         */
        mutate((doc) => ({
          ...doc,
          pages: doc.pages.map((page) => {
            const mine = done.find((entry) => entry.pageId === page.id);
            if (!mine) return page;
            // First in the list, so the page's own pictures — its logo,
            // its heading artwork — are painted over them.
            const kept = page.decorations.filter((decor) => !decor.id.startsWith('motif-'));
            return { ...page, decorations: [...mine.decorations, ...kept].slice(0, 12) };
          }),
        }));
      }
      set({
        busy: null,
        note: done.length > 0
          ? `${count(done.length, 'side', 'sider')} fik motiver — tag dem i hånden under siden for at flytte dem`
          : null,
        error: failures.length > 0 ? failures.slice(0, 3).join(' · ') : null,
      });
    },

    async decorate(pageIds) {
      const { brandId, document, decorNote, decorStyle, past } = get();
      if (!brandId || !document) return;

      set({ busy: 'Finder et motiv i sidens varer og tegner det…', error: null, note: null });
      try {
        const reply = await api.decorateDocument(brandId, document, {
          brief: decorNote,
          style: decorStyle,
          ...(pageIds ? { pageIds } : {}),
        });
        const number = (pageId: string) =>
          reply.document.pages.findIndex((page) => page.id === pageId) + 1;
        set({
          document: reply.document,
          past: [...past.slice(-29), document],
          future: [],
          busy: null,
          note: [
            // What was drawn, by name — "Side 3: kaffebønner" says why the
            // picture is there; a count does not.
            reply.subjects && reply.subjects.length > 0 && reply.subjects.length <= 4
              ? reply.subjects.map((entry) => `Side ${number(entry.pageId)}: ${entry.subject}`).join(' · ')
              : `${count(reply.drawn, 'side', 'sider')} fik et stemningsbillede`,
            ...(reply.cached > 0 ? [`${reply.cached} fra cache`] : []),
            ...(reply.skipped > 0
              ? [pageIds?.length === 1 && reply.drawn === 0
                ? 'intet oplagt motiv i sidens varer'
                : `${reply.skipped} bevidst uden`]
              : []),
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
        ? { selectedOfferId: offerId, selectedDecorId: null, selectedText: null, selectedNoteId: null }
        : {
          selectedOfferId: offerId,
          selectedPart: null,
          // Another tile's variant index means nothing on this one.
          selectedPack: null,
          selectedDecorId: null,
          selectedText: null,
          selectedNoteId: null,
        },
    ),

    selectDecor: (decorId) => set({
      selectedDecorId: decorId,
      ...(decorId
        ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedText: null, selectedNoteId: null }
        : {}),
    }),

    setLayoutEdit: (pageId) => set({
      layoutEditPageId: pageId,
      ...(pageId ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedDecorId: null, selectedNoteId: null } : {}),
    }),

    ownLayout(pageId, rects) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !brand || !page) return;
      const template = document.templates.find((t) => t.id === page.templateId)
        ?? resolveTemplate(brand, page.templateId);
      if (!template) return;
      const owned = document.templates.some((t) => t.id === template.id);
      const complete = template.slots.every((slot) => slot.rect);
      if (owned && complete) return;

      const withRects = {
        ...template,
        slots: template.slots.map((slot) => (slot.rect ? slot : rects[slot.id] ? { ...slot, rect: rects[slot.id]! } : slot)),
      };
      if (owned) {
        mutate((doc) => ({ ...doc, templates: doc.templates.map((t) => (t.id === template.id ? withRects : t)) }));
        return;
      }
      const id = `own/${pageId}`;
      const number = document.pages.indexOf(page) + 1;
      const copy = { ...withRects, id, name: `Side ${number} — egen opsætning` };
      mutate((doc) => ({
        ...doc,
        templates: [...doc.templates.filter((t) => t.id !== id), copy],
        pages: doc.pages.map((entry) => (entry.id === pageId ? { ...entry, templateId: id } : entry)),
      }));
    },

    setCellRect(pageId, slotId, rect, name) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      if (!page) return;
      const was = get().document?.templates.find((t) => t.id === page.templateId)
        ?.slots.find((slot) => slot.id === slotId);
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === page.templateId
          ? { ...t, slots: t.slots.map((slot) => (slot.id === slotId ? { ...slot, rect } : slot)) }
          : t)),
        // The tile in the cell keeps its arrangement as the cell grows.
        pages: doc.pages.map((entry) => (entry.id === pageId && was?.rect
          ? {
            ...entry,
            placements: entry.placements.map((placement) => (placement.slotId === slotId
              ? {
                ...placement,
                overrides: carryOverrides(
                  placement.overrides,
                  doc.offers.find((offer) => offer.id === placement.offerId),
                  { w: was.rect!.w, h: was.rect!.h, role: was.role },
                  { w: rect.w, h: rect.h, role: was.role },
                ),
              }
              : placement)),
          }
          : entry)),
      }), name ?? `cell:${pageId}:${slotId}`);
    },

    addCell(pageId, rect) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      if (!page || !template) return;
      const used = new Set(template.slots.map((slot) => slot.id));
      const id = [...'abcdefghijklmnopqrstuvwxyz'].map((c) => c)
        .concat([...'abcdefghijklmnopqrstuvwxyz'].map((c) => `x${c}`))
        .find((candidate) => !used.has(candidate));
      if (!id) return;
      const width = template.areas[0]!.split(' ').length;
      gesture = null;
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            // A row of its own in the grid underneath, so the layout stays
            // one a grid can describe; the box is what places it.
            areas: [...t.areas, new Array(width).fill(id).join(' ')],
            slots: [...t.slots, { id, role: 'standard' as const, bleed: 1, rect }],
          }
          : t)),
      }));
    },

    removeCell(pageId, slotId) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      if (!page || !template || template.slots.length <= 1) return;
      gesture = null;
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            areas: t.areas.map((row) => row.split(' ').map((cell) => (cell === slotId ? '.' : cell)).join(' ')),
            slots: t.slots.filter((slot) => slot.id !== slotId),
          }
          : t)),
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? { ...entry, placements: entry.placements.filter((placement) => placement.slotId !== slotId) }
          : entry)),
      }));
    },

    mergeCells(pageId, slotId, emptyId) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      const a = template?.slots.find((slot) => slot.id === slotId)?.rect;
      const b = template?.slots.find((slot) => slot.id === emptyId)?.rect;
      if (!page || !template || !a || !b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const union = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
      const role = template.slots.find((slot) => slot.id === slotId)!.role;
      gesture = null;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? {
            ...entry,
            placements: entry.placements.map((placement) => (placement.slotId === slotId
              ? {
                ...placement,
                overrides: carryOverrides(
                  placement.overrides,
                  doc.offers.find((offer) => offer.id === placement.offerId),
                  { w: a.w, h: a.h, role }, { w: union.w, h: union.h, role },
                ),
              }
              : placement)),
          }
          : entry)),
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            areas: t.areas.map((row) => row.split(' ').map((cell) => (cell === emptyId ? '.' : cell)).join(' ')),
            slots: t.slots
              .filter((slot) => slot.id !== emptyId)
              .map((slot) => (slot.id === slotId ? { ...slot, rect: union } : slot)),
          }
          : t)),
      }));
    },

    // One thing in hand at a time: a note, a picture and a tile are
    // never selected together, so the panel and the keys have one owner.
    selectNote: (noteId) => set({
      selectedNoteId: noteId,
      ...(noteId
        ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedText: null, selectedDecorId: null }
        : {}),
    }),

    addNote(pageId) {
      const id = `note-${Date.now().toString(36)}`;
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? {
            ...page,
            notes: [...(page.notes ?? []), {
              id, text: 'Skriv din tekst', x: 0.25, y: 0.45, w: 0.5, size: 0.045,
              color: '#16181d', bold: true, align: 'center' as const, rotate: 0,
              background: null, image: null, h: null, behind: false,
            }].slice(-24),
          }
          : page)),
      }));
      get().selectNote(id);
    },

    updateNote(pageId, noteId, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, notes: (page.notes ?? []).map((note) => (note.id === noteId ? { ...note, ...patch } : note)) }
          : page)),
      }), name ?? `note:${noteId}`);
    },

    removeNote(pageId, noteId) {
      gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, notes: (page.notes ?? []).filter((note) => note.id !== noteId) }
          : page)),
      }));
      if (get().selectedNoteId === noteId) set({ selectedNoteId: null });
    },

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

      const brand = get().brand;
      /* Each tile keeps its arrangement in the other's cell. */
      const size = (document: CatalogDocument, at: { pageId: string; slotId: string }) => {
        const page = document.pages.find((entry) => entry.id === at.pageId);
        return brand && page ? cellSize(brand, document.templates, page.templateId, at.slotId) : null;
      };
      mutate((document) => {
        const carry = (placement: Placement, into: { pageId: string; slotId: string }, out: { pageId: string; slotId: string }) =>
          carryOverrides(
            placement.overrides,
            document.offers.find((offer) => offer.id === placement.offerId),
            size(document, out),
            size(document, into),
          );
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
                  ? { ...placement, offerId: target.offerId, overrides: carry(target, from, to) }
                  : null;
              }
              if (here.pageId === to.pageId && here.slotId === to.slotId) {
                return { ...placement, offerId: source.offerId, overrides: carry(source, to, from) };
              }
              return placement;
            })
            .filter((placement): placement is NonNullable<typeof placement> => placement !== null);

          // A move onto a slot that held nothing has to create it.
          if (page.id === to.pageId && !target) {
            placements.push({
              offerId: source.offerId,
              slotId: to.slotId,
              overrides: carry(source, to, from),
            });
          }
          return { ...page, placements };
        });

        return { ...document, pages };
      });
    },
    setMaxPages: (pages) => set({ maxPages: Math.max(1, Math.min(60, pages)) }),

    endGesture() { gesture = null; },

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
          /*
           * No same-origin copies here.
           *
           * The by-hand route used to leave a set behind, and it is
           * gone — a picture dropped on a tile now arrives with
           * nothing but itself. `standUpCluster` falls back to
           * treating each cutout as all product, which is right for
           * the trimmed artwork a chain supplies and a little
           * generous for a packshot with a margin.
           */
          copies: [],
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

    standUpClusters: (pageId: string) => standUpOn(
      (get().document?.pages ?? []).filter((page) => page.id === pageId),
    ),

    standUpAllClusters: () => standUpOn(get().document?.pages ?? []),

    standUpOneCluster: (offerId: string) => standUpOn(get().document?.pages ?? [], offerId),

    async splitAndStandUp(offerId) {
      const { brandId, document } = get();
      const offer = document?.offers.find((entry) => entry.id === offerId);
      if (!brandId || !document || !offer || !(offer.imageUrl || offer.imagePack.length > 1)) return;

      /*
       * A product the feed already photographs one variant at a time —
       * several pictures, no members — needs nothing cut: each picture
       * is a variant. Only a single picture of several packages goes to
       * the server to be taken apart.
       */
      let products: { name: string; ref: string }[];
      if (offer.imagePack.length > 1) {
        products = offer.imagePack.map((ref) => ({ name: '', ref }));
      } else {
        set({ busy: 'Finder varerne i billedet…', error: null, note: null });
        try {
          ({ products } = await api.splitVariants(brandId, offer.imageUrl!));
        } catch (error) {
          set({ busy: null, error: message(error) });
          return;
        }
      }

      const children = products.map((product, index) => ({
        ...offer,
        id: `${offer.id}~v${index + 1}`,
        name: product.name || `${offer.name} ${index + 1}`,
        imageUrl: product.ref,
        imagePack: [],
        members: [],
      }));
      gesture = null;
      mutate((doc) => ({
        ...doc,
        offers: [
          ...doc.offers
            .filter((entry) => !entry.id.startsWith(`${offerId}~v`))
            .map((entry) => (entry.id === offerId
              ? { ...entry, imagePack: children.map((child) => child.imageUrl!), members: children.map((child) => child.id) }
              : entry)),
          ...children,
        ],
      }));
      set({ busy: null, note: `${count(children.length, 'vare', 'varer')} fundet i billedet — stiller dem op` });
      await get().standUpOneCluster(offerId);
    },

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

    setDrawer: (drawer) => set({ drawer }),

    async refreshUploads() {
      const { brandId } = get();
      if (!brandId) return;
      try {
        set({ uploads: await api.fetchUploads(brandId) });
      } catch {
        // A drawer that cannot be listed is not worth interrupting
        // anyone over; the next upload refreshes it.
      }
    },

    async addToLibrary(file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} i biblioteket…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);
        set({ busy: null, note: `${file.name} lagt i biblioteket`, drawer: 'billeder' });
        await get().refreshUploads();
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async removeFromLibrary(ref) {
      const { brandId } = get();
      if (!brandId) return;
      try {
        await api.forgetUpload(brandId, ref);
        set({ uploads: get().uploads.filter((entry) => entry.ref !== ref) });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    placeFromLibrary(pageId, ref, hvor) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !page) return;
      const picture = get().uploads.find((entry) => entry.ref === ref);
      const subject = picture?.name.replace(/\.[a-z0-9]+$/i, '') ?? '';

      gesture = null;

      if (hvor === 'baggrund') {
        /*
         * Under the whole sheet, with the same reading the upload path
         * does — see `chooseBackdrop`. A picture out of the drawer is
         * the same picture it was when it was dropped, so it deserves
         * the same judgement about fit and strength rather than the
         * flat guess the drawer would otherwise apply.
         *
         * Measured from the file on disk, which is same-origin here,
         * so the canvas will hand back its pixels. Failing that it
         * lands as it always did and the sliders are one click away.
         */
        void (async () => {
          const measured = await measureBackdrop(
            await fetch(ref).then((r) => r.blob()).then((b) => new File([b], subject)),
          ).catch(() => null);
          const chosen = measured
            ? chooseBackdrop(measured, brand?.pageAspect ?? 0.707)
            : { fit: 'cover' as const, opacity: 1, focusX: 50, focusY: 50, why: '' };
          mutate((doc) => ({
            ...doc,
            pages: doc.pages.map((entry) => (entry.id === pageId
              ? {
                ...entry,
                background: {
                  imageUrl: ref,
                  subject,
                  fit: chosen.fit,
                  opacity: chosen.opacity,
                  focusX: chosen.focusX,
                  focusY: chosen.focusY,
                },
              }
              : entry)),
          }));
          set({
            note: [`${subject} lagt bag siden`, chosen.why].filter(Boolean).join(' · '),
          });
        })();
        return;
      }

      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? {
            ...entry,
            // Capped at three by the schema — see `addPageImage`.
            decorations: [...entry.decorations, {
              id: `img-${Date.now().toString(36)}`,
              imageUrl: ref,
              subject,
              offerId: null,
              anchor: 'bottom-right' as DecorAnchor,
              scale: 0.26,
              rotate: 0,
              opacity: 1,
              offsetX: 0,
              offsetY: 0,
              flip: false,
              front: false,
            }].slice(-3),
          }
          : entry)),
      }));
      set({ note: `${subject} lagt på siden` });
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
                flip: false,
                front: false,
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
      const { brandId, brand } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} bag siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        /*
         * Measured before it is uploaded, off the file itself.
         *
         * Every upload used to land as `cover` at full strength,
         * centred — a guess, and the wrong one for the commonest file
         * there is: a square graphic, which an A4 sheet then crops by
         * 29 % on each side. See `chooseBackdrop`, which decides the
         * four settings from the picture and says why.
         */
        const measured = await measureBackdrop(file);
        const chosen = measured
          ? chooseBackdrop(measured, brand?.pageAspect ?? 0.707)
          : { fit: 'cover' as const, opacity: 1, focusX: 50, focusY: 50, why: '' };

        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({
          busy: null,
          // What was chosen AND why, because a setting that arrives
          // without a reason is the guess this replaced.
          note: [`${file.name} lagt bag siden`, chosen.why].filter(Boolean).join(' · '),
        });
        mutate((document) => ({
          ...document,
          pages: document.pages.map((page) => (page.id === pageId
            ? {
              ...page,
              background: {
                imageUrl: url,
                subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
                fit: chosen.fit,
                opacity: chosen.opacity,
                focusX: chosen.focusX,
                focusY: chosen.focusY,
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

    spreadBackground(pageId, reach) {
      const { document } = get();
      const from = document?.pages.find((page) => page.id === pageId);
      if (!document || !from?.background) return;

      const at = document.pages.findIndex((page) => page.id === pageId);
      const backdrop = from.background;
      let touched = 0;

      gesture = null;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((page, index) => {
          if (page.id === pageId) return page;
          // An image page's `background` is its own artwork, not a
          // decoration under a grid — see the note on the action.
          if (page.kind === 'image') return page;
          if (reach === 'resten' && index <= at) return page;
          touched += 1;
          return { ...page, background: { ...backdrop } };
        }),
      }));

      set({
        note: touched === 0
          ? 'Ingen andre sider at lægge den under'
          : `Baggrunden lagt under ${count(touched, 'side mere', 'sider mere')}`,
      });
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

    placedAt() {
      const { document } = get();
      const where = new Map<string, string>();
      if (!document) return where;
      document.pages.forEach((page, index) => {
        const said = `s. ${index + 1}`;
        for (const placement of page.placements) {
          where.set(placement.offerId, said);
          /*
           * And everything the tile is showing inside that placement.
           *
           * A cluster names one assembled offer; the products it
           * photographs are members of it, and they are as printed as
           * anything with a cell of its own. `benched` knows this —
           * see the note there — and a library that did not would go
           * on offering a product that is already on page two.
           */
          const offer = document.offers.find((entry) => entry.id === placement.offerId);
          for (const member of offer?.members ?? []) where.set(member, said);
        }
      });
      return where;
    },

    toggleLibraryPick(offerId) {
      // Already on a page: there is nothing to pick. The card says
      // where it is instead, and clicking it goes there.
      if (get().placedAt().has(offerId)) return;
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

      /*
       * Nothing that is already printed somewhere.
       *
       * The cell-level check was here from the start; the book-level
       * one was not, so a product on page one could be dealt onto page
       * three and the avis would print it twice. The library no longer
       * lets one be ticked — see `toggleLibraryPick` — and this is the
       * same rule at the place that actually seats them, so no other
       * caller can get round it.
       */
      const already = get().placedAt();
      const wanted = [...new Set(offerIds)].filter((id) => !already.has(id));
      if (wanted.length === 0) {
        const where = [...new Set(offerIds.map((id) => already.get(id)).filter(Boolean))];
        set({
          error: offerIds.length === 1
            ? `Varen ligger allerede på ${where[0] ?? 'en side'}`
            : `Varerne ligger allerede i avisen (${where.join(', ')})`,
        });
        return;
      }

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
      /*
       * Picked order, stylesheet arrangement, the group's own name.
       *
       * All three used to be the model's and are now the defaults the
       * drop lands with — `settleGroup` improves on them afterwards if
       * it can. Kept as variables because the compose path still
       * names the image model in `by`.
       */
      const seated = picked;
      const arrangement: TileArrangement | null = null;
      let by: string | null = null;

      /*
       * The model no longer stands between the products and the cell.
       *
       * It used to: fifteen seconds of "Modellen sætter varerne
       * sammen…" with the whole toolbar greyed out, in front of an
       * answer that is an order, one of four stylesheet arrangements
       * and two lines of Danish. None of the three is needed for the
       * products to be in the cell and print — the pick order is an
       * order, the stylesheet has a default, and the tile has the name
       * `groupOffers` gave it.
       *
       * So the drop is instant and free, and the model's opinion is
       * fetched behind it and applied when it lands — see
       * `settleGroup`, which writes nothing over anything the editor
       * has touched in the meantime.
       */
      void cell;

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
          // Same beat as `setTileImage`: a path the dev server has
          // never served answers 404 for a moment, and a tile that
          // names it shows a broken image until the next reload.
          if (!await reachable(drawn.url)) {
            throw new Error(`${drawn.url} kunne ikke hentes igen`);
          }
          assembled = { ...assembled, imageUrl: drawn.url, imagePack: [] };
          by = drawn.model;
        } catch (error) {
          set({ busy: null, error: message(error) });
          return;
        }
        set({ busy: null });
      }

      /*
       * A placement with nothing decided on it yet.
       *
       * The heading and the arrangement are written onto the PLACEMENT
       * rather than into the offer, the same way every other hand
       * correction is: the assembled record keeps the feed's own
       * facts, and the page keeps what somebody decided to print.
       * `settleGroup` fills them in a moment later, and so can a
       * person — whichever comes first wins.
       */
      const overrides: PlacementOverrides = { ...FRESH, arrangement };

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
            by ? `sat op af ${by}` : '',
          ].filter(Boolean).join(' · '),
      });

      /*
       * The model's opinion, fetched behind the finished tile.
       *
       * Not awaited and never load-bearing: the cell is filled, the
       * page prints, and if this never comes back the tile keeps the
       * order it was picked in. Skipped for a composed tile, whose
       * pack is one photograph, and for the compose path, where the
       * placement call decides the positions a moment later and only
       * the wording is worth having.
       */
      if (seated.length > 1 && !options.compose) {
        void settleGroup(pageId, slotId, assembled.id, options.arrange !== false);
      }
    },

    async composeSlot(pageId, slotId, offerIds) {
      /*
       * The cutouts, started before anything else.
       *
       * The arrangement cannot begin until the cell holds the products
       * AND the page has drawn them — see below — and that is two
       * writes, a render and a frame during which nothing at all is
       * being fetched. The pictures are the slowest part that does not
       * need any of it: they are somebody else's image service, one
       * request per product.
       *
       * Fired and dropped. `fetchImages` holds the PROMISE for ten
       * minutes, not just the answer, so the real call a moment later
       * joins this one rather than starting a second — see `cached` in
       * @incitio/decor. A failure here is not reported and must not
       * be: the call that needs it will fail again, with the tile in
       * front of the person reading it.
       */
      const warming = get().brandId;
      if (warming) {
        const pool = [...get().feedOffers, ...(get().document?.offers ?? [])];
        const chosen = offerIds
          .map((id) => pool.find((offer) => offer.id === id))
          .filter((offer): offer is Offer => Boolean(offer));
        if (chosen.length > 1) {
          void api.prepareCluster(warming, { offers: chosen }).catch(() => undefined);
        }
      }

      /*
       * Group first, with no model involved.
       *
       * The cell has to hold the products, and the page has to have
       * DRAWN them, before anything can be measured: the arithmetic
       * that moves a cutout reads where it currently stands from the
       * browser — see `standUpCluster`. So this is not an optimisation
       * step that could be folded into the next one; it is what makes
       * the next one possible.
       */
      /*
       * Seated with no model at all.
       *
       * The arrangement call decides three things — the order, one of
       * four stylesheet arrangements, and the two Danish lines the
       * tile prints — and the placement that follows a moment later
       * overwrites every position it chose. So the wait for it is
       * fifteen seconds of spinner in front of an answer nobody sees.
       * The wording is the part worth having, and it is fetched
       * BESIDE the placement rather than in front of it.
       */
      await get().fillSlot(pageId, slotId, offerIds, { arrange: false });

      const placed = pageById(pageId)?.placements.find((entry) => entry.slotId === slotId);
      if (!placed) return;

      // Not awaited: the two lines land when they land, and the
      // arrangement is already under way.
      void settleGroup(pageId, slotId, placed.offerId, false);

      /*
       * One paint before measuring.
       *
       * `fillSlot` has only just written the document; React has not
       * yet put the new tile on the page, and measuring a tile that
       * is not there yet reports "flisen skal være synlig på siden".
       *
       * A frame OR a tick, whichever comes first, and the tick is not
       * a belt-and-braces: `requestAnimationFrame` does not fire in a
       * tab that is not being drawn. Measured — in a background tab
       * this awaited forever, and the button looked like it had done
       * nothing at all.
       */
      await Promise.race([
        new Promise((ready) => { requestAnimationFrame(() => ready(null)); }),
        new Promise((ready) => { setTimeout(ready, 60); }),
      ]);

      /*
       * Quietly: the products are already in the cell and the page
       * already prints. What follows improves the arrangement, and
       * the editor should be able to go on working while it does.
       */
      await standUpOn(
        (get().document?.pages ?? []).filter((page) => page.id === pageId),
        placed.offerId,
        true,
      );
    },

    async testCluster() {
      const { brandId } = get();
      if (!brandId) return;

      // A draft first, when there is nothing to put a tile on. The
      // plain one: no model, no key, instant.
      if (!get().document) {
        if (!get().feed) {
          set({ error: 'der er intet feed at bygge af' });
          return;
        }
        await get().build({ fresh: true });
      }

      const document = get().document;
      const page = document?.pages.find((entry) => entry.kind === 'offers');
      if (!document || !page) return;

      const slot = get().pageSlots(page.id)[0];
      if (!slot) {
        set({ error: 'siden har ingen pladser' });
        return;
      }

      /*
       * Three products with photographs, out of ONE family.
       *
       * The family part is not tidiness. A tile holding washing
       * powder, a pizza and a beer is three offers that happen to
       * share a cell, and `notOnePhotograph` refuses it — rightly, and
       * measured: the first version of this button took the first
       * three products in the feed and was turned down every other
       * press. So the first category that can field a group is the
       * one it picks.
       */
      const usable = [...get().feedOffers, ...document.offers]
        .filter((offer) => offer.imageUrl && offer.members.length === 0);
      const families = new Map<string, Offer[]>();
      for (const offer of usable) {
        const family = offer.category || 'uden kategori';
        families.set(family, [...(families.get(family) ?? []), offer]);
      }
      const picked = [...families.values()]
        .map((group) => group.slice(0, 3))
        .find((group) => group.length >= 2 && !notOnePhotograph(group));
      if (!picked) {
        set({ error: 'ingen varegruppe har to varer med billede, der kan være ét fotografi' });
        return;
      }

      set({ activePageId: page.id });
      await get().composeSlot(page.id, slot.slotId, picked.map((offer) => offer.id));
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
      /*
       * The one that named fifteen catalogues "Hentet udgivelse".
       *
       * The link says nothing about which week it is — it is a
       * publication id — so without asking there is genuinely nothing
       * to call the result. Asked here, the name is sent along and the
       * document arrives already knowing what it is.
       */
      if (askingWeek(() => void get().importPublication())) return;
      const week = get().week;

      set({ busy: 'Henter udgivelsen…', error: null, note: null });
      try {
        const pages = pageNumbers(publicationPages);
        const reply = await api.importPublication(brandId, {
          url: publicationUrl.trim(),
          withOffers: get().publicationWithOffers,
          ...(pages.length > 0 ? { pages } : {}),
          ...(week ? { name: weekName(get().brand?.name ?? brandId, week) } : {}),
        });

        /*
         * Appending keeps the open catalogue's id and name, exactly as
         * a rebuild does: adding six pages to an avis is the same avis.
         */
        const base = publicationAppend ? get().document : null;
        const document = base
          ? withWeek(mergeCatalogDocuments(
            [base, reply.document], { id: base.id, name: base.name },
          ))
          : forWeek(reply.document);

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
          // Done: the panel that asked for the link has nothing left to
          // say, and it was covering the pages that just arrived.
          panel: null,
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
      // Two model calls a page. The week is cheaper to ask for first.
      if (askingWeek(() => void get().generateLayout())) return;

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
          ? withWeek(mergeCatalogDocuments(
            [base, reply.document], { id: base.id, name: base.name },
          ))
          : forWeek(reply.document);
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
        (offer) => !placed.has(offer.id) && !shown.has(offer.id) && !isVariantPiece(offer.id),
      );
    },

    setPageTemplate(pageId, templateId) {
      const { brand } = get();
      const next = brand ? resolveTemplate(brand, templateId) : null;
      if (!brand || !next) return;
      gesture = null;
      mutate((document) => {
        const page = document.pages.find((entry) => entry.id === pageId);
        if (!page) return document;
        const seated = reseat(page, brand, next, document);
        // A page in its own style keeps it — see `fitLayout`.
        const fitted = next.id.startsWith('own/') ? null : fitLayout(document, brand, page, next, seated);
        return {
          ...document,
          templates: fitted
            ? [...document.templates.filter((t) => t.id !== fitted.template.id), fitted.template]
            : document.templates,
          pages: document.pages.map((entry) => (entry.id === pageId
            ? {
              ...entry,
              templateId: fitted?.template.id ?? next.id,
              placements: fitted?.placements ?? seated,
              ...(fitted ? { notes: fitted.notes, decorations: fitted.decorations } : {}),
            }
            : entry)),
        };
      });
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

    setPageCount(pageId, count, templateId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      if (!brand || !document || !page) return;
      // A specific layout, chosen from the gallery, when one was named.
      const chosen = templateId ? resolveTemplate(brand, templateId) : null;

      /*
       * A layout at the new count, preferring one whose shape is
       * closest to the current page's — a six-up that becomes a
       * three-up should not also swap its hero for a flat row unless
       * the brand has nothing else.
       */
      const options = templatesForCount(brand, count);
      const here = resolveTemplate(brand, page.templateId);
      const next = chosen
        ?? options.find((t) => t.slots[0]?.role === here?.slots[0]?.role) ?? options[0];
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

      mutate((doc) => {
        const seated = slots.map((slot, index) => {
            const offerId = offers[index]!;
            const before = kept.get(offerId);
            // An offer coming off the bench has no corrections yet;
            // one that was already here keeps the ones it has.
            return before
              ? {
                ...before,
                slotId: slot.id,
                overrides: carryOverrides(
                  before.overrides,
                  doc.offers.find((entry) => entry.id === offerId),
                  cellSize(brand, doc.templates, page.templateId, before.slotId),
                  cellSize(brand, [...doc.templates, next], next.id, slot.id),
                ),
              }
              : { offerId, slotId: slot.id, overrides: FRESH };
          });
        // A page in its own style keeps it — see `fitLayout`. The
        // corrections are already carried; fitting only moves the cells.
        const fitted = fitLayout(doc, brand, page, next, seated.map((placement) => {
          const before = kept.get(placement.offerId);
          return before ? { ...placement, overrides: before.overrides } : placement;
        }));
        return {
          ...doc,
          templates: fitted
            ? [...doc.templates.filter((t) => t.id !== fitted.template.id), fitted.template]
            : doc.templates,
          pages: doc.pages.map((p) => (p.id === pageId
            ? {
              ...p,
              templateId: fitted?.template.id ?? next.id,
              placements: fitted?.placements ?? seated,
              ...(fitted ? { notes: fitted.notes, decorations: fitted.decorations } : {}),
            }
            : p)),
        };
      });
    },

    applyLayout(pageId, template) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !brand || !page) return;
      // Known to the document before it is used — outside history: a
      // layout on the list is not an edit.
      if (!document.templates.some((t) => t.id === template.id)) {
        const next = { ...document, templates: [...document.templates, template] };
        set({ document: next, brand: withTemplates(brand, next.templates) });
      }
      if (template.slots.length === page.placements.length) get().setPageTemplate(pageId, template.id);
      else get().setPageCount(pageId, template.slots.length, template.id);
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
      set({ past: past.slice(0, -1), document: previous, future: [document, ...future], ...templatesFollow(document, previous) });
    },

    redo() {
      gesture = null;
      const { past, future, document } = get();
      const next = future[0];
      if (!next || !document) return;
      set({ past: [...past, document], document: next, future: future.slice(1), ...templatesFollow(document, next) });
    },
  };
});

/* ------------------------------------------- the work, kept in place */

/**
 * Where the open catalogue is parked between reloads.
 *
 * Per chain, because switching chain is switching document, and a
 * restored SuperBrugsen page on Netto's sheet would be nonsense.
 */
const WORK_KEY = (brandId: string) => `incitio.work.${brandId}`;

/**
 * How long after the last change the document is written down.
 *
 * Long enough that a drag is one write rather than sixty, short
 * enough that a reload two seconds after an edit still has it.
 */
const SAVE_AFTER_MS = 1500;

let saveTimer: number | undefined;

/**
 * Keep the open catalogue across a reload.
 *
 * Not a replacement for `Gem`, which puts a named catalogue in the
 * database and is what an editor keeps. This is the other thing: the
 * thing you are in the middle of. The studio reloads all day during a
 * session — Vite hot-reloads on every save, a stylesheet change, a
 * crash, a closed laptop — and every one of those used to mean
 * building the draft again, grouping the products again and running
 * the arrangement again before you were back where you were.
 *
 * In the browser and nowhere else: it is this machine's working
 * state, it never travels, and `Gem` is still the thing that shares
 * it.
 */
useStudio.subscribe((state, before) => {
  if (state.document === before.document) return;
  const { brandId, document } = state;
  if (!brandId) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      if (document) {
        window.localStorage.setItem(
          WORK_KEY(brandId),
          JSON.stringify({ at: new Date().toISOString(), document }),
        );
      } else {
        window.localStorage.removeItem(WORK_KEY(brandId));
      }
    } catch {
      /*
       * Out of room, or private browsing. Nothing to do and nothing
       * to say: the catalogue is on screen and `Gem` still works.
       */
    }
  }, SAVE_AFTER_MS);
});

/** What was parked for this chain, if anything still parses. */
export function parkedWork(brandId: string): { at: string; document: CatalogDocument } | null {
  try {
    const raw = window.localStorage.getItem(WORK_KEY(brandId));
    if (!raw) return null;
    const said = JSON.parse(raw) as { at?: unknown; document?: unknown };
    const parsed = CatalogDocumentSchema.safeParse(said.document);
    if (!parsed.success) return null;
    return {
      at: typeof said.at === 'string' ? said.at : '',
      document: parsed.data,
    };
  } catch {
    return null;
  }
}

/*
 * Nothing throws the parked work away on purpose, and nothing needs
 * to: every way of starting something else — a fresh draft, an
 * imported publication, a saved catalogue opened — replaces the
 * document, and the subscription above writes the new one over the
 * old within a second and a half.
 */
