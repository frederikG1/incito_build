import { applyOps, newVariant, recordVariant, resolveVariant } from '@incitio/edit/core';
import type { CatalogDocument } from '@incitio/schema';
import { mergeCatalogDocuments, withTheme } from '@incitio/schema';
import { APPROVAL_ROLE_NAMES } from '@incitio/schema';
import { weekName, OfferFeed } from '@incitio/schema';
import * as api from '../../api.js';
import { BASE_EDITION, feedToEdition, mergeEditionFeeds, splitMergedFeed } from '@incitio/compose';
import { pageNumbers, count, type StudioState } from '../model.js';
import { message, cellCount, withTemplates } from '../cluster.js';
import { feedWeek } from '../layout.js';
import { work, rememberStamp, WORK_KEY } from '../saving.js';
import type { StoreContext } from '../context.js';

/** Udgivelser, udgaver, godkendelse, live og priser. */
export function editionsActions(ctx: StoreContext): Pick<StudioState, 'setPublicationUrl' | 'setPublicationPages' | 'setPublicationAppend' | 'setPublicationWithOffers' | 'importPublication' | 'storedDocument' | 'openVariant' | 'addVariant' | 'openEditions' | 'openBoard' | 'approve' | 'unapprove' | 'bookSlot' | 'releaseSlot' | 'liveChange' | 'publish' | 'unpublish' | 'workflowAct' | 'openHome' | 'setCatalogueMeta' | 'deleteCatalogue' | 'startWeek' | 'setMustInclude' | 'setIgnored' | 'openGoods' | 'setEditionFeed' | 'loadMergedFeed' | 'setVariantStores' | 'downloadMergedFeed' | 'removeVariant' | 'applyEdits' | 'setOfferPrice' | 'correctPrice' | 'uncorrectPrice'> {
  const { set, get, replacing, mutate, askingWeek, forWeek, withWeek, live } = ctx;
  return {
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
        const before = get().document?.pages.length ? get().document : null;
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
          ...replacing(before),
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
            reply.publication.paged
              ? (reply.publication.known ? 'varer og pladser fra Tjek' : `${cellCount(document)} pladser fundet i billederne`)
              : '',
          ].filter(Boolean).join(' · '),
        });
        // A catalogue from another chain than the one being worked in is
        // most likely a mistake — said, not refused.
        const chain = reply.publication.title?.trim();
        const mine = get().brand?.name ?? '';
        if (chain && mine && !chain.toLowerCase().includes(mine.split(/\s+/)[0]!.toLowerCase())
          && !mine.toLowerCase().includes(chain.toLowerCase())) {
          set({ error: `Udgivelsen er fra ${chain}, men du arbejder i ${mine} — skift kæde øverst, hvis det ikke var meningen.` });
        }
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    storedDocument() {
      const { brand, document, variantBase, variantId } = get();
      if (!document || !variantBase || !variantId || !brand) return document;
      const variant = (variantBase.variants ?? []).find((v) => v.id === variantId);
      if (!variant) return variantBase;
      const { variant: recorded, unrepresented } = recordVariant(variantBase, variant, document, brand);
      /*
       * What an edition cannot hold — artwork moved, products shuffled
       * inside a cluster — is said out loud at the moment it is lost,
       * never discarded quietly. Deferred: this runs during render too.
       */
      const fresh = unrepresented.filter((line) => !get().variantNotes.includes(line));
      if (fresh.length > 0) {
        window.setTimeout(() => set({
          variantNotes: [...get().variantNotes, ...fresh],
          error: `${variant.name} kan ikke gemme ${count(fresh.length, 'ændring', 'ændringer')}: ${fresh.join('; ')}. `
            + 'Lav den slags på "Alle butikker".',
        }), 0);
      }
      return {
        ...variantBase,
        variants: (variantBase.variants ?? []).map((v) => (v.id === variantId ? recorded : v)),
      };
    },

    openVariant(variantId) {
      const { brand } = get();
      const base = get().storedDocument();
      if (!brand || !base || variantId === get().variantId) return;
      live.gesture = null;
      if (!variantId) {
        set({ document: base, variantBase: null, variantId: null, variantNotes: [], past: [], future: [] });
        return;
      }
      const resolved = resolveVariant(base, variantId, brand);
      // Recorded before anything is edited, so what could not be said is known now.
      const unsaid = recordVariant(base, resolved.variant, resolved.document, brand).unrepresented;
      set({
        document: resolved.document,
        variantBase: base,
        variantId,
        variantNotes: [...resolved.conflicts, ...unsaid],
        past: [],
        future: [],
      });
    },

    addVariant(name) {
      const base = get().storedDocument();
      if (!base || !name.trim()) return;
      const variant = newVariant(base, name.trim());
      const withIt = { ...base, variants: [...(base.variants ?? []), variant] };
      if (get().variantBase) set({ variantBase: withIt });
      else set({ document: withIt });
      get().openVariant(variant.id);
    },

    openEditions() {
      // The list is of the base and its editions, so no edition is open behind it.
      get().openVariant(null);
      set({ view: 'udgaver', openPageId: null, addPagesOpen: false });
    },

    openBoard(view) {
      get().openVariant(null);
      set({ view, openPageId: null, addPagesOpen: false });
      get().refreshFindings();
    },

    async approve(role, who) {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.approveCatalogue(brandId, id, { role, who: who.trim(), updatedAt }),
        `${APPROVAL_ROLE_NAMES[role]} har godkendt avisen`,
      );
    },

    async unapprove(role) {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.unapproveCatalogue(brandId, id, role, updatedAt),
        `${APPROVAL_ROLE_NAMES[role]}s godkendelse er trukket tilbage`,
      );
    },

    async bookSlot(booking) {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.bookPlace(brandId, id, { ...booking, updatedAt }),
        `Pladsen er solgt til ${booking.supplier} og låst`,
      );
    },

    async releaseSlot(bookingId) {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.releasePlace(brandId, id, bookingId, updatedAt),
        'Pladsen er frigivet',
      );
    },

    async liveChange(event) {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.sendLiveChange(brandId, id, {
          kind: event.kind, offerId: event.offerId, substituteId: event.substituteId, after: event.after, who: event.who, updatedAt,
        }),
        null,
        // A live change is logged on the server; undoing the pages here would leave the log saying otherwise.
        true,
      );
    },

    async publish(who = '') {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.publishCatalogue(brandId, id, { who, updatedAt }),
        'Avisen er udgivet. Ændringer herfra er live-ændringer.',
      );
    },

    async unpublish(who = '') {
      await get().workflowAct(
        (brandId, id, updatedAt) => api.unpublishCatalogue(brandId, id, { who, updatedAt }),
        'Avisen er trukket tilbage. Den skal udgives igen for at blive vist.',
      );
    },

    /*
     * One workflow act: what is on screen saved first, so the act is
     * about the avis as seen; the act done by the server, which checks
     * it; and the avis it answers with taken as the one on screen.
     */
    async workflowAct(run, note, forgetUndo = false) {
      get().openVariant(null);
      const { brandId } = get();
      const open = get().document;
      if (!brandId || !open) return;
      live.gesture = null;
      window.clearTimeout(work.autosaveTimer);
      if (work.clean.document !== open && !(await get().persist('auto'))) {
        set({ error: 'Avisen kunne ikke gemmes først — prøv igen' });
        return;
      }
      const stamp = get().serverStamps[open.id];
      if (!stamp) { set({ error: 'Avisen er ikke gemt endnu' }); return; }
      set({ busy: 'Gemmer…', error: null });
      try {
        const saved = await run(brandId, open.id, stamp);
        const own = (doc: CatalogDocument): CatalogDocument => (doc.id !== saved.id ? doc : {
          ...doc, approvals: saved.approvals, bookings: saved.bookings, live: saved.live, status: saved.status,
        });
        work.clean = { document: saved, base: null };
        set({
          busy: null,
          document: saved,
          past: forgetUndo ? [] : get().past.map(own),
          future: forgetUndo ? [] : get().future.map(own),
          serverStamps: rememberStamp(saved.id, saved.updatedAt),
          savedAt: saved.updatedAt,
          saveState: 'saved',
          ...(note ? { note } : {}),
        });
        get().refreshFindings();
        void get().refreshCatalogues();
      } catch (error) {
        if (error instanceof api.SaveConflict) set({ busy: null, saveState: 'conflict' });
        else set({ busy: null, error: message(error) });
      }
    },

    openHome() {
      void get().refreshCatalogues();
      set({ view: 'hjem', openPageId: null, addPagesOpen: false, historyOpen: false });
    },

    async setCatalogueMeta(id, patch) {
      const { brandId } = get();
      if (!brandId) return;
      const open = (get().variantBase ?? get().document)?.id === id;
      if (open) {
        get().openVariant(null);
        live.gesture = null;
        mutate((doc) => ({ ...doc, ...patch }));
        window.clearTimeout(work.autosaveTimer);
        await get().persist(patch.name ? 'omdøbt' : `status ${patch.status}`);
      } else {
        try {
          const { updatedAt } = await api.patchCatalogue(brandId, id, patch);
          set({ serverStamps: rememberStamp(id, updatedAt) });
        } catch (error) {
          set({ error: message(error) });
          return;
        }
      }
      await get().refreshCatalogues();
    },

    async deleteCatalogue(id) {
      const { brandId } = get();
      if (!brandId) return;
      const open = (get().variantBase ?? get().document)?.id === id;
      try {
        await api.deleteCatalogue(brandId, id);
      } catch (error) {
        set({ error: message(error) });
        return;
      }
      if (open) {
        /*
         * Closed without a save: the autosave and the copy parked in the
         * browser would otherwise write the avis straight back.
         */
        window.clearTimeout(work.autosaveTimer);
        work.clean = { document: null, base: null };
        try { window.localStorage.removeItem(WORK_KEY(brandId)); } catch { /* private window */ }
        set({
          document: null, variantBase: null, variantId: null, variantNotes: [], past: [], future: [],
          openPageId: null, activePageId: null, selectedOfferId: null, view: 'hjem', saveState: 'saved',
        });
      }
      await get().refreshCatalogues();
      set({ note: 'Avisen er slettet' });
    },

    async startWeek(fromId, file, week, themeId) {
      const text = await file.text();
      /*
       * A file whose dates are another week's is said, not refused: the
       * avis is for the week that was chosen, and a file for it can be
       * read in later under Varer. Planning three weeks out is normal.
       */
      const mentionOtherWeek = () => {
        const said = feedWeek(get().feedOffers);
        if (!said || (said.year === week.year && said.week === week.week)) return;
        set({ note: `Uge ${week.week} er lavet med varer fra ${file.name}, som er uge ${said.week}s — hent uge ${week.week}s varefil under Varer, når den er klar.` });
      };
      if (fromId) {
        await get().openCatalogue(fromId);
        if (get().document?.id !== fromId) return;
        await get().uploadFeed(file.name, text);
        if (get().feedOffers.length === 0) return;
        set({ week, feedArrival: null });
        // The new week, from last week's pages: see `carryWeek` and the report it leaves.
        // Made for the week asked for, whatever the file's dates say — planning weeks ahead
        // often means building on a file that is not that week's yet.
        get().carryWeek(week);
        /*
         * Chosen up front: last week's theme comes off, this week's goes on
         * — or none, when asked. Part of the new week, not a step of its
         * own, so the report's one "Fortryd" takes both back.
         */
        mentionOtherWeek();
        if (themeId !== undefined) {
          const theme = themeId ? get().themes.find((entry) => entry.id === themeId) ?? null : null;
          const carried = get().document;
          if (carried && (theme || themeId === null)) set({ document: withTheme(carried, theme) });
        }
        return;
      }
      // From the bottom: the week's products, then straight to the chain's sections to pick pages from.
      get().startOver();
      set({ week });
      await get().uploadFeed(file.name, text);
      if (get().feedOffers.length === 0) return;
      set({ view: 'bog', note: null });
      mentionOtherWeek();
      // To the chain's sections when it has any; with none, the empty avis offers the other ways in.
      if (get().sections.length > 0) get().setSectionsOpen(true, 0);
    },

    setMustInclude(offerIds, on) {
      get().openVariant(null);
      live.gesture = null;
      mutate((doc) => {
        const now = new Set(doc.mustInclude ?? []);
        for (const id of offerIds) { if (on) now.add(id); else now.delete(id); }
        return { ...doc, mustInclude: [...now] };
      });
      get().refreshFindings();
    },

    setIgnored(findingIds, on) {
      get().openVariant(null);
      live.gesture = null;
      mutate((doc) => {
        const now = new Set(doc.ignored ?? []);
        for (const id of findingIds) { if (on) now.add(id); else now.delete(id); }
        return { ...doc, ignored: [...now] };
      });
      get().refreshFindings();
    },

    openGoods() {
      set({ view: 'varer', openPageId: null, addPagesOpen: false });
    },

    async setEditionFeed(variantId, name, text) {
      const { brandId, brand } = get();
      get().openVariant(null);
      if (!brandId || !brand || !get().document?.variants?.some((v) => v.id === variantId)) return;
      set({ busy: 'Læser udgavens feed…', error: null });
      try {
        const reading = await api.readFeed(brandId, text, name);
        const base = get().document!;
        const { variant, diff, unrepresented } = feedToEdition(
          base, variantId, { name, readAt: new Date().toISOString(), offers: reading.offers }, brand,
        );
        mutate((document) => ({
          ...document,
          variants: (document.variants ?? []).map((v) => (v.id === variantId ? variant : v)),
        }));
        set({
          busy: null,
          note: [
            `${variant.name}: ${count(reading.offers.length, 'vare', 'varer')}`,
            diff.changed.length ? count(diff.changed.length, 'anden pris', 'andre priser') : '',
            diff.removed.length ? `${diff.removed.length} taget af siderne` : '',
            diff.added.length ? `${diff.added.length} egne varer` : '',
          ].filter(Boolean).join(' · '),
          ...(unrepresented.length
            ? { error: `${variant.name} kan ikke holde ${count(unrepresented.length, 'ændring', 'ændringer')}: ${unrepresented.slice(0, 6).join('; ')}${unrepresented.length > 6 ? ' …' : ''}` }
            : {}),
        });
      } catch (error) {
        set({ busy: null, error: `${name} kunne ikke læses: ${message(error)}` });
      }
    },

    async loadMergedFeed(name, text) {
      const { brand } = get();
      get().openVariant(null);
      if (!brand || !get().document) return;
      let feed: OfferFeed;
      try {
        feed = OfferFeed.parse(JSON.parse(text));
      } catch {
        set({ error: `${name} er ikke et samlet feed (Incitios eget format med udgaver).` });
        return;
      }
      if (!feed.editions?.length) {
        set({ error: `${name} har ingen udgaver — læg det ind som ugens feed i stedet.` });
        return;
      }
      const lists = splitMergedFeed(feed);
      let document = get().document!;
      const made: string[] = [];
      for (const edition of feed.editions) {
        if (edition.id === BASE_EDITION) continue;
        if (!document.variants?.some((v) => v.id === edition.id)) {
          const fresh = { ...newVariant(document, edition.name, edition.stores), id: edition.id };
          document = { ...document, variants: [...(document.variants ?? []), fresh] };
        }
        document = {
          ...document,
          variants: document.variants!.map((v) => (v.id === edition.id
            ? feedToEdition(document, v.id, { name, readAt: new Date().toISOString(), offers: lists.get(edition.id) ?? [] }, brand).variant
            : v)),
        };
        made.push(edition.name);
      }
      mutate(() => document);
      set({ note: `${name}: ${made.length} udgaver lagt ind — ${made.join(', ')}` });
    },

    setVariantStores(variantId, stores) {
      get().openVariant(null);
      mutate((document) => ({
        ...document,
        variants: (document.variants ?? []).map((v) => (v.id === variantId ? { ...v, stores } : v)),
      }));
    },

    downloadMergedFeed() {
      const base = get().storedDocument();
      const { brandId, feedOffers } = get();
      if (!base || !brandId) return;
      const offers = feedOffers.length ? feedOffers : base.offers.filter((offer) => offer.members.length === 0);
      const merged = mergeEditionFeeds(brandId, offers, (base.variants ?? []).map((v) => ({
        id: v.id, name: v.name, stores: v.stores, offers: v.feed?.offers ?? null,
      })));
      const url = URL.createObjectURL(new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' }));
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${base.id}-samlet-feed.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      set({ note: `Samlet feed: ${count(merged.offers.length, 'række', 'rækker')} til ${count(merged.editions!.length, 'udgave', 'udgaver')}` });
    },

    removeVariant(variantId) {
      const base = get().storedDocument();
      if (!base) return;
      const without = { ...base, variants: (base.variants ?? []).filter((v) => v.id !== variantId) };
      if (get().variantId === variantId) {
        set({ document: without, variantBase: null, variantId: null, variantNotes: [], past: [], future: [] });
      } else if (get().variantBase) {
        set({ variantBase: without });
      } else {
        set({ document: without });
      }
    },

    applyEdits(ops) {
      const { brand, document } = get();
      if (!brand || !document) return 'ingen avis åben';
      let result: ReturnType<typeof applyOps>;
      try {
        result = applyOps(document, ops, brand);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      live.gesture = null;
      mutate(() => result.document);
      get().refreshFindings();
      return null;
    },

    setOfferPrice(offerId, price) {
      if (!Number.isFinite(price) || price < 0 || price > 100000) return;
      mutate((doc) => ({
        ...doc,
        offers: doc.offers.map((offer) => (offer.id === offerId ? { ...offer, price } : offer)),
      }), `price-${offerId}`);
      get().refreshFindings();
    },

    correctPrice(offerId, patch) {
      if (patch.price !== undefined && (!Number.isFinite(patch.price) || patch.price < 0 || patch.price > 100000)) return;
      if (patch.prePrice !== undefined && patch.prePrice !== null && (!Number.isFinite(patch.prePrice) || patch.prePrice < 0)) return;
      mutate((doc) => ({
        ...doc,
        offers: doc.offers.map((offer) => {
          if (offer.id !== offerId) return offer;
          const corrected = offer.corrected ?? { price: offer.price, prePrice: offer.prePrice };
          const next = { ...offer, ...patch };
          // Typed back to what the feed said: nothing is corrected any more.
          const same = next.price === corrected.price && next.prePrice === corrected.prePrice;
          if (same) {
            const { corrected: _gone, ...rest } = next;
            return rest;
          }
          return { ...next, corrected };
        }),
      }), `price-${offerId}`);
      get().refreshFindings();
    },

    uncorrectPrice(offerId) {
      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        offers: doc.offers.map((offer) => {
          if (offer.id !== offerId || !offer.corrected) return offer;
          const { corrected, ...rest } = offer;
          return { ...rest, price: corrected.price, prePrice: corrected.prePrice };
        }),
      }));
      get().refreshFindings();
    },
  };
}
