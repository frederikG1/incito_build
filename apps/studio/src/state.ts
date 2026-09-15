import { create } from 'zustand';
import type {
  Brand, CatalogDocument, CatalogPage, DecorAnchor, Offer, PageBackground, PageDecoration,
  PageTemplate,
  Placement, PartOverride, PlacementOverrides, TilePart,
} from '@incitio/schema';
import {
  mergeCatalogDocuments, partLimits, partOverride, partPatch, slotAssignmentOrder,
} from '@incitio/schema';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import * as api from './api.js';

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
 */
export const MAX_REFERENCE_PAGES = 24;

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
  maxPages: number;

  /** Undo history of whole documents. Small, and the editor is small. */
  past: CatalogDocument[];
  future: CatalogDocument[];

  start: () => Promise<void>;
  signInAs: (brandId: string) => Promise<void>;
  uploadFeed: (name: string, text: string) => void;
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

  select: (offerId: string | null) => void;
  /** Arm a picture for dragging, or put it back down. */
  selectDecor: (decorId: string | null) => void;
  selectPart: (part: TilePart | null) => void;
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
  movePage: (pageId: string, delta: number) => void;
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

/** A placement nobody has corrected yet. */
const FRESH: PlacementOverrides = {
  pinned: false,
  displayName: null,
  description: null,
  imageScale: 1,
  imageOffsetX: 0,
  imageOffsetY: 0,
  parts: {},
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

  /** One placement's corrections, or undefined if it is not on a page. */
  function overridesOf(offerId: string) {
    return get().document?.pages
      .flatMap((page) => page.placements)
      .find((placement) => placement.offerId === offerId)
      ?.overrides;
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
    selectedOfferId: null,
    selectedDecorId: null,
    selectedPart: null,
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
        selectedOfferId: null,
        selectedPart: null,
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
         * The chain's default reader is the first source, and its
         * sample is only a convenience so the editor opens with
         * something on screen. A chain with no shipped sample simply
         * starts empty and waits for an upload.
         */
        const sample = profile.sources.find((source) => source.path);
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
      } catch (error) {
        set({ busy: null, brandId, error: message(error) });
      }
    },

    uploadFeed(name, text) {
      set({ feed: { text, source: name }, note: `Indlæste ${name}`, error: null });
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
          selectedOfferId: null,
          selectedPart: null,
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
          selectedOfferId: null,
          selectedPart: null,
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
          added.push({
            id: `ref-${Date.now().toString(36)}-${added.length}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            base64: toBase64(bytes),
            // Read from the bytes, not the name: what matters is
            // whether a page has to be picked out of it.
            isPdf: String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-',
            pages: '1',
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
            selectedOfferId: null,
            selectedPart: null,
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
        ? { selectedOfferId: offerId, selectedDecorId: null }
        : { selectedOfferId: offerId, selectedPart: null, selectedDecorId: null },
    ),

    selectDecor: (decorId) => set({
      selectedDecorId: decorId,
      ...(decorId ? { selectedOfferId: null, selectedPart: null } : {}),
    }),

    selectPart: (part) => set({ selectedPart: part }),

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
        imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, parts: {},
      });
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

    benched() {
      const { document } = get();
      if (!document) return [];
      const placed = new Set(document.pages.flatMap((p) => p.placements).map((p) => p.offerId));
      return document.offers.filter((offer) => !placed.has(offer.id));
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
