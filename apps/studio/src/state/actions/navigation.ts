import { weekName } from '@incitio/schema';
import { bySeverity, measureFindings, readFindings } from '../../findings.js';
import { applyQuickFix } from '../../quickfix.js';
import { measureInputs, standInPrices } from '@incitio/workflow';
import { priceRuleFindings } from '../../pricerules.js';
import { bookingFindings } from '../../inventory.js';
import { WEEK_KEY, type StudioState } from '../model.js';
import { CHECKS_KEY, remember } from '../cluster.js';
import type { StoreContext } from '../context.js';

/** Uge, visning, sider og fund: hvor man er, og hvad der skal ses. */
export function navigationActions(ctx: StoreContext): Pick<StudioState, 'setWeek' | 'clearScrollTo' | 'seePage' | 'openPage' | 'stepPage' | 'setBookView' | 'setAddPagesOpen' | 'setTrayFilter' | 'togglePanel' | 'closePanel' | 'closeAskWeek' | 'setWeekOnly' | 'setFindingsOpen' | 'refreshFindings' | 'goToOffer' | 'quickFix' | 'goToFinding'> {
  const { set, get, mutate, mustFindings, changeFindings, live } = ctx;
  return {
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
      const { untouched, crowding } = measureInputs(document);
      const measured = document
        ? measureFindings(window.document, document.pages.map((page) => page.id), untouched, crowding)
        : [];
      /*
       * A print check someone let go is still on the list, but as worth
       * a look rather than a stop — so the toolbar's count, the page
       * marks and the list agree with the server's publish. The price
       * rules and sold places are added after and are never let go.
       */
      const ignored = new Set(document?.ignored ?? []);
      const print = [...read, ...measured, ...mustFindings()]
        .map((finding) => (ignored.has(finding.id) ? { ...finding, weight: 'se' as const } : finding));
      set({
        findings: [
          ...print, ...changeFindings(),
          // Price rules may be let go only while the history is a stand-in (see `priceStops`).
          ...priceRuleFindings(document).map((finding) => (standInPrices.demo && ignored.has(finding.id) ? { ...finding, weight: 'se' as const } : finding)),
          ...bookingFindings(document),
        ].sort(bySeverity),
      });
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

    quickFix(fix) {
      if (fix.kind === 'plads') {
        get().fillEmptySlots(fix.pageId);
      } else {
        live.gesture = null;
        mutate((doc) => applyQuickFix(doc, fix));
        const said = { uge: 'Datoerne er rettet', billede: 'Billedet er sat ind', førpris: fix.kind === 'førpris' && fix.prePrice === null ? 'Førprisen er fjernet' : 'Spar-beløbet er rettet' };
        set({ note: `${said[fix.kind]} · ⌘Z fortryder` });
      }
      get().refreshFindings();
    },

    goToFinding(finding) {
      // Stand at the page itself, not at its thumbnail in the book.
      if (finding.pageId && get().openPageId !== finding.pageId) {
        get().openPage(finding.pageId);
        window.setTimeout(() => get().goToFinding(finding), 350);
        return;
      }
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
      // A product that must be in the avis: Varer, showing just those, is where it gets a page.
      if (finding.kind === 'skalmed') set({ view: 'varer', openPageId: null, goodsShow: 'skalmed-mangler', findingsOpen: false });
    },
  };
}
