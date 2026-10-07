import { applySection, sectionsBehind } from '@incitio/edit/core';
import type { Offer } from '@incitio/schema';
import { CatalogDocument as CatalogDocumentSchema, CatalogPage, slotAssignmentOrder } from '@incitio/schema';
import { rememberPrinted } from '@incitio/schema';
import { nextWeek, weekName, withTheme } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import * as api from '../../api.js';
import { DEPARTMENTS, DEPARTMENT_NAMES, applyFeedDiff, carryForward, type Department } from '@incitio/compose';
import { WEEK_KEY, count, type StudioState } from '../model.js';
import { message } from '../cluster.js';
import { sameAvis, rememberCells, sectionNaming, sectionOf, feedWeek } from '../layout.js';
import type { StoreContext } from '../context.js';
import { readCmsSectionDesigns, sectionTemplate } from '@incitio/cms/section-templates';

/** Sektioner, temaer og ugens feed lagt over sidste uges avis. */
export function sectionsActions(ctx: StoreContext): Pick<StudioState, 'setSectionsOpen' | 'setSectionsAt' | 'setThemesOpen' | 'saveThemes' | 'applyTheme' | 'refreshSections' | 'saveSection' | 'saveAllSections' | 'importCmsSections' | 'updateSectionFromPage' | 'pullSections' | 'removeSection' | 'insertSections' | 'insertSection' | 'dismissFeedArrival' | 'applyFeedChanges' | 'clearFeedChanges' | 'carryWeek' | 'dismissCarryReport' | 'clearNote' | 'startOver'> {
  const { set, get, reserveFor, mutate, clearUnderText, weekId, live } = ctx;
  return {
    setSectionsOpen: (sectionsOpen, at) => {
      /*
       * Aimed where it was opened from — after the page whose menu asked,
       * else after the page last worked on, else at the end — and always
       * changeable in the gallery before anything is inserted.
       */
      const pages = get().document?.pages ?? [];
      const active = pages.findIndex((page) => page.id === get().activePageId);
      const where = at ?? (active >= 0 ? active + 1 : pages.length);
      set({ sectionsOpen, sectionsAt: Math.max(0, Math.min(where, pages.length)) });
      if (sectionsOpen) void get().refreshSections();
    },

    setSectionsAt: (sectionsAt) => set({ sectionsAt }),

    setThemesOpen: (themesOpen) => set({ themesOpen }),

    async saveThemes(themes) {
      const { brandId } = get();
      if (!brandId) return;
      const before = get().themes;
      set({ themes });
      try {
        set({ themes: await api.saveThemes(brandId, themes) });
      } catch (error) {
        set({ themes: before, error: `Temaerne kunne ikke gemmes: ${message(error)}` });
      }
    },

    applyTheme(themeId) {
      const theme = themeId ? get().themes.find((entry) => entry.id === themeId) ?? null : null;
      if (themeId && !theme) return;
      get().openVariant(null);
      if (!get().document) return;
      live.gesture = null;
      mutate((doc) => withTheme(doc, theme));
      set({ note: theme ? `Temaet «${theme.name}» er lagt på avisen — ⌘Z fortryder` : 'Temaet er taget af avisen' });
    },

    async refreshSections() {
      const { brandId } = get();
      if (!brandId) return;
      try {
        { const sections = await api.fetchSections(brandId); if (get().brandId === brandId) set({ sections }); }
      } catch {
        // The gallery is a convenience; the book works without it.
      }
    },

    async saveSection(pageId, name, tags) {
      const { brandId, document } = get();
      if (!brandId || !document) return;
      const section = sectionOf(document, pageId, name, tags);
      if (!section) return;
      try {
        const saved = await api.saveSection(brandId, section);
        // The page now follows the design it was saved as.
        mutate((doc) => ({
          ...doc,
          pages: doc.pages.map((p) => (p.id === pageId ? { ...p, section: { id: saved.id, version: saved.version ?? 1 } } : p)),
        }));
        set({ note: `Gemt som sektion: ${name}` });
        await get().refreshSections();
      } catch (error) {
        set({ error: message(error) });
      }
    },

    async saveAllSections() {
      const { brandId, document } = get();
      if (!brandId || !document) return;
      set({ busy: 'Gemmer siderne som sektioner…', error: null });
      try {
        let n = 0;
        for (const [index, page] of document.pages.entries()) {
          const { name, tags } = sectionNaming(document, index);
          const section = sectionOf(document, page.id, name, tags);
          if (!section) continue;
          await api.saveSection(brandId, section);
          n += 1;
        }
        set({ busy: null, note: `${count(n, 'sektion', 'sektioner')} gemt fra ${document.name}` });
        await get().refreshSections();
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async importCmsSections(text) {
      const { brandId, brand } = get();
      if (!brandId) return null;
      let designs;
      try {
        designs = readCmsSectionDesigns(text);
      } catch (error) {
        set({ error: `Kunne ikke læses: ${message(error)}` });
        return null;
      }
      if (designs.length === 0) {
        set({ error: 'Fandt ingen sektionsdesigns — kopiér fra Design templates → Sections i CMS’et.' });
        return null;
      }
      set({ busy: `Henter ${count(designs.length, 'sektion', 'sektioner')} fra CMS’et…`, error: null });
      const known = new Set((brand?.offerDesigns ?? []).map((d) => d.tag));
      const missing = new Set<string>();
      const left = new Set<string>();
      // Several designs may share a tag — the CMS uses them in turn — so the second is "(2)".
      const named = new Map<string, number>();
      let saved = 0;
      try {
        for (const design of designs) {
          const made = sectionTemplate(design);
          for (const slot of made.template.slots) if (slot.design && !known.has(slot.design)) missing.add(slot.design);
          for (const line of made.left) left.add(line);
          const n = (named.get(made.name) ?? 0) + 1;
          named.set(made.name, n);
          const lower = made.name.toLowerCase();
          await api.saveSection(brandId, {
            // Stable per CMS design: pasting it again updates the section, and pages made from it follow.
            id: `cms-${design.id}`.slice(0, 80),
            name: n > 1 ? `${made.name} (${n})` : made.name,
            tags: [
              'cms',
              ...(/overflow/.test(lower) ? ['overflow'] : []),
              ...(/intro|forside|cover/.test(lower) ? ['forside'] : []),
              ...(/outro|bagside/.test(lower) ? ['bagside'] : []),
            ],
            page: made.page,
            template: made.template,
            preview: [],
            createdAt: '',
          });
          saved += 1;
        }
        set({
          busy: null,
          note: `${count(saved, 'sektion', 'sektioner')} hentet fra CMS’et`
            + (missing.size ? ` · mangler varedesigns: ${[...missing].join(', ')}` : ''),
        });
        await get().refreshSections();
        return { saved, missing: [...missing], left: [...left] };
      } catch (error) {
        set({ busy: null, error: message(error) });
        await get().refreshSections();
        return null;
      }
    },

    async updateSectionFromPage(pageId) {
      const { brandId, document, sections } = get();
      const link = document?.pages.find((p) => p.id === pageId)?.section;
      const existing = link ? sections.find((s) => s.id === link.id) : undefined;
      if (!brandId || !document || !link || !existing) return;
      const packaged = sectionOf(document, pageId, existing.name, existing.tags);
      if (!packaged) return;
      try {
        const saved = await api.saveSection(brandId, { ...packaged, id: existing.id, createdAt: existing.createdAt });
        mutate((doc) => ({
          ...doc,
          pages: doc.pages.map((p) => (p.id === pageId ? { ...p, section: { id: saved.id, version: saved.version ?? 1 } } : p)),
        }));
        await get().refreshSections();
        const behind = sectionsBehind(get().document!, get().sections).filter((b) => b.section.id === existing.id).length;
        set({
          note: `«${existing.name}» er opdateret til version ${saved.version ?? 1}`
            + (behind ? ` · ${count(behind, 'anden side', 'andre sider')} i denne avis kan hente den` : ''),
        });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    pullSections(pageIds) {
      const { brand, document, sections } = get();
      if (!brand || !document) return;
      const behind = sectionsBehind(document, sections).filter((b) => !pageIds || pageIds.includes(b.pageId));
      if (behind.length === 0) return;
      let dropped = 0;
      live.gesture = null;
      mutate((doc) => behind.reduce((current, item) => {
        const result = applySection(current, brand, item.pageId, item.section);
        dropped += result.dropped;
        return result.document;
      }, doc));
      set({
        note: `${count(behind.length, 'side', 'sider')} har fået det nye design`
          + (dropped ? ` · ${count(dropped, 'vare', 'varer')} gik i reserve, fordi designet har færre pladser` : ''),
      });
    },

    async removeSection(id) {
      const { brandId } = get();
      if (!brandId) return;
      try {
        await api.removeSection(brandId, id);
        set({ sections: get().sections.filter((section) => section.id !== id) });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    insertSections(ids, at) {
      const start = at ?? get().document?.pages.length ?? 0;
      const names: string[] = [];
      live.gesture = null;
      ids.forEach((id, n) => {
        const before = get().document?.pages.length ?? 0;
        get().insertSection(id, start + names.length, 'sektioner');
        if ((get().document?.pages.length ?? 0) > before) {
          names.push(get().sections.find((entry) => entry.id === id)?.name ?? `sektion ${n + 1}`);
        }
      });
      live.gesture = null;
      if (names.length === 0) return;
      set({
        sectionsOpen: false,
        note: names.length === 1
          ? get().note
          : `${names.length} sektioner lagt ind som side ${start + 1}–${start + names.length}: ${names.join(', ')}`,
      });
      clearUnderText(null);
    },

    insertSection(id, at, batch) {
      const { brand, sections, brandId } = get();
      const section = sections.find((entry) => entry.id === id);
      if (!brand || !brandId || !section) return;
      /*
       * A section is a way to START an avis, not only to add to one: on
       * an empty studio it opens this week's paper, with the feed as its
       * reserve, and the section is its first page.
       */
      if (!get().document) {
        const week = get().week;
        const now = new Date().toISOString();
        set({
          document: CatalogDocumentSchema.parse({
            id: week ? weekId(brandId, week) : `${brandId}-${Date.now().toString(36)}`,
            schemaVersion: 2,
            name: week ? weekName(brand.name, week) : `${brand.name} · ny avis`,
            brandId,
            week,
            pages: [],
            offers: get().feedOffers,
            templates: [],
            createdAt: now,
            updatedAt: now,
          }),
          past: [],
          future: [],
        });
      }
      const document = get().document!;

      const template = resolveTemplate(brand, section.page.templateId)
        ?? document.templates.find((entry) => entry.id === section.page.templateId)
        ?? section.template
        ?? undefined;
      const cells = section.page.kind === 'image' || !template
        ? []
        : slotAssignmentOrder(template).map((slot) => slot.id);

      /*
       * Dealt from the reserve by the section's own tags — a "frost"
       * section takes the strongest frozen products nobody has placed.
       * A section tagged with no department takes the strongest of
       * anything. Cells it cannot fill stay empty and say so.
       */
      const wanted = section.tags.filter((tag): tag is Department => (DEPARTMENTS as readonly string[]).includes(tag));
      /*
       * The reserve is what the shelf shows: the avis's own products and
       * this week's feed. An avis fetched from a link carries only what it
       * printed, and a section dealt from that alone came out empty with
       * the whole feed sitting unplaced beside it.
       */
      const { reserve, fromFeed } = reserveFor(document, wanted);
      const placements = cells.slice(0, reserve.length).map((slotId, n) => ({
        offerId: reserve[n]!.id,
        slotId,
        overrides: {},
      }));

      // Unique within one millisecond too: several sections go in at once.
      const pageId = `sec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const page = CatalogPage.parse({
        ...rememberPrinted(section.page, section.preview ?? []),
        id: pageId,
        placements,
        // A reference to the design, so a newer version of it can reach this page.
        section: { id: section.id, version: section.version ?? 1 },
      });
      const where = Math.max(0, Math.min(at ?? document.pages.length, document.pages.length));

      if (!batch) live.gesture = null;
      mutate((doc) => {
        const pages = [...doc.pages];
        pages.splice(where, 0, page);
        const templates = template && !resolveTemplate(brand, template.id)
          && !doc.templates.some((entry) => entry.id === template.id)
          ? [...doc.templates, template]
          : doc.templates;
        // A document embeds the offers it prints — see `addOffersToPage`.
        const known = new Set(doc.offers.map((offer) => offer.id));
        const incoming = placements
          .map((placement) => fromFeed.find((offer) => offer.id === placement.offerId))
          .filter((offer): offer is Offer => Boolean(offer) && !known.has(offer!.id));
        return { ...doc, pages, templates, offers: [...doc.offers, ...incoming] };
      }, batch);
      set({
        sectionsOpen: false,
        scrollToPageId: pageId,
        activePageId: pageId,
        note: `${section.name} lagt ind som side ${where + 1}`
          + (cells.length ? ` · ${placements.length} af ${cells.length} pladser fyldt med ikke placerede varer` : '')
          + (cells.length > placements.length && wanted.length
            ? ` — der er ikke flere ikke placerede ${wanted.map((tag) => DEPARTMENT_NAMES[tag].toLowerCase()).join('/')}-varer`
            : ''),
      });
      if (!batch) clearUnderText([pageId]);
    },

    dismissFeedArrival: () => set({ feedArrival: null }),

    applyFeedChanges() {
      const arrival = get().feedArrival;
      if (!arrival || !get().document) return;
      // Another leaflet's file is not a correction to this one — see `sameAvis`.
      if (!sameAvis(arrival)) return;
      live.gesture = null;
      mutate((document) => applyFeedDiff(document, arrival.diff));
      const { changed, removed, added } = arrival.diff;
      set({
        feedArrival: null,
        feedChanges: arrival.diff,
        note: [
          `${arrival.name} lagt ind`,
          count(changed.length, 'ændring', 'ændringer'),
          `${removed.length} udgået`,
          `${added.length} nye under Ikke placeret`,
        ].join(' · '),
      });
      get().refreshFindings();
    },

    clearFeedChanges: () => {
      set({ feedChanges: null });
      get().refreshFindings();
    },

    carryWeek(forWeek) {
      const { document, brand, brandId, feedOffers, past } = get();
      if (!document || !brand || !brandId || feedOffers.length === 0) return;

      // The week asked for; else the week the file is FOR, read off its
      // own dates; next week when it does not say.
      const week = forWeek ?? feedWeek(feedOffers) ?? (document.week ? nextWeek(document.week) : get().week);
      let id = week ? weekId(brandId, week) : `${brandId}-${Date.now().toString(36)}`;
      // Never onto an avis that already exists: saving would write the new week over it.
      if (id === document.id || get().catalogues.some((saved) => saved.id === id)) id = `${id}-${Date.now().toString(36)}`;

      const { document: carried, report } = carryForward(document, feedOffers, {
        templateFor: (templateId) => resolveTemplate(brand, templateId)
          ?? document.templates.find((entry) => entry.id === templateId),
        week,
        brandName: brand.name,
        id,
        rules: brand.offerRules,
      });
      // Published pages keep their cells' layouts for the new products.
      // "Skal med" is the chain's list for ONE week; the new week starts without one.
      const next = { ...rememberCells(document, carried), mustInclude: [], approvals: [], bookings: [], live: [] };

      if (week) {
        try {
          window.localStorage.setItem(WEEK_KEY, JSON.stringify(week));
        } catch { /* private browsing; it holds for this session */ }
      }
      live.gesture = null;
      set({
        document: next,
        ...(week ? { week } : {}),
        // Undo goes back to last week's avis, as it was.
        past: [...past.slice(-29), document],
        future: [],
        feedArrival: null,
        feedChanges: null,
        carryReport: { ...report, from: document.name },
        view: 'bog',
        openPageId: null,
        activePageId: next.pages[0]?.id ?? null,
        selectedOfferId: null,
        selectedPart: null,
        selectedPack: null,
        selectedText: null,
        savedAt: null,
        note: `${next.name} startet fra ${document.name}`,
      });
      get().refreshFindings();
      clearUnderText(null);
    },

    dismissCarryReport: () => set({ carryReport: null }),

    clearNote: () => set({ note: null }),

    startOver() {
      live.gesture = null;
      set({
        document: null,
        past: [],
        future: [],
        feedArrival: null,
        feedChanges: null,
        carryReport: null,
        reproductions: [],
        view: 'bog',
        openPageId: null,
        activePageId: null,
        selectedOfferId: null,
        selectedPart: null,
        selectedPack: null,
        selectedText: null,
        savedAt: null,
        findings: [],
        error: null,
        note: 'Startet forfra — den gemte avis er ikke rørt',
      });
    },
  };
}
