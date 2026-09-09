import { create } from 'zustand';
import { TemplateLibrary, type CatalogDocument, type Offer, type Theme } from '@incitio/schema';
import {
  ingestCsv,
  ingestJson,
  EMPTY_LABEL_DICTIONARY,
  type IngestIssue,
  type LabelDictionary,
} from '@incitio/ingest';
import {
  AUTHORED_LIBRARY,
  DEFAULT_MAX_OFFERS_PER_PAGE,
  checkPlacement,
  generateCatalog,
  selectOffers,
  solvePageCandidates,
  type Violation,
} from '@incitio/layout';
import {
  buildCatalog,
  detectFeed,
  RETAILERS,
  SAMPLE_RETAILER,
  type RetailerConfig,
} from '@incitio/pipeline';
import { createAutosave, fetchCatalog, fetchLabelDictionary, fetchMinedLibrary, fetchPlannerStatus, planPages } from './api.js';

const catalogIdFor = (retailerId: string) => `${retailerId}-1`;

interface EditResult {
  ok: boolean;
  violations: Violation[];
}

export type LibrarySource = 'house' | 'mined' | 'authored';

interface StudioState {
  offers: Map<string, Offer>;
  /** Raw feed text, kept so "generate again" re-runs the whole pipeline. */
  feedText: string | null;
  library: TemplateLibrary;
  librarySource: LibrarySource;
  /** Kept so the libraries can be compared without a reload. */
  minedLibrary: TemplateLibrary | null;
  /** Certification marks, resolved from feed label text at ingest. */
  labels: LabelDictionary;
  /** This retailer's own mined library, when it has one. */
  houseLibrary: TemplateLibrary | null;
  document: CatalogDocument | null;
  issues: IngestIssue[];
  unplaced: string[];
  notSelected: number;
  categoryMix: Record<string, number>;
  selectedOfferId: string | null;
  lastError: string | null;
  past: CatalogDocument[];
  future: CatalogDocument[];

  retailer: RetailerConfig;
  /** True while Claude is planning; drives the button's busy state. */
  planning: boolean;
  /** Whether the API has a key configured. */
  plannerReady: boolean;
  /** One line per page explaining why those offers belong together. */
  planReasoning: string[];
  /** Free-text direction sent to the planner. */
  brief: string;
  setBrief: (brief: string) => void;
  /** What happened to the last uploaded file. */
  uploadNote: string | null;
  uploadFeed: (filename: string, text: string) => void;
  loadSampleFeed: () => Promise<void>;
  generateWithAi: () => Promise<void>;
  setRetailer: (id: string) => Promise<void>;
  regenerate: () => void;
  setLibrarySource: (source: LibrarySource) => void;
  select: (offerId: string | null) => void;
  setTheme: (patch: Partial<Theme>) => void;

  swapPlacements: (a: SlotAddress, b: SlotAddress) => EditResult;
  promotePlacement: (address: SlotAddress) => EditResult;
  reshufflePage: (pageId: string) => void;
  movePage: (pageId: string, direction: -1 | 1) => void;

  undo: () => void;
  redo: () => void;
}

export interface SlotAddress {
  pageId: string;
  slotId: string;
}

/** Snapshot before every mutation; 50 deep is well past what anyone undoes. */
function pushHistory(state: StudioState, next: CatalogDocument): Partial<StudioState> {
  const past = state.document ? [...state.past, state.document].slice(-50) : state.past;
  const document = { ...next, updatedAt: new Date().toISOString() };
  persist(document);
  return { document, past, future: [] };
}

let autosave: ReturnType<typeof createAutosave> | null = null;

function persist(document: CatalogDocument | null): void {
  if (!document) return;
  autosave ??= createAutosave(600, (message) => useStudio.setState({ lastError: message }));
  autosave.schedule(document);
}

