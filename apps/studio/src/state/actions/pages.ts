import type { DecorAnchor } from '@incitio/schema';
import { CatalogPage } from '@incitio/schema';
import { pageBlocks } from '@incitio/renderer';
import * as api from '../../api.js';
import { chooseBackdrop, measureBackdrop } from '../../backdrop.js';
import { count, type StudioState } from '../model.js';
import { message, toBase64, reachable } from '../cluster.js';
import { withIncitoEdit } from '../layout.js';
import type { StoreContext } from '../context.js';

/** Udgivne sider, sider, billeder, baggrunde og varelisten. */
export function pagesActions(ctx: StoreContext): Pick<StudioState, 'selectIncito' | 'editIncito' | 'moveIncito' | 'hideIncito' | 'setPageExact' | 'clearPage' | 'removePage' | 'movePage' | 'setDrawer' | 'refreshUploads' | 'addToLibrary' | 'removeFromLibrary' | 'placeFromLibrary' | 'backgroundPages' | 'uploadBackground' | 'addPageImage' | 'updatePageImage' | 'removePageImage' | 'addPageBackground' | 'setPageBackground' | 'setPageDesignTag' | 'setPageTitle' | 'setPageSubtitle' | 'spreadBackground' | 'setPageGround' | 'setLibraryOpen' | 'setLibrarySearch' | 'placedAt' | 'toggleLibraryPick' | 'clearLibraryPicks' | 'setArrangeNote' | 'toggleLibraryGroup' | 'setActivePage'> {
  const { set, get, mutate, live } = ctx;
  return {
    selectIncito(pageId, path) {
      set({
        selectedIncito: path ? { pageId, path } : null,
        // One thing in hand at a time: a tile, a note or an element.
        ...(path ? {
          selectedOfferId: null, selectedPart: null, selectedPack: null,
          selectedDecorId: null, selectedNoteId: null,
        } : {}),
      });
    },

    editIncito(pageId, path, patch, name) {
      mutate((document) => withIncitoEdit(document, pageId, [path], (was) => ({
        ...was,
        ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
        ...(patch.texts === null ? { texts: undefined } : patch.texts ? { texts: patch.texts } : {}),
      })), name);
    },

    moveIncito(pageId, path, move, name) {
      mutate((document) => withIncitoEdit(document, pageId, [path], (was) => {
        if ('reset' in move) return { ...was, dx: 0, dy: 0, scale: 1 };
        return {
          ...was,
          dx: 'dx' in move && move.dx !== undefined ? (move.absolute ? move.dx : was.dx + move.dx) : was.dx,
          dy: 'dy' in move && move.dy !== undefined ? (move.absolute ? move.dy : was.dy + move.dy) : was.dy,
          scale: 'scaleBy' in move ? Math.min(5, Math.max(0.2, was.scale + move.scaleBy)) : was.scale,
        };
      }), name);
    },

    hideIncito(pageId, path, hidden) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      if (!page?.incito) return;
      const doc = get().document;
      const block = pageBlocks(
        page as CatalogPage & { incito: NonNullable<CatalogPage['incito']> },
        doc?.offers ?? [],
        doc?.templates.find((t) => t.id === page.templateId),
      ).find((entry) => entry.path === path);
      live.gesture = null;
      mutate((document) => withIncitoEdit(
        document, pageId, [path, ...(block?.companions ?? [])], (was) => ({ ...was, hidden }),
      ));
      if (hidden) {
        set({ selectedIncito: null, note: 'Taget af siden — ⌘Z fortryder, eller vis det igen i panelet' });
      }
    },

    setPageExact(pageId, exact) {
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, exact } : page)),
      }));
      set({
        note: exact
          ? 'Siden vises som udgivet — præcis som i Tjeks viewer'
          : 'Siden er tegnet med fliser — nu kan den redigeres',
      });
    },

    clearPage(pageId) {
      const index = get().document?.pages.findIndex((page) => page.id === pageId) ?? -1;
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? { ...page, placements: [] } : page)),
      }));
      if (index >= 0) set({ note: `Side ${index + 1} tømt — varerne ligger under Ikke placeret · ⌘Z fortryder` });
    },

    removePage(pageId) {
      const index = get().document?.pages.findIndex((page) => page.id === pageId) ?? -1;
      if (index >= 0) set({ note: `Side ${index + 1} slettet — varerne ligger under Ikke placeret · ⌘Z fortryder` });
      if (get().openPageId === pageId) set({ view: 'bog', openPageId: null });
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.filter((page) => page.id !== pageId),
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

    setDrawer: (drawer) => set({ drawer }),

    async refreshUploads() {
      const { brandId } = get();
      if (!brandId) return;
      try {
        { const uploads = await api.fetchUploads(brandId); if (get().brandId === brandId) set({ uploads }); }
      } catch {
        // A drawer that cannot be listed is not worth interrupting
        // anyone over; the next upload refreshes it.
      }
    },

    async addToLibrary(file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} i biblioteket…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);
        set({ busy: null, note: `${file.name} lagt i biblioteket`, drawer: 'billeder' });
        await get().refreshUploads();
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async removeFromLibrary(ref) {
      const { brandId } = get();
      if (!brandId) return;
      try {
        await api.forgetUpload(brandId, ref);
        set({ uploads: get().uploads.filter((entry) => entry.ref !== ref) });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    async backgroundPages(pageIds, ref) {
      const { document, brand } = get();
      if (!document || pageIds.length === 0) return;
      const targets = new Set(pageIds.filter((id) => document.pages.some((p) => p.id === id && p.kind !== 'image')));
      if (targets.size === 0) return;
      live.gesture = null;
      if (ref === null) {
        mutate((doc) => ({ ...doc, pages: doc.pages.map((p) => (targets.has(p.id) ? { ...p, background: null } : p)) }));
        set({ note: `Baggrund taget af ${count(targets.size, 'side', 'sider')}` });
        return;
      }
      const picture = get().uploads.find((entry) => entry.ref === ref);
      const subject = picture?.name.replace(/\.[a-z0-9]+$/i, '') ?? '';
      const measured = await measureBackdrop(
        await fetch(ref).then((r) => r.blob()).then((b) => new File([b], subject)),
      ).catch(() => null);
      const chosen = measured
        ? chooseBackdrop(measured, brand?.pageAspect ?? 0.707)
        : { fit: 'cover' as const, opacity: 1, focusX: 50, focusY: 50, why: '' };
      /*
       * At full strength, whatever `chooseBackdrop` would dim it to.
       * Here the picture was chosen from a strip that shows it whole and
       * undimmed, so the page has to look like the tile that was picked:
       * the chain's red key visual dimmed to 0.3 over a yellow ground
       * printed orange. Turning it down stays one slider away.
       */
      const dimmed = chosen.opacity < 1;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((p) => (targets.has(p.id)
          ? { ...p, background: { imageUrl: ref, subject, fit: chosen.fit, opacity: 1, focusX: chosen.focusX, focusY: chosen.focusY } }
          : p)),
      }));
      set({
        note: [
          `${subject || 'Billedet'} lagt bag ${count(targets.size, 'side', 'sider')}`,
          dimmed ? 'kraftigt billede — skru ned under Synlighed, hvis priserne drukner' : '',
        ].filter(Boolean).join(' · '),
      });
    },

    async uploadBackground(pageIds, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} i biblioteket…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);
        await get().refreshUploads();
        set({ busy: null });
        await get().backgroundPages(pageIds, url);
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    placeFromLibrary(pageId, ref, hvor) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !page) return;
      const picture = get().uploads.find((entry) => entry.ref === ref);
      const subject = picture?.name.replace(/\.[a-z0-9]+$/i, '') ?? '';

      live.gesture = null;

      if (hvor === 'baggrund') {
        /*
         * Under the whole sheet, with the same reading the upload path
         * does — see `chooseBackdrop`. A picture out of the drawer is
         * the same picture it was when it was dropped, so it deserves
         * the same judgement about fit and strength rather than the
         * flat guess the drawer would otherwise apply.
         *
         * Measured from the file on disk, which is same-origin here,
         * so the canvas will hand back its pixels. Failing that it
         * lands as it always did and the sliders are one click away.
         */
        void (async () => {
          const measured = await measureBackdrop(
            await fetch(ref).then((r) => r.blob()).then((b) => new File([b], subject)),
          ).catch(() => null);
          const chosen = measured
            ? chooseBackdrop(measured, brand?.pageAspect ?? 0.707)
            : { fit: 'cover' as const, opacity: 1, focusX: 50, focusY: 50, why: '' };
          mutate((doc) => ({
            ...doc,
            pages: doc.pages.map((entry) => (entry.id === pageId
              ? {
                ...entry,
                background: {
                  imageUrl: ref,
                  subject,
                  fit: chosen.fit,
                  opacity: chosen.opacity,
                  focusX: chosen.focusX,
                  focusY: chosen.focusY,
                },
              }
              : entry)),
          }));
          set({
            note: [`${subject} lagt bag siden`, chosen.why].filter(Boolean).join(' · '),
          });
        })();
        return;
      }

      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? {
            ...entry,
            // Capped at three by the schema — see `addPageImage`.
            decorations: [...entry.decorations, {
              id: `img-${Date.now().toString(36)}`,
              imageUrl: ref,
              subject,
              offerId: null,
              anchor: 'bottom-right' as DecorAnchor,
              scale: 0.26,
              rotate: 0,
              opacity: 1,
              offsetX: 0,
              offsetY: 0,
              flip: false,
              front: false,
            }].slice(-3),
          }
          : entry)),
      }));
      set({ note: `${subject} lagt på siden` });
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
                flip: false,
                front: false,
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
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, decorations: page.decorations.filter((d) => d.id !== decorId) }
          : page)),
      }));
    },

    async addPageBackground(pageId, file) {
      const { brandId, brand } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} bag siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        /*
         * Measured before it is uploaded, off the file itself.
         *
         * Every upload used to land as `cover` at full strength,
         * centred — a guess, and the wrong one for the commonest file
         * there is: a square graphic, which an A4 sheet then crops by
         * 29 % on each side. See `chooseBackdrop`, which decides the
         * four settings from the picture and says why.
         */
        const measured = await measureBackdrop(file);
        const chosen = measured
          ? chooseBackdrop(measured, brand?.pageAspect ?? 0.707)
          : { fit: 'cover' as const, opacity: 1, focusX: 50, focusY: 50, why: '' };

        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({
          busy: null,
          // What was chosen AND why, because a setting that arrives
          // without a reason is the guess this replaced.
          note: [`${file.name} lagt bag siden`, chosen.why].filter(Boolean).join(' · '),
        });
        mutate((document) => ({
          ...document,
          pages: document.pages.map((page) => (page.id === pageId
            ? {
              ...page,
              background: {
                imageUrl: url,
                subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
                fit: chosen.fit,
                opacity: chosen.opacity,
                focusX: chosen.focusX,
                focusY: chosen.focusY,
              },
            }
            : page)),
        }));
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    setPageBackground(pageId, patch, name) {
      if (patch === null) live.gesture = null;
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

    setPageDesignTag(pageId, tag) {
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, design: { group: page.design?.group ?? 'standard', zones: page.design?.zones ?? {}, tag } }
          : page)),
      }));
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

    spreadBackground(pageId, reach) {
      const { document } = get();
      const from = document?.pages.find((page) => page.id === pageId);
      if (!document || !from?.background) return;

      const at = document.pages.findIndex((page) => page.id === pageId);
      const backdrop = from.background;
      let touched = 0;

      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((page, index) => {
          if (page.id === pageId) return page;
          // An image page's `background` is its own artwork, not a
          // decoration under a grid — see the note on the action.
          if (page.kind === 'image') return page;
          if (reach === 'resten' && index <= at) return page;
          touched += 1;
          return { ...page, background: { ...backdrop } };
        }),
      }));

      set({
        note: touched === 0
          ? 'Ingen andre sider at lægge den under'
          : `Baggrunden lagt under ${count(touched, 'side mere', 'sider mere')}`,
      });
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

    setLibraryOpen: (open) => set({ libraryOpen: open }),
    setLibrarySearch: (query) => set({ librarySearch: query }),

    placedAt() {
      const { document } = get();
      const where = new Map<string, string>();
      if (!document) return where;
      document.pages.forEach((page, index) => {
        const said = `s. ${index + 1}`;
        for (const placement of page.placements) {
          where.set(placement.offerId, said);
          /*
           * And everything the tile is showing inside that placement.
           *
           * A cluster names one assembled offer; the products it
           * photographs are members of it, and they are as printed as
           * anything with a cell of its own. `benched` knows this —
           * see the note there — and a library that did not would go
           * on offering a product that is already on page two.
           */
          const offer = document.offers.find((entry) => entry.id === placement.offerId);
          for (const member of offer?.members ?? []) where.set(member, said);
        }
      });
      return where;
    },

    toggleLibraryPick(offerId) {
      // Already on a page: there is nothing to pick. The card says
      // where it is instead, and clicking it goes there.
      if (get().placedAt().has(offerId)) return;
      const picked = get().librarySelection;
      set({
        librarySelection: picked.includes(offerId)
          ? picked.filter((id) => id !== offerId)
          // Appended rather than prepended: the order of ticking is the
          // order the products are dealt into the page's free cells.
          : [...picked, offerId],
      });
    },

    clearLibraryPicks: () => set({ librarySelection: [] }),

    setArrangeNote: (note) => set({ arrangeNote: note }),

    toggleLibraryGroup(name) {
      const closed = get().libraryClosedGroups;
      set({
        libraryClosedGroups: closed.includes(name)
          ? closed.filter((other) => other !== name)
          : [...closed, name],
      });
    },

    setActivePage: (pageId) => set({ activePageId: pageId }),
  };
}
