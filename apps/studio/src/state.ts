import { create } from 'zustand';
import type { Brand, CatalogDocument, PlacementOverrides } from '@incitio/schema';
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
  swapPlacements: (
    from: { pageId: string; slotId: string },
    to: { pageId: string; slotId: string },
  ) => void;
  setMaxPages: (pages: number) => void;
  setBrief: (brief: string) => void;
  updateOverrides: (offerId: string, patch: Partial<PlacementOverrides>) => void;
  movePage: (pageId: string, delta: number) => void;
  setPageTitle: (pageId: string, title: string) => void;
  undo: () => void;
  redo: () => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useStudio = create<StudioState>((set, get) => {
  /** Push the current document onto the undo stack before mutating it. */
  function mutate(change: (document: CatalogDocument) => CatalogDocument): void {
    const { document, past } = get();
    if (!document) return;
    set({
      past: [...past.slice(-29), document],
      future: [],
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

    select: (offerId) => set({ selectedOfferId: offerId }),

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

    updateOverrides(offerId, patch) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => ({
          ...page,
          placements: page.placements.map((placement) =>
            placement.offerId === offerId
              ? { ...placement, overrides: { ...placement.overrides, ...patch } }
              : placement),
        })),
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

    setPageTitle(pageId, title) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, title } : page)),
      }));
    },

    undo() {
      const { past, future, document } = get();
      const previous = past[past.length - 1];
      if (!previous || !document) return;
      set({ past: past.slice(0, -1), document: previous, future: [document, ...future] });
    },

    redo() {
      const { past, future, document } = get();
      const next = future[0];
      if (!next || !document) return;
      set({ past: [...past, document], document: next, future: future.slice(1) });
    },
  };
});