export const useStudio = create<StudioState>((set, get) => ({
  offers: new Map(),
  feedText: null,
  library: AUTHORED_LIBRARY,
  librarySource: 'authored',
  labels: EMPTY_LABEL_DICTIONARY,
  minedLibrary: null,
  houseLibrary: null,
  retailer: SAMPLE_RETAILER,
  planning: false,
  plannerReady: false,
  planReasoning: [],
  brief: '',
  uploadNote: null,
  document: null,
  issues: [],
  unplaced: [],
  notSelected: 0,
  categoryMix: {},
  selectedOfferId: null,
  lastError: null,
  past: [],
  future: [],

  async loadSampleFeed() {
    try {
      const { retailer } = get();
      const response = await fetch(retailer.feedPath);
      if (!response.ok) throw new Error(`feed request failed: ${response.status}`);
      const text = await response.text();

      // Marks have to be in hand BEFORE the first ingest: label artwork is
      // resolved during ingest and stored on the offer, and the renderer
      // draws offers from this map. Fetching the dictionary afterwards
      // leaves every tile showing label text with no mark until the next
      // regenerate.
      const labels = await fetchLabelDictionary();
      set({ labels });

      // Offers are always re-derived from the feed — the stored document
      // holds layout decisions, not product data, so the two can be
      // refreshed independently.
      const { feed, issues } =
        retailer.feedFormat === 'csv'
          ? ingestCsv(text, retailer.mapping, labels)
          : ingestJson(text, retailer.mapping, labels);
      set({
        feedText: text,
        offers: new Map(feed.offers.map((o) => [o.id, o])),
        issues,
        lastError: null,
      });

      // Templates mined from real catalogs, when the sidecar has produced
      // them. Falls back to the hand-authored set so the app still works on
      // a clean checkout with no harvest run.
      void fetchPlannerStatus().then((ready) => set({ plannerReady: ready }));

      const mined = await fetchMinedLibrary();
      if (mined) set({ minedLibrary: mined, library: mined, librarySource: 'mined' });

      // A retailer's own layouts beat the pooled average when it has them.
      const house = retailer.houseLibrary
        ? await fetchMinedLibrary(retailer.houseLibrary)
        : null;
      set({ houseLibrary: house });
      if (house) set({ library: house, librarySource: 'house' });

      const saved = await fetchCatalog(catalogIdFor(get().retailer.id));
      if (saved) set({ document: saved, unplaced: [], past: [], future: [] });
      else get().regenerate();
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
    }
  },

  regenerate() {
    const { feedText, library, document, retailer, labels } = get();
    if (!feedText) return;

    const { feed } =
      retailer.feedFormat === 'csv'
        ? ingestCsv(feedText, retailer.mapping, labels)
        : ingestJson(feedText, retailer.mapping, labels);

    const built = buildCatalog(feedText, retailer.feedFormat, retailer, {
      library,
      labels,
      catalogId: catalogIdFor(retailer.id),
      ...(retailer.targetOfferCount
        ? { selection: { targetCount: retailer.targetOfferCount } }
        : {}),
      ...(document ? { name: document.name } : {}),
    });
    // A tuned theme outlives regeneration, but only within one retailer —
    // carrying Coop's red onto nemlig's pages would be wrong.
    const keepTheme = document?.retailerId === retailer.id;
    const next = keepTheme && document
      ? { ...built.document, theme: document.theme }
      : built.document;

    persist(next);
    set({
      offers: new Map(feed.offers.map((o) => [o.id, o])),
      document: next,
      issues: built.issues,
      unplaced: built.unplaced,
      planReasoning: [],
      notSelected: built.notSelected.length,
      categoryMix: built.categoryMix,
      past: [],
      future: [],
    });
  },

  async setRetailer(id) {
    const retailer = RETAILERS[id];
    if (!retailer) return;
    set({ retailer, document: null, offers: new Map(), past: [], future: [] });
    await get().loadSampleFeed();
  },

  /**
   * Plan the pages with Claude, then lay them out.
   *
   * The model decides which offers share a page and which leads it; the
   * solver still owns every coordinate. Offers are selected first so the
   * model reasons about the catalog that will actually be printed rather
   * than the retailer's whole range.
   */
  async generateWithAi() {
    const { feedText, library, retailer, document, labels } = get();
    if (!feedText || get().planning) return;

    set({ planning: true, lastError: null });
    try {
      const { feed } =
        retailer.feedFormat === 'csv'
          ? ingestCsv(feedText, retailer.mapping, labels)
          : ingestJson(feedText, retailer.mapping, labels);

      const chosen = retailer.targetOfferCount
        ? selectOffers(feed.offers, { targetCount: retailer.targetOfferCount }).selected
        : feed.offers;

      const plan = await planPages(chosen, {
        offers: chosen,
        maxPerPage: DEFAULT_MAX_OFFERS_PER_PAGE,
        language: 'Danish',
        ...(get().brief.trim() ? { brief: get().brief.trim() } : {}),
      });

      const byId = new Map(chosen.map((o) => [o.id, o]));
      const groups = plan.groups
        .map((group) => ({
          title: group.title,
          subtitle: group.subtitle,
          offers: group.offerIds
            .map((id) => byId.get(id))
            .filter((o): o is Offer => o !== undefined),
        }))
        .filter((group) => group.offers.length > 0);

      const built = generateCatalog(chosen, {
        id: catalogIdFor(retailer.id),
        name: document?.name ?? retailer.displayName,
        retailerId: retailer.id,
        theme: document?.retailerId === retailer.id && document ? document.theme : retailer.theme,
        pageAspect: retailer.pageAspect,
        library,
        groups,
      });

      persist(built.document);
      set({
        offers: new Map(feed.offers.map((o) => [o.id, o])),
        document: built.document,
        unplaced: built.unplaced,
        planReasoning: plan.reasoning,
        past: [],
        future: [],
      });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ planning: false });
    }
  },

  setBrief(brief) {
    set({ brief });
  },

  /**
   * Take a feed the customer dropped in and build a catalog from it.
   *
   * The profile is detected from the file's field signature rather than
   * asked for: a retailer uploads the same shape every week, so making
   * them re-declare it each time is friction with no information in it.
   * A file that matches nothing says so instead of guessing.
   */
  uploadFeed(filename, text) {
    const detection = detectFeed(text, filename);
    if (!detection.retailer) {
      set({
        uploadNote: null,
        lastError:
          `${filename}: ${detection.reason}.` +
          (detection.fields.length
            ? ` Found: ${detection.fields.slice(0, 8).join(', ')}${detection.fields.length > 8 ? '…' : ''}`
            : ''),
      });
      return;
    }

    const retailer = detection.retailer;
    set({
      retailer,
      feedText: text,
      document: null,
      offers: new Map(),
      planReasoning: [],
      past: [],
      future: [],
      lastError: null,
      uploadNote: `${filename} — ${detection.reason}`,
    });

    // Load this retailer's own layouts before generating, so the first
    // render already carries its house style.
    void (async () => {
      const house = retailer.houseLibrary ? await fetchMinedLibrary(retailer.houseLibrary) : null;
      set({ houseLibrary: house });
      if (house) set({ library: house, librarySource: 'house' });
      get().regenerate();
    })();
  },

  setLibrarySource(source) {
    const { minedLibrary, houseLibrary } = get();
    const library =
      source === 'house' ? houseLibrary : source === 'mined' ? minedLibrary : AUTHORED_LIBRARY;
    if (!library) return;
    set({ library, librarySource: source });
    get().regenerate();
  },

  select(offerId) {
    set({ selectedOfferId: offerId });
  },

  setTheme(patch) {
    const { document } = get();
    if (!document) return;
    set((state) => pushHistory(state, { ...document, theme: { ...document.theme, ...patch } }));
  },

  /**
   * Exchanges the offers in two slots, which may live on different pages.
   * The move is rejected outright if either resulting placement would break
   * a hard constraint — the human can rearrange freely, but cannot produce
   * a page that is actually wrong.
   */
  swapPlacements(a, b) {
    const { document, offers, library } = get();
    if (!document) return { ok: false, violations: [] };
    if (a.pageId === b.pageId && a.slotId === b.slotId) return { ok: true, violations: [] };

    const pageA = document.pages.find((p) => p.id === a.pageId);
    const pageB = document.pages.find((p) => p.id === b.pageId);
    if (!pageA || !pageB) return { ok: false, violations: [] };

    const placementA = pageA.placements.find((p) => p.slotId === a.slotId);
    const placementB = pageB.placements.find((p) => p.slotId === b.slotId);
    if (!placementA || !placementB) return { ok: false, violations: [] };

    const templateA = library.templates.find((t) => t.id === pageA.templateId);
    const templateB = library.templates.find((t) => t.id === pageB.templateId);
    if (!templateA || !templateB) return { ok: false, violations: [] };

    const slotA = templateA.slots.find((s) => s.id === a.slotId);
    const slotB = templateB.slots.find((s) => s.id === b.slotId);
    const offerA = offers.get(placementA.offerId);
    const offerB = offers.get(placementB.offerId);
    if (!slotA || !slotB || !offerA || !offerB) return { ok: false, violations: [] };

    const violations = [
      ...checkPlacement(offerB, slotA, { template: templateA, profiles: new Map() }),
      ...checkPlacement(offerA, slotB, { template: templateB, profiles: new Map() }),
    ];
    if (violations.length > 0) return { ok: false, violations };

    // Both tiles are now human-authored, so the solver must leave them be.
    const pin = { pinned: true };
    const next: CatalogDocument = {
      ...document,
      pages: document.pages.map((page) => {
        if (page.id !== a.pageId && page.id !== b.pageId) return page;
        return {
          ...page,
          placements: page.placements.map((placement) => {
            if (page.id === a.pageId && placement.slotId === a.slotId) {
              return { ...placement, offerId: placementB.offerId, overrides: { ...placement.overrides, ...pin } };
            }
            if (page.id === b.pageId && placement.slotId === b.slotId) {
              return { ...placement, offerId: placementA.offerId, overrides: { ...placement.overrides, ...pin } };
            }
            return placement;
          }),
        };
      }),
    };

    set((state) => pushHistory(state, next));
    return { ok: true, violations: [] };
  },

  /**
   * "Make this bigger": moves an offer into one of its slot's declared
   * promotion targets and sends the displaced offer back the other way.
   * Resizing is expressed as a swap into a larger slot rather than free
   * geometry so the page can never end up with holes or overlaps.
   */
  promotePlacement(address) {
    const { document, library } = get();
    if (!document) return { ok: false, violations: [] };

    const page = document.pages.find((p) => p.id === address.pageId);
    const template = library.templates.find((t) => t.id === page?.templateId);
    const slot = template?.slots.find((s) => s.id === address.slotId);
    if (!page || !template || !slot || slot.promotesTo.length === 0) {
      return { ok: false, violations: [] };
    }

    for (const targetId of slot.promotesTo) {
      const result = get().swapPlacements(address, { pageId: page.id, slotId: targetId });
      if (result.ok) return result;
    }
    return { ok: false, violations: [] };
  },

  /** Re-solves a single page, honouring pins. "Try another layout". */
  reshufflePage(pageId) {
    const { document, offers, library } = get();
    if (!document) return;
    const page = document.pages.find((p) => p.id === pageId);
    if (!page) return;

    const pageOffers = page.placements
      .map((p) => offers.get(p.offerId))
      .filter((o): o is Offer => o !== undefined);

    const currentTemplate = page.templateId;
    const candidates = library.templates.filter(
      (t) => t.slots.length === page.placements.length,
    );
    if (candidates.length === 0) return;

    const solved = solvePageCandidates(pageOffers, candidates, { pageAspect: document.pageAspect });
    // Prefer a genuinely different template so the button visibly does something.
    const pick = solved.find((s) => s.templateId !== currentTemplate) ?? solved[0];
    if (!pick) return;

    const next: CatalogDocument = {
      ...document,
      pages: document.pages.map((p) =>
        p.id === pageId ? { ...p, templateId: pick.templateId, placements: pick.placements } : p,
      ),
    };
    set((state) => pushHistory(state, next));
  },

  movePage(pageId, direction) {
    const { document } = get();
    if (!document) return;
    const index = document.pages.findIndex((p) => p.id === pageId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= document.pages.length) return;

    const pages = [...document.pages];
    const [moved] = pages.splice(index, 1);
    if (!moved) return;
    pages.splice(target, 0, moved);
    set((state) => pushHistory(state, { ...document, pages }));
  },

  undo() {
    const { past, document } = get();
    const previous = past[past.length - 1];
    if (!previous || !document) return;
    persist(previous);
    set({ document: previous, past: past.slice(0, -1), future: [document, ...get().future] });
  },

  redo() {
    const { future, document } = get();
    const next = future[0];
    if (!next || !document) return;
    persist(next);
    set({ document: next, future: future.slice(1), past: [...get().past, document] });
  },
}));
