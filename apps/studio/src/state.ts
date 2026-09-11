import { create } from 'zustand';
import type {
  Brand, CatalogDocument, CatalogPage, Offer, PageTemplate, Placement,
  PartOverride, PlacementOverrides, TilePart,
} from '@incitio/schema';
import { partLimits, partOverride, partPatch, slotAssignmentOrder } from '@incitio/schema';
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

export interface StudioState {
  brands: api.BrandSummary[];
  brandId: string | null;
  brand: Brand | null;
  /** The formats this chain delivers; the first is the default. */
  sources: api.BrandSource[];
  feed: { text: string; source: string } | null;
  document: CatalogDocument | null;

  curationReady: boolean;
  busy: string | null;
  error: string | null;
  note: string | null;

  selectedOfferId: string | null;
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
  brief: string;

  /** Undo history of whole documents. Small, and the editor is small. */
  past: CatalogDocument[];
  future: CatalogDocument[];

  start: () => Promise<void>;
  signInAs: (brandId: string) => Promise<void>;
  uploadFeed: (name: string, text: string) => void;
  build: (options?: { skipCuration?: boolean; fresh?: boolean }) => Promise<void>;
  save: () => Promise<void>;
  downloadPdf: () => Promise<void>;

  select: (offerId: string | null) => void;
  selectPart: (part: TilePart | null) => void;
  swapPlacements: (
    from: { pageId: string; slotId: string },
    to: { pageId: string; slotId: string },
  ) => void;
  setMaxPages: (pages: number) => void;
  setBrief: (brief: string) => void;
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
  setPageTitle: (pageId: string, title: string) => void;
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
    curationReady: false,
    busy: null,
    error: null,
    note: null,
    selectedOfferId: null,
    selectedPart: null,
    maxPages: 6,
    brief: '',
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
        const [curationReady, text] = await Promise.all([
          api.fetchCurationStatus(brandId),
          sample?.path ? api.fetchFeed(sample.path) : Promise.resolve(null),
        ]);
        set({
          brandId,
          brand: profile.brand,
          sources: profile.sources,
          curationReady,
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
      const { brandId, feed, maxPages, brief } = get();
      if (!brandId || !feed) return;

      const skipCuration = options.skipCuration ?? false;
      set({
        busy: skipCuration ? 'Bygger…' : 'Claude planlægger siderne…',
        error: null,
        note: null,
      });

      try {
        const reply = await api.buildCatalogue(brandId, {
          feed: feed.text,
          maxPages,
          skipCuration,
          ...(brief.trim() ? { brief: brief.trim() } : {}),
          // A fresh seed on every click: pressing the button again is a
          // request for another take, and with a fixed seed the second
          // click returns the first click's pages.
          ...(options.fresh ? { seed: String(Date.now()) } : {}),
        });

        const notes = [
          reply.source.name,
          `${reply.document.pages.length} sider af ${reply.offerCount} tilbud`,
          reply.curated ? 'kurateret af Claude' : 'kategorisortering',
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

    /*
     * Choosing a tile drops whatever box was in hand.
     *
     * Carrying "the kilo price" across to the next tile means the first
     * arrow key after a click moves a line nobody was looking at. A new
     * tile starts on the tile itself, which is the artwork.
     */
    select: (offerId) => set(
      offerId === get().selectedOfferId
        ? { selectedOfferId: offerId }
        : { selectedOfferId: offerId, selectedPart: null },
    ),

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
    setBrief: (brief) => set({ brief }),

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

    setPageTitle(pageId, title) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, title } : page)),
      }));
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
