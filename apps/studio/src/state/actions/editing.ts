import type { CatalogDocument, Offer, PageTemplate, Placement } from '@incitio/schema';
import { slotAssignmentOrder } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { DEPARTMENTS, pageDepartment, type Department } from '@incitio/compose';
import { addRows, measureRoom, readPageBoxes, stretch, type Box } from '../../fill.js';
import { count, type StudioState } from '../model.js';
import { FRESH, cellSize, carryOverrides, departmentOfPage } from '../layout.js';
import type { StoreContext } from '../context.js';

/** Markering, layoutredigering, celler, noter og bytte af pladser. */
export function editingActions(ctx: StoreContext): Pick<StudioState, 'select' | 'selectDecor' | 'setLayoutEdit' | 'ownLayout' | 'setCellRect' | 'addCell' | 'emptySlots' | 'fillEmptySlots' | 'fillPage' | 'removeCell' | 'mergeCells' | 'selectNote' | 'addNote' | 'updateNote' | 'removeNote' | 'selectPart' | 'selectPageText' | 'swapPlacements' | 'setMaxPages' | 'endGesture'> {
  const { set, get, reserveFor, mutate, clearUnderText, live } = ctx;
  return {
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
        ? { selectedOfferId: offerId, selectedDecorId: null, selectedText: null, selectedNoteId: null, selectedIncito: null }
        : {
          selectedIncito: null,
          selectedOfferId: offerId,
          selectedPart: null,
          // Another tile's variant index means nothing on this one.
          selectedPack: null,
          selectedDecorId: null,
          selectedText: null,
          selectedNoteId: null,
        },
    ),

    selectDecor: (decorId) => set({
      selectedDecorId: decorId,
      ...(decorId
        ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedText: null, selectedNoteId: null }
        : {}),
    }),

    setLayoutEdit: (pageId) => set({
      layoutEditPageId: pageId,
      ...(pageId ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedDecorId: null, selectedNoteId: null } : {}),
    }),

    ownLayout(pageId, rects) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !brand || !page) return;
      const template = document.templates.find((t) => t.id === page.templateId)
        ?? resolveTemplate(brand, page.templateId);
      if (!template) return;
      const owned = document.templates.some((t) => t.id === template.id);
      const complete = template.slots.every((slot) => slot.rect);
      if (owned && complete) return;

      const withRects = {
        ...template,
        slots: template.slots.map((slot) => (slot.rect ? slot : rects[slot.id] ? { ...slot, rect: rects[slot.id]! } : slot)),
      };
      if (owned) {
        mutate((doc) => ({ ...doc, templates: doc.templates.map((t) => (t.id === template.id ? withRects : t)) }));
        return;
      }
      const id = `own/${pageId}`;
      const number = document.pages.indexOf(page) + 1;
      const copy = { ...withRects, id, name: `Side ${number} — egen opsætning` };
      mutate((doc) => ({
        ...doc,
        templates: [...doc.templates.filter((t) => t.id !== id), copy],
        pages: doc.pages.map((entry) => (entry.id === pageId ? { ...entry, templateId: id } : entry)),
      }));
    },

    setCellRect(pageId, slotId, rect, name) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      if (!page) return;
      const was = get().document?.templates.find((t) => t.id === page.templateId)
        ?.slots.find((slot) => slot.id === slotId);
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === page.templateId
          ? { ...t, slots: t.slots.map((slot) => (slot.id === slotId ? { ...slot, rect } : slot)) }
          : t)),
        // The tile in the cell keeps its arrangement as the cell grows.
        pages: doc.pages.map((entry) => (entry.id === pageId && was?.rect
          ? {
            ...entry,
            placements: entry.placements.map((placement) => (placement.slotId === slotId
              ? {
                ...placement,
                overrides: carryOverrides(
                  placement.overrides,
                  doc.offers.find((offer) => offer.id === placement.offerId),
                  { w: was.rect!.w, h: was.rect!.h, role: was.role },
                  { w: rect.w, h: rect.h, role: was.role },
                ),
              }
              : placement)),
          }
          : entry)),
      }), name ?? `cell:${pageId}:${slotId}`);
    },

    addCell(pageId, rect) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      if (!page || !template) return;
      const used = new Set(template.slots.map((slot) => slot.id));
      const id = [...'abcdefghijklmnopqrstuvwxyz'].map((c) => c)
        .concat([...'abcdefghijklmnopqrstuvwxyz'].map((c) => `x${c}`))
        .find((candidate) => !used.has(candidate));
      if (!id) return;
      const width = template.areas[0]!.split(' ').length;
      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            // A row of its own in the grid underneath, so the layout stays
            // one a grid can describe; the box is what places it.
            areas: [...t.areas, new Array(width).fill(id).join(' ')],
            slots: [...t.slots, { id, role: 'standard' as const, bleed: 1, rect }],
          }
          : t)),
      }));
    },

    emptySlots(pageId) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !brand || !page || page.kind === 'image') return [];
      const template = document.templates.find((t) => t.id === page.templateId) ?? resolveTemplate(brand, page.templateId);
      if (!template) return [];
      const taken = new Set(page.placements.map((placement) => placement.slotId));
      return slotAssignmentOrder(template).map((slot) => slot.id).filter((id) => !taken.has(id));
    },

    fillEmptySlots(pageId) {
      const document = get().document;
      const page = document?.pages.find((entry) => entry.id === pageId);
      const empty = get().emptySlots(pageId);
      if (!document || !page || empty.length === 0) {
        set({ note: 'Der er ingen tomme pladser på siden.' });
        return;
      }
      /*
       * What the page is about: its products, or — emptied — the tags of
       * the section it was dealt from. Neither: the strongest of anything.
       */
      const department = departmentOfPage(document, pageId);
      const tags = page.section ? get().sections.find((entry) => entry.id === page.section!.id)?.tags ?? [] : [];
      const wanted = department
        ? [department]
        : tags.filter((tag): tag is Department => (DEPARTMENTS as readonly string[]).includes(tag));
      const { reserve, fromFeed } = reserveFor(document, wanted);
      const placements = empty.slice(0, reserve.length).map((slotId, n) => ({
        offerId: reserve[n]!.id,
        slotId,
        overrides: FRESH,
      }));
      if (placements.length === 0) {
        set({ error: 'Reserven har ingen varer med billede at fylde pladserne med.' });
        return;
      }
      live.gesture = null;
      mutate((doc) => {
        const known = new Set(doc.offers.map((offer) => offer.id));
        const incoming = placements
          .map((placement) => fromFeed.find((offer) => offer.id === placement.offerId))
          .filter((offer): offer is Offer => Boolean(offer) && !known.has(offer!.id));
        return {
          ...doc,
          offers: [...doc.offers, ...incoming],
          pages: doc.pages.map((entry) => (entry.id === pageId
            ? { ...entry, placements: [...entry.placements, ...placements] }
            : entry)),
        };
      });
      const index = document.pages.indexOf(page);
      set({
        note: `Side ${index + 1}: ${placements.length} af ${empty.length} tomme pladser fyldt fra reserven · ⌘Z fortryder`,
      });
      clearUnderText([pageId]);
    },

    fillPage(pageId, mode) {
      const { document, brand } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !brand || !page) return;
      const template = document.templates.find((t) => t.id === page.templateId) ?? resolveTemplate(brand, page.templateId);
      const drawn = readPageBoxes(pageId);
      if (!template || !drawn) {
        set({ error: 'Siden kan ikke måles — åbn den og prøv igen.' });
        return;
      }
      const boxes = drawn.cells.filter((cell) => template.slots.some((slot) => slot.id === cell.slotId));
      const room = measureRoom(boxes.map((cell) => cell.box), drawn.obstacles);
      if (!room || room.free < 0.04) {
        set({ note: 'Der er ingen tom plads på siden at fylde ud.' });
        return;
      }

      /*
       * More rows only as far as the reserve reaches: a row the reserve
       * cannot fill is a row of empty cells, and then the tiles grow instead.
       */
      const onPage = page.placements.map((placement) => document.offers.find((offer) => offer.id === placement.offerId))
        .filter((offer): offer is Offer => Boolean(offer));
      const department = pageDepartment(onPage);
      const { reserve, fromFeed } = reserveFor(document, department ? [department] : []);
      const rows = mode === 'more' ? Math.min(room.rows, Math.floor(reserve.length / Math.max(1, room.perRow))) : 0;
      if (mode === 'more' && rows === 0) {
        set({
          error: room.rows === 0
            ? 'Der er ikke plads til en hel række mere — gør fliserne større i stedet.'
            : 'Reserven har ikke varer nok med billede til en række mere — gør fliserne større i stedet.',
        });
        return;
      }
      const plan = rows > 0
        ? addRows(boxes.map((cell) => cell.box), room.to, rows)
        : { cells: stretch(boxes.map((cell) => cell.box), room.to), added: [] as Box[] };
      const rects = new Map(boxes.map((cell, index) => [cell.slotId, plan.cells[index]!]));

      const used = new Set(template.slots.map((slot) => slot.id));
      const names = [...'abcdefghijklmnopqrstuvwxyz', ...[...'abcdefghijklmnopqrstuvwxyz'].map((c) => `x${c}`)]
        .filter((candidate) => !used.has(candidate));
      const width = template.areas[0]!.split(' ').length;
      const added = plan.added.map((box, index) => ({ id: names[index]!, rect: box, offer: reserve[index]! }))
        .filter((entry) => entry.id);
      const own = document.templates.some((t) => t.id === template.id);
      const id = own ? template.id : `own/${pageId}`;
      const next: PageTemplate = {
        ...template,
        id,
        name: own ? template.name : `Side ${document.pages.indexOf(page) + 1} — egen opsætning`,
        areas: [...template.areas, ...added.map((entry) => new Array(width).fill(entry.id).join(' '))],
        slots: [
          ...template.slots.map((slot) => (rects.has(slot.id) ? { ...slot, rect: rects.get(slot.id)! } : slot)),
          ...added.map((entry) => ({ id: entry.id, role: 'standard' as const, bleed: 1, rect: entry.rect })),
        ],
      };
      const known = new Set(document.offers.map((offer) => offer.id));
      const incoming = added.map((entry) => entry.offer).filter((offer) => !known.has(offer.id) && fromFeed.includes(offer));

      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        offers: [...doc.offers, ...incoming],
        templates: [...doc.templates.filter((t) => t.id !== id), next],
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? {
            ...entry,
            templateId: id,
            placements: [
              // The tiles keep their arrangement as their cells grow — see `setCellRect`.
              ...entry.placements.map((placement) => {
                const was = boxes.find((cell) => cell.slotId === placement.slotId)?.box;
                const now = rects.get(placement.slotId);
                const role = template.slots.find((slot) => slot.id === placement.slotId)?.role ?? 'standard';
                return was && now
                  ? {
                    ...placement,
                    overrides: carryOverrides(
                      placement.overrides,
                      doc.offers.find((offer) => offer.id === placement.offerId),
                      { w: was.w, h: was.h, role },
                      { w: now.w, h: now.h, role },
                    ),
                  }
                  : placement;
              }),
              ...added.map((entry) => ({ offerId: entry.offer.id, slotId: entry.id, overrides: FRESH })),
            ],
          }
          : entry)),
      }));
      set({
        note: added.length > 0
          ? `${count(added.length, 'vare', 'varer')} lagt ind fra reserven: ${added.map((entry) => entry.offer.name.split(/[,(]/)[0]!.trim()).join(', ')}`
          : `Fliserne fylder nu siden ud — ${Math.round(room.free * 100)} % af siden var tom`,
      });
    },

    removeCell(pageId, slotId) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      if (!page || !template || template.slots.length <= 1) return;
      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            areas: t.areas.map((row) => row.split(' ').map((cell) => (cell === slotId ? '.' : cell)).join(' ')),
            slots: t.slots.filter((slot) => slot.id !== slotId),
          }
          : t)),
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? { ...entry, placements: entry.placements.filter((placement) => placement.slotId !== slotId) }
          : entry)),
      }));
    },

    mergeCells(pageId, slotId, emptyId) {
      const page = get().document?.pages.find((entry) => entry.id === pageId);
      const template = get().document?.templates.find((t) => t.id === page?.templateId);
      const a = template?.slots.find((slot) => slot.id === slotId)?.rect;
      const b = template?.slots.find((slot) => slot.id === emptyId)?.rect;
      if (!page || !template || !a || !b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const union = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
      const role = template.slots.find((slot) => slot.id === slotId)!.role;
      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((entry) => (entry.id === pageId
          ? {
            ...entry,
            placements: entry.placements.map((placement) => (placement.slotId === slotId
              ? {
                ...placement,
                overrides: carryOverrides(
                  placement.overrides,
                  doc.offers.find((offer) => offer.id === placement.offerId),
                  { w: a.w, h: a.h, role }, { w: union.w, h: union.h, role },
                ),
              }
              : placement)),
          }
          : entry)),
        templates: doc.templates.map((t) => (t.id === template.id
          ? {
            ...t,
            areas: t.areas.map((row) => row.split(' ').map((cell) => (cell === emptyId ? '.' : cell)).join(' ')),
            slots: t.slots
              .filter((slot) => slot.id !== emptyId)
              .map((slot) => (slot.id === slotId ? { ...slot, rect: union } : slot)),
          }
          : t)),
      }));
    },

    // One thing in hand at a time: a note, a picture and a tile are
    // never selected together, so the panel and the keys have one owner.
    selectNote: (noteId) => set({
      selectedNoteId: noteId,
      ...(noteId
        ? { selectedOfferId: null, selectedPart: null, selectedPack: null, selectedText: null, selectedDecorId: null }
        : {}),
    }),

    addNote(pageId) {
      const id = `note-${Date.now().toString(36)}`;
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? {
            ...page,
            notes: [...(page.notes ?? []), {
              id, text: 'Skriv din tekst', x: 0.25, y: 0.45, w: 0.5, size: 0.045,
              color: '#16181d', bold: true, align: 'center' as const, rotate: 0,
              background: null, image: null, h: null, behind: false,
            }].slice(-24),
          }
          : page)),
      }));
      get().selectNote(id);
    },

    updateNote(pageId, noteId, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, notes: (page.notes ?? []).map((note) => (note.id === noteId ? { ...note, ...patch } : note)) }
          : page)),
      }), name ?? `note:${noteId}`);
    },

    removeNote(pageId, noteId) {
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, notes: (page.notes ?? []).filter((note) => note.id !== noteId) }
          : page)),
      }));
      if (get().selectedNoteId === noteId) set({ selectedNoteId: null });
    },

    selectPart: (part) => set({
      selectedPart: part,
      // Leaving the artwork box leaves whatever variant of it was in
      // hand: a nudge with a stale index would move a product nobody is
      // looking at.
      ...(part === 'media' ? {} : { selectedPack: null }),
    }),

    selectPageText: (pageId, part) => set(
      part === null
        ? { selectedText: null }
        // A line and a tile are never both in hand, for the same reason
        // a picture and a tile are not: one selection, one thing the
        // arrow keys move.
        : {
          selectedText: { pageId, part },
          selectedOfferId: null,
          selectedPart: null,
          selectedPack: null,
          selectedDecorId: null,
        },
    ),

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

      const brand = get().brand;
      /* Each tile keeps its arrangement in the other's cell. */
      const size = (document: CatalogDocument, at: { pageId: string; slotId: string }) => {
        const page = document.pages.find((entry) => entry.id === at.pageId);
        return brand && page ? cellSize(brand, document.templates, page.templateId, at.slotId) : null;
      };
      mutate((document) => {
        const carry = (placement: Placement, into: { pageId: string; slotId: string }, out: { pageId: string; slotId: string }) =>
          carryOverrides(
            placement.overrides,
            document.offers.find((offer) => offer.id === placement.offerId),
            size(document, out),
            size(document, into),
          );
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
                  ? { ...placement, offerId: target.offerId, overrides: carry(target, from, to) }
                  : null;
              }
              if (here.pageId === to.pageId && here.slotId === to.slotId) {
                return { ...placement, offerId: source.offerId, overrides: carry(source, to, from) };
              }
              return placement;
            })
            .filter((placement): placement is NonNullable<typeof placement> => placement !== null);

          // A move onto a slot that held nothing has to create it.
          if (page.id === to.pageId && !target) {
            placements.push({
              offerId: source.offerId,
              slotId: to.slotId,
              overrides: carry(source, to, from),
            });
          }
          return { ...page, placements };
        });

        return { ...document, pages };
      });
    },
    setMaxPages: (pages) => set({ maxPages: Math.max(1, Math.min(60, pages)) }),

    endGesture() { live.gesture = null; },
  };
}
