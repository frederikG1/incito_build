import type { CatalogDocument } from '@incitio/schema';
import { healLabelPrices } from '@incitio/schema';
import * as api from '../../api.js';
import { feedDiff } from '@incitio/compose';
import { BRAND_KEY, rememberedBrand, count, type StudioState } from '../model.js';
import { message, remembered } from '../cluster.js';
import { work, rememberStamp, markWork, workWasSaved, scheduleAutosave, parkedWork } from '../saving.js';
import type { StoreContext } from '../context.js';

/** Start, feed, bygning, gem, historik og PDF — avisen som fil. */
export function catalogueActions(ctx: StoreContext): Pick<StudioState, 'start' | 'signInAs' | 'uploadFeed' | 'build' | 'save' | 'persist' | 'setHistoryOpen' | 'restoreVersion' | 'resolveConflict' | 'refreshCatalogues' | 'openCatalogue' | 'downloadPdf'> {
  const { set, get, loadFeed, mutate, askingWeek, forWeek, live } = ctx;
  return {
    async start(asked) {
      /*
       * Patient on the way in. The API restarts whenever its code
       * changes, and a studio opened in those few seconds came up as an
       * empty avis and an error — which reads as lost work. It waits,
       * and says it is waiting, before it gives up.
       */
      for (let attempt = 0; ; attempt += 1) {
        try {
          if (attempt > 0) set({ busy: 'Starter op…', error: null });
          const brands = await api.fetchBrands();
          set({ brands, busy: null });
          const remembered = rememberedBrand();
          const chosen = brands.find((b) => b.id === asked)
            ?? brands.find((b) => b.id === remembered)
            ?? brands[0];
          if (chosen) await get().signInAs(chosen.id);
          if (get().brand || attempt >= 8) return;
        } catch (error) {
          if (attempt >= 8) {
            set({ busy: null, error: `Kunne ikke nå API-serveren — kør \`npm run dev:api\`. (${message(error)})` });
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
        // The previous chain's designs, rules and themes are not this chain's.
        designEditing: null,
        rulesOpen: false,
        themesOpen: false,
        sectionsOpen: false,
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
        sections: [],
        feedArrival: null,
        feedChanges: null,
        carryReport: null,
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
        void api.fetchThemes(brandId).then((themes) => { if (get().brandId === brandId) set({ themes }); }).catch(() => undefined);
        const parked = parkedWork(brandId);
        // Read before the restore below: putting the parked avis on screen marks it as changed.
        const parkedWasSaved = workWasSaved(brandId);
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
            ? {
              document: healLabelPrices(parked.document).document,
              // The parked avis's own week, as opening it would set —
              // otherwise the bar names one week and the checks another.
              ...(parked.document.week ? { week: parked.document.week } : {}),
              past: [],
              future: [],
            }
            : {}),
          // Back where you were, without saying so: the pages on screen say it.
          busy: null,
        });
        /*
         * The chain's lists, now that it IS the chain: asked for before
         * `brandId` was set they came back as the previous chain's —
         * its avisers on this chain's front page, its sections and uploads.
         */
        void get().refreshCatalogues();
        void get().refreshUploads();
        void get().refreshSections();
        // Nothing to come back to: the chain's front page, not an empty book.
        if (!get().document) set({ view: 'hjem', openPageId: null });
        /*
         * Parked but already saved: the server's copy is the same work or
         * newer — a colleague may have saved since. Open that, rather than
         * treating an old copy in this browser as unsaved changes.
         */
        if (parked && get().document?.id === parked.document.id && parkedWasSaved) {
          work.clean = { document: get().document, base: null };
          void get().openCatalogue(parked.document.id);
        }
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

      /*
       * A file arriving over an open avis is one of two things, and only
       * the person knows which: Wednesday's corrections to this week, or
       * next week's products. Both answers are prepared here, and the
       * banner over the book asks.
       */
      const { document, feedOffers } = get();
      /*
       * Asked over any avis with cells — also one whose cells are still
       * empty, as a picture-only publication's are when it arrives: the
       * file is then plainly for filling them.
       */
      const placed = document?.pages.some((page) => page.placements.length > 0 || page.kind === 'offers');
      if (document && placed && feedOffers.length > 0) {
        const diff = feedDiff(document, feedOffers);
        /*
         * Measured on what the PAGES show, not on everything the avis
         * carries: the question is whether the products a shopper would
         * see are in this file. An import brings a hundred products that
         * never reached a page, and counting them made a different
         * leaflet look like a third of a match.
         */
        const shown = new Set<string>();
        const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
        for (const placement of document.pages.flatMap((page) => page.placements)) {
          const offer = byId.get(placement.offerId);
          for (const id of offer?.members.length ? offer.members : [placement.offerId]) shown.add(id);
        }
        const onPages = shown.size;
        set({
          feedArrival: {
            name,
            diff,
            count: feedOffers.length,
            onPages,
            matched: Math.max(0, onPages - diff.removed.length),
          },
          view: 'bog',
          openPageId: null,
        });
      }
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
        const current = options.append ? get().variantBase ?? get().document : null;
        const placed = current ? current.pages.flatMap((page) => page.placements.map((p) => p.offerId)) : [];
        const reply = await api.buildCatalogue(brandId, {
          feed: feed.text,
          maxPages,
          skipCuration: true,
          ...(placed.length > 0 ? { exclude: placed } : {}),
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

        if (current) {
          // Add, never replace: the new pages go after the last one, with their own ids and layouts.
          const stamp = Date.now().toString(36);
          const knownOffers = new Set(current.offers.map((offer) => offer.id));
          const knownTemplates = new Set(current.templates.map((template) => template.id));
          const fresh = reply.document.pages.map((page, index) => ({ ...page, id: `${current.id}-n${stamp}-${index + 1}` }));
          const added = {
            ...current,
            pages: [...current.pages, ...fresh],
            offers: [...current.offers, ...reply.document.offers.filter((offer) => !knownOffers.has(offer.id))],
            templates: [...current.templates, ...reply.document.templates.filter((t) => !knownTemplates.has(t.id))],
          };
          mutate(() => added);
          set({
            busy: null,
            activePageId: fresh[0]?.id ?? get().activePageId,
            note: `${count(fresh.length, 'ny side', 'nye sider')} med ${reply.document.offers.length} varer, der ikke stod i avisen`,
          });
          return;
        }

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
      // ⌘S and the button: a named point in the history, saved now.
      window.clearTimeout(work.autosaveTimer);
      if (await get().persist('manuel')) set({ note: 'Gemt' });
      await get().refreshCatalogues();
    },

    async persist(label, force = false) {
      const { brandId } = get();
      const document = get().storedDocument();
      if (!brandId || !document) return false;
      // One save at a time: a second waits for the first, then saves what is on screen then.
      while (work.saving) await work.saving;
      const snapshot = { document: get().document, base: get().variantBase };
      const stored = get().storedDocument() ?? document;
      set({ saveState: 'saving' });
      let done: () => void = () => {};
      work.saving = new Promise<void>((resolve) => { done = resolve; });
      try {
        const expected = force ? undefined : get().serverStamps[stored.id];
        const { updatedAt, workflow, kept } = await api.saveCatalogue(brandId, stored, label, expected, force);
        const moved = get().document !== snapshot.document || get().variantBase !== snapshot.base;
        work.clean = snapshot;
        /*
         * The server kept its own signatures, sold places, log or status
         * over the ones this screen held (an old tab, an undo, a restored
         * version): the screen takes the server's, quietly — they are
         * changed in the Godkend, Pladser and Live screens, not by saving.
         */
        if (kept.length) {
          const own = (doc: CatalogDocument | null) => (doc && doc.id === stored.id ? { ...doc, ...workflow } : doc);
          // What was saved and what is on screen both take them; an edit made while saving stays unsaved.
          work.clean = snapshot.base ? { document: snapshot.document, base: own(snapshot.base) } : { document: own(snapshot.document), base: null };
          if (get().variantBase) set({ variantBase: moved ? own(get().variantBase) : work.clean.base });
          else set({ document: moved ? own(get().document) : work.clean.document });
        }
        rememberStamp(stored.id, updatedAt);
        set({
          serverStamps: { ...get().serverStamps, [stored.id]: updatedAt },
          savedAt: updatedAt,
          saveState: moved ? 'dirty' : 'saved',
          ...(get().variantBase ? { variantBase: get().variantBase } : {}),
        });
        if (moved) scheduleAutosave();
        else markWork(brandId, true);
        return true;
      } catch (error) {
        if (error instanceof api.SaveConflict) {
          set({ saveState: 'conflict' });
          return false;
        }
        // Refused for a reason — a sold place, a price — that trying again will not change.
        if (error instanceof api.SaveRefused) {
          set({ saveState: 'failed', error: `Ikke gemt: ${error.message}. Fortryd ændringen (⌘Z) eller ret den.` });
          return false;
        }
        // Offline or the server restarting: said quietly, and tried again.
        set({ saveState: 'failed' });
        scheduleAutosave(15000);
        return false;
      } finally {
        work.saving = null;
        done();
      }
    },

    setHistoryOpen: (historyOpen) => set({ historyOpen }),

    async restoreVersion(version) {
      const { brandId } = get();
      get().openVariant(null);
      const current = get().document;
      if (!brandId || !current) return;
      set({ busy: 'Henter den tidligere udgave…', error: null });
      try {
        const earlier = await api.fetchVersion(brandId, current.id, version);
        live.gesture = null;
        mutate(() => ({ ...earlier, updatedAt: current.updatedAt }));
        set({ busy: null, historyOpen: false });
        window.clearTimeout(work.autosaveTimer);
        await get().persist(`gendannet fra ${version}`);
        set({ note: `Udgave ${version} er tilbage — ⌘Z fortryder` });
        get().refreshFindings();
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async resolveConflict(keep) {
      const { brandId } = get();
      const current = get().storedDocument();
      if (!brandId || !current) return;
      if (keep === 'mine') {
        if (await get().persist('manuel', true)) set({ note: 'Din udgave er gemt — kollegaens ligger i historikken' });
        return;
      }
      get().openVariant(null);
      const mine = get().document;
      await get().openCatalogue(current.id);
      // Yours one undo step back — ⌘Z brings it back if theirs was the wrong choice.
      if (mine && get().document?.id === mine.id) set({ past: [mine] });
      set({ note: 'Kollegaens udgave er åbnet — ⌘Z henter din tilbage' });
    },

    async refreshCatalogues() {
      const { brandId } = get();
      if (!brandId) return;
      try {
        const catalogues = await api.fetchCatalogues(brandId);
        // An answer for a chain somebody has since switched away from is not this chain's list.
        if (get().brandId === brandId) set({ catalogues });
      } catch {
        // A list that cannot be read is not worth interrupting anyone
        // over; the editor works without it and the next save retries.
      }
    },

    async openCatalogue(id) {
      const { brandId } = get();
      if (!brandId || !id) return;
      // Two opens in flight (a link, and the parked avis coming back): the last one asked wins.
      const ticket = ++live.opening;
      set({ busy: 'Åbner…', error: null, note: null });
      try {
        const stored = await api.fetchCatalogue(brandId, id);
        if (ticket !== live.opening || get().brandId !== brandId) return;
        if (!stored) {
          set({ busy: null, error: 'Den avis findes ikke længere' });
          return;
        }
        // Prices an older publication import filed under the name — see
        // `healLabelPrices`. Healed on open, saved with the next save.
        const { document, healed } = healLabelPrices(stored);
        work.clean = { document, base: null };
        markWork(brandId, true);
        set({
          document,
          serverStamps: rememberStamp(stored.id, stored.updatedAt),
          savedAt: stored.updatedAt,
          saveState: 'saved',
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
          note: `Åbnede ${document.name} · ${count(document.pages.length, 'side', 'sider')}`
            + (healed ? ` · ${count(healed, 'pris', 'priser')} hentet ud af varenavnene` : ''),
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
    async downloadPdf(forPrint = false) {
      const { brandId, variantId } = get();
      const document = get().storedDocument();
      if (!brandId || !document) return;
      set({ busy: forPrint ? 'Printer tryk-PDF med beskæring…' : 'Printer PDF…', error: null });
      try {
        window.clearTimeout(work.autosaveTimer);
        if (!await get().persist(forPrint ? 'til tryk' : 'før print')) {
          set({
            busy: null,
            error: get().saveState === 'conflict'
              ? 'Avisen er gemt af en anden imens — vælg hvilken udgave der gælder, før du printer.'
              : 'Avisen kunne ikke gemmes, så PDF\'en ville vise den gamle udgave. Prøv igen om lidt.',
          });
          return;
        }
        // The open edition prints as that store's; the server works it out from the base just saved.
        const blob = await api.fetchCataloguePdf(brandId, document.id, forPrint, variantId);
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${document.id}${variantId ? `-${variantId}` : ''}${forPrint ? '-tryk' : ''}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        set({
          busy: null,
          note: forPrint ? 'Tryk-PDF hentet · 3 mm beskæring og skæremærker' : 'PDF hentet',
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },
  };
}
