import { type EditOp } from '@incitio/edit/core';
import type { Brand, CatalogDocument, CatalogWeek, Offer, OfferDesign, OfferRule, PageBackground, PageDecoration, PageNote, PagePart, PageTemplate, PageTextOverride, PackOverride, PartOverride, PlacementOverrides, TilePart } from '@incitio/schema';
import { nextWeek, weekOf, type Theme } from '@incitio/schema';
import { type Finding } from '../findings.js';
import { type QuickFix } from '../quickfix.js';
import type { ApprovalRole, LiveEvent, SlotBooking } from '@incitio/schema';
import * as api from '../api.js';
import { type PlacePromptId } from '@incitio/curator/place-prompt';
import { type CarryReport, type FeedDiff } from '@incitio/compose';
import { type Ghost, type ClusterWay, type ClusterRun, type PromptRun } from './cluster.js';

/**
 * Which chain the user works for.
 *
 * Remembered across reloads because in the real product it is not a
 * choice at all — it comes from who signed in. Keeping it in one place
 * now means swapping the picker for a session is a change to this
 * constant and the toolbar, and nothing else.
 */
export const BRAND_KEY = 'incitio.brand';

export function rememberedBrand(): string | null {
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
export const WEEK_KEY = 'incitio.week';

export function rememberedWeek(): CatalogWeek | null {
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
/** The screens. `hjem` and `varedesigns` belong to the chain; the rest to the open avis. */
export type StudioView = 'hjem' | 'bog' | 'side' | 'udgaver' | 'varer' | 'pladser' | 'live' | 'godkend' | 'varedesigns';

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
  /**
   * Where saving stands. The avis is saved to the server as it is
   * worked on — a few seconds after the last change — so the question
   * "did I save?" never comes up; this says the answer.
   *
   * `conflict`: somebody else saved the same avis in between. Nothing
   * is overwritten until the person chooses — see `resolveConflict`.
   */
  saveState: 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';
  /** What the server last said each avis's `updatedAt` was — sent as `expected`. */
  serverStamps: Record<string, string>;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  /** An earlier version back on screen — one undo step, and saved as a version of its own. */
  restoreVersion: (version: number) => Promise<void>;
  /** After a conflict: take the colleague's version, or save this one over it. */
  resolveConflict: (keep: 'theirs' | 'mine') => Promise<void>;
  /**
   * Save to the server now, under `label` ("auto" for the automatic
   * ones). `force` skips the check that nobody else saved in between.
   * Resolves true when it was saved.
   */
  persist: (label: string, force?: boolean) => Promise<boolean>;
  /**
   * The edition on screen — a store's or a region's — or null for the
   * base, which is every edition at once. See `PublicationVariant`.
   *
   * While one is open, `document` is that edition, worked out from the
   * base, and `variantBase` holds the base. Edits land on the edition as
   * usual; switching away or saving records them as ops against the base.
   */
  variantId: string | null;
  variantBase: CatalogDocument | null;
  /** What the open edition could not carry: stale ops, edits the ops cannot say. */
  variantNotes: string[];
  openVariant: (variantId: string | null) => void;
  addVariant: (name: string) => void;
  removeVariant: (variantId: string) => void;
  /** The Udgaver screen: every edition, what it carries, and whether it matches its file. */
  openEditions: () => void;
  /** The Varer screen: the whole week's products, where they stand and what they lack. */
  openGoods: () => void;
  /** Which filter Varer opens on, when something sent you there. Read once. */
  goodsShow: string | null;
  /** Mark products as "skal med" in the open avis — or take the mark off. */
  setMustInclude: (offerIds: string[], on: boolean) => void;
  /** The front page: this week, next week, and everything before. */
  openHome: () => void;
  /** Pladser, Live or Godkend — the avis read as inventory, as a live feed, as a sign-off. */
  openBoard: (view: 'pladser' | 'live' | 'godkend') => void;
  /** Sign the avis off for one role, on what it is now. Saved as a named version. */
  approve: (role: ApprovalRole, who: string) => Promise<void>;
  /** Take a signature back. */
  unapprove: (role: ApprovalRole) => Promise<void>;
  /** Sell a place: recorded on the avis, and the tile in it locked so nothing automatic moves it. */
  bookSlot: (booking: Omit<SlotBooking, 'id' | 'at'>) => Promise<void>;
  /** Free a sold place. The tile stays where it is. */
  releaseSlot: (bookingId: string) => Promise<void>;
  /**
   * A change to an avis that is out: a product sold out (and what stands
   * in for it), a price changed, a product back. Applied to the pages and
   * logged, then saved as a named version so the published avis follows.
   */
  liveChange: (event: Omit<LiveEvent, 'id' | 'at'>) => Promise<void>;
  /** Publish — the server refuses unless every role has signed what is there and nothing stops it. */
  publish: (who?: string) => Promise<void>;
  /** Take a published avis back to "klar". Publishing again passes the same gate. */
  unpublish: (who?: string) => Promise<void>;
  /**
   * Run one workflow act on the server (sign, sell, publish, a live
   * change) and take the avis it answers with. The acts above are this.
   */
  workflowAct: (
    run: (brandId: string, id: string, updatedAt: string) => Promise<CatalogDocument>,
    note: string | null,
    forgetUndo?: boolean,
  ) => Promise<void>;
  /** Rename an avis or change its status — the open one by editing it, any other on the server. */
  setCatalogueMeta: (id: string, patch: { name?: string; status?: api.CatalogStatus }) => Promise<void>;
  /**
   * A new week's avis: last week's (`fromId`) carried onto the new week's
   * file, or — with no `fromId` — an empty one waiting for its pages.
   */
  startWeek: (fromId: string | null, file: File, week: CatalogWeek, themeId?: string | null) => Promise<void>;
  /** A store's or region's own file, read and written into its edition. Returns what it could not hold. */
  setEditionFeed: (variantId: string, name: string, text: string) => Promise<void>;
  /** A merged feed — the one the platform reads — back into its editions. */
  loadMergedFeed: (name: string, text: string) => Promise<void>;
  setVariantStores: (variantId: string, stores: string[]) => void;
  /** Every edition's file as the one feed the platform reads, as a download. */
  downloadMergedFeed: () => void;
  /** The document as it is stored: the base, with the open edition recorded into it. */
  storedDocument: () => CatalogDocument | null;
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
  /** Do what a finding's own fix says — see `quickfix.ts`. Undoable. */
  quickFix: (fix: QuickFix) => void;
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
  feedReading: { source: api.FeedReading['source']; withImage: number; health: api.FeedReading['health'] | null } | null;
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
   * Use the empty band under a page's products: stretch the cells into
   * it, or add rows of the page's own last row, filled from the reserve.
   * See `fill.ts`.
   */
  fillPage: (pageId: string, mode: 'grow' | 'more') => void;
  /** The page's places with no product in them, in the order they are dealt. */
  emptySlots: (pageId: string) => string[];
  /**
   * Fill a page's empty places from the reserve, by the page's own
   * department (or its section's tags), as a section is dealt. Undoable.
   */
  fillEmptySlots: (pageId: string) => void;
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

  /** Load the chains and sign in — as `brandId` when a link names one, else the chain used last. */
  start: (brandId?: string | null) => Promise<void>;
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
  /** `fresh` rebuilds the whole avis; `append` only adds pages for the products not placed yet. */
  build: (options?: { fresh?: boolean; append?: boolean }) => Promise<void>;
  save: () => Promise<void>;
  downloadPdf: (forPrint?: boolean) => Promise<void>;

  setReproduceOpen: (open: boolean) => void;
  setRulesOpen: (open: boolean) => void;
  /**
   * Varedesigns — the chain's offer designs, a page of their own (`view:
   * 'varedesigns'`, `#/<kæde>/varedesigns`). Opening it remembers where
   * you were, so the way back lands on the same page of the same avis.
   */
  setDesignsOpen: (open: boolean, how?: { designId?: string | null; fromRules?: boolean }) => void;
  /** The design open in the editor on that page; null is the list of them all. */
  designEditing: string | null;
  setDesignEditing: (designId: string | null) => void;
  /** Where Varedesigns was opened from, to go back to. */
  designsReturn: { view: StudioView; openPageId: string | null } | null;
  /** Opened from the rules, so its way back is to them. */
  designsFromRules: boolean;
  designsSaving: 'saved' | 'saving' | 'failed';
  /** The chain's offer designs and default tag, saved for the chain. */
  setOfferDesigns: (designs: OfferDesign[], tag: string | null) => void;
  /**
   * The chain's offer rules, changed. The pages redraw at once; the list
   * is saved for the chain a moment after the last change.
   */
  setOfferRules: (rules: OfferRule[]) => void;
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
  /** A product's price, corrected by hand — the page's price mark follows. */
  /**
   * Apply edit ops — the vocabulary the API, the CLI and the AI speak —
   * as ONE step on the undo stack. Returns why not, or null.
   */
  applyEdits: (ops: EditOp[]) => string | null;
  setOfferPrice: (offerId: string, price: number) => void;
  /**
   * Correct a price by hand — the price and the before-price. The feed's
   * own values are kept on the offer (`Offer.corrected`) the first time.
   */
  correctPrice: (offerId: string, patch: { price?: number; prePrice?: number | null }) => void;
  /** Back to what the feed said. */
  uncorrectPrice: (offerId: string) => void;

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

  /* ------------------------------------------------ the week, carried */

  /** The chain's saved page designs — the gallery the CMS calls Sections. */
  sections: api.Section[];
  sectionsOpen: boolean;
  /** The chain's themes — see `Theme`. */
  themes: Theme[];
  themesOpen: boolean;
  setThemesOpen: (open: boolean) => void;
  /** Save the chain's themes, whole. */
  saveThemes: (themes: Theme[]) => Promise<void>;
  /** The open avis in this theme, or in none. One undo step. */
  applyTheme: (themeId: string | null) => void;
  /** The chain's offer rules are open for editing — see `OfferRules`. */
  rulesOpen: boolean;
  /** Where saving the rules stands: written, on its way, or refused. */
  rulesSaving: 'saved' | 'saving' | 'failed';
  /** Where the gallery inserts: the index the new page will take. */
  sectionsAt: number;
  /** Open (or close) the gallery, optionally aimed at one place in the book. */
  setSectionsOpen: (open: boolean, at?: number) => void;
  setSectionsAt: (at: number) => void;
  refreshSections: () => Promise<void>;
  /** Keep this page's design for later weeks, under a name and tags. */
  /**
   * Save this page's design as a new version of the section it came from
   * — every other page made from that section can then take it.
   */
  updateSectionFromPage: (pageId: string) => Promise<void>;
  /** Give pages the newest version of their section's design, keeping their products. All behind pages when none are named. */
  pullSections: (pageIds?: string[]) => void;
  saveSection: (pageId: string, name: string, tags: string[]) => Promise<void>;
  /** Every page of the open avis as a section — how a library starts. */
  saveAllSections: () => Promise<void>;
  removeSection: (id: string) => Promise<void>;
  /** A section as a new page, its cells dealt from the reserve by tag. */
  insertSection: (id: string, at?: number, batch?: string) => void;
  /** Several sections at once, in the order given, from `at` on — one undo step. */
  insertSections: (ids: string[], at?: number) => void;
  /**
   * A feed arrived while an avis was open, and the two questions it
   * raises: is this a correction to THIS avis, or next week's file?
   */
  feedArrival: {
    name: string;
    diff: FeedDiff;
    count: number;
    /** Products on the pages, and how many of them the file also has. */
    onPages: number;
    matched: number;
  } | null;
  dismissFeedArrival: () => void;
  /** Write the new file's prices into the avis. Undoable. */
  applyFeedChanges: () => void;
  /** What the last applied feed changed, to be walked through. */
  feedChanges: FeedDiff | null;
  clearFeedChanges: () => void;
  /** Next week's avis, from this one's design and the new feed. */
  carryWeek: () => void;
  carryReport: (CarryReport & { from: string }) | null;
  dismissCarryReport: () => void;
  /** Let the last note go — the toast calls it when its time is up. */
  clearNote: () => void;
  /** Close the avis and start from nothing. The saved copy is untouched. */
  startOver: () => void;
  /** Take every product off a page and keep its design. Undoable. */
  clearPage: (pageId: string) => void;
  /** Print a published page as published, or redraw it with tiles to edit it. */
  setPageExact: (pageId: string, exact: boolean) => void;
  /** The element of a published page in hand — see `incitoBlocks`. */
  selectedIncito: { pageId: string; path: string } | null;
  selectIncito: (pageId: string, path: string | null) => void;
  /** Hide, show or reword one element of a published page. Undoable. */
  editIncito: (pageId: string, path: string, patch: { hidden?: boolean; texts?: string[] | null }, gesture?: string) => void;
  /** Take an element off a published page — with the shape behind it — or put it back. */
  hideIncito: (pageId: string, path: string, hidden: boolean) => void;
  /** Move or resize an element of a published page, in the sheet's points. Undoable. */
  moveIncito: (
    pageId: string,
    path: string,
    move: { dx?: number; dy?: number; absolute?: boolean } | { scaleBy: number } | { reset: true },
    gesture?: string,
  ) => void;
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

  /** The offer design tag a page's products are drawn in, unless a rule or the tile says otherwise. Null: the chain's. */
  setPageDesignTag: (pageId: string, tag: string | null) => void;
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
