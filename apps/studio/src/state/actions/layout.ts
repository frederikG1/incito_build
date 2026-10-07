import { mergeCatalogDocuments, slotAssignmentOrder } from '@incitio/schema';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import * as api from '../../api.js';
import { type PageRun, count, type StudioState } from '../model.js';
import { message, withTemplates } from '../cluster.js';
import { benchOf, onTemplate, atCount, pageInLayout } from '../layout.js';
import type { StoreContext } from '../context.js';

/** Skabeloner, sidetal, fokus og fortryd/gentag. */
export function layoutActions(ctx: StoreContext): Pick<StudioState, 'setLayoutCells' | 'setLayoutNote' | 'setLayoutAppend' | 'generateLayout' | 'benched' | 'setPageTemplate' | 'shufflePage' | 'setPageCount' | 'applyLayout' | 'focusOffer' | 'undo' | 'redo'> {
  const { set, get, replacing, mutate, templatesFollow, askingWeek, forWeek, withWeek, live } = ctx;
  return {
    setLayoutCells: (cells) => set({ layoutCells: cells }),
    setLayoutNote: (note) => set({ layoutNote: note }),
    setLayoutAppend: (append) => set({ layoutAppend: append }),

    async generateLayout() {
      const { brandId, feed, layoutCells, layoutNote, layoutAppend } = get();
      if (!brandId || !feed) return;
      // Two model calls a page. The week is cheaper to ask for first.
      if (askingWeek(() => void get().generateLayout())) return;

      const base = layoutAppend ? get().document : null;
      const before = get().document?.pages.length ? get().document : null;
      const spent = base ? base.offers.map((offer) => offer.id) : [];

      set({ busy: 'AI tegner et layout…', error: null, note: null });
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
          ...replacing(before),
          activePageId: landed?.id ?? null,
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedText: null,
          layoutAppend: true,
          busy: null,
          note: [
            'Layout tegnet og fyldt',
            `${((reply.drawnInMs + reply.elapsedMs) / 1000).toFixed(0)} sek.`,
            reply.rejected > 0 ? `${reply.rejected} ${reply.rejected === 1 ? 'plads er tom' : 'pladser er tomme'}` : '',
          ].filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    benched() {
      const { document } = get();
      return document ? benchOf(document) : [];
    },

    setPageTemplate(pageId, templateId) {
      const { brand } = get();
      const next = brand ? resolveTemplate(brand, templateId) : null;
      if (!brand || !next) return;
      live.gesture = null;
      mutate((document) => onTemplate(document, brand, pageId, next));
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
      if (!brand || !document) return;
      // A specific layout, chosen from the gallery, when one was named.
      const chosen = (templateId ? resolveTemplate(brand, templateId) : null) ?? null;
      const next = atCount(document, brand, pageId, count, chosen);
      if (next === document) return;
      live.gesture = null;
      mutate(() => next);
    },

    applyLayout(pageId, template) {
      const { document, brand } = get();
      if (!document || !brand) return;
      const next = pageInLayout(document, brand, pageId, template);
      if (!next) return;
      live.gesture = null;
      mutate(() => next);
    },

    focusOffer(pageId, offerId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      const template = brand && page ? resolveTemplate(brand, page.templateId) : null;
      if (!page || !template) return;

      const lead = slotAssignmentOrder(template)[0];
      const here = page.placements.find((p) => p.offerId === offerId);
      if (!lead || !here || here.slotId === lead.id) return;

      live.gesture = null;
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
      live.gesture = null;
      const { past, future, document } = get();
      const previous = past[past.length - 1];
      if (!previous || !document) return;
      set({
        past: past.slice(0, -1), document: previous, future: [document, ...future], ...templatesFollow(document, previous),
        // Undoing a new week goes back to last week's week, not only its pages.
        ...(previous.week ? { week: previous.week } : {}),
      });
    },

    redo() {
      live.gesture = null;
      const { past, future, document } = get();
      const next = future[0];
      if (!next || !document) return;
      set({
        past: [...past, document], document: next, future: future.slice(1), ...templatesFollow(document, next),
        ...(next.week ? { week: next.week } : {}),
      });
    },
  };
}
