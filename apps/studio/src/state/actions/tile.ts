import { CatalogPage, pageTextLimits, pageTextOverride, pageTextPatch, packLimits, packOverride, packPatch, partLimits, partOverride, partPatch } from '@incitio/schema';
import * as api from '../../api.js';
import { type StudioState } from '../model.js';
import { message, toBase64, reachable } from '../cluster.js';
import type { StoreContext } from '../context.js';

/** Én flises dele, varer og tekster. */
export function tileActions(ctx: StoreContext): Pick<StudioState, 'selectPackItem' | 'updatePackItem' | 'nudgePackItem' | 'scalePackItem' | 'turnPackItem' | 'resetPackItem' | 'setPackItemHidden' | 'updatePart' | 'nudgePart' | 'scalePart' | 'resetPart' | 'setPartHidden' | 'resetTile' | 'updatePageText' | 'nudgePageText' | 'scalePageText' | 'resetPageText' | 'setPageTextHidden' | 'updateOverrides' | 'addImagePage' | 'replaceImagePage'> {
  const { set, get, repeating, overridesOf, pageById, clamp, mutate, live } = ctx;
  return {
    selectPackItem(index) {
      // Naming a variant names its box too: everything downstream asks
      // "which box" first, and a cluster is always inside the artwork.
      set({ selectedPack: index, ...(index === null ? {} : { selectedPart: 'media' as const }) });
    },

    updatePackItem(offerId, index, patch, name) {
      const current = overridesOf(offerId);
      if (!current) return;
      get().updateOverrides(offerId, packPatch(current, index, patch), name);
    },

    nudgePackItem(offerId, index, dx, dy) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { reach } = packLimits();
      get().updatePackItem(offerId, index, {
        offsetX: clamp(now.offsetX + dx, -reach, reach),
        offsetY: clamp(now.offsetY + dy, -reach, reach),
      }, repeating(`nudge:${offerId}:pack${index}`));
    },

    scalePackItem(offerId, index, delta) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { minScale, maxScale } = packLimits();
      get().updatePackItem(offerId, index, {
        scale: clamp(now.scale + delta, minScale, maxScale),
      }, repeating(`scale:${offerId}:pack${index}`));
    },

    turnPackItem(offerId, index, delta) {
      const current = overridesOf(offerId);
      if (!current) return;
      const now = packOverride(current, index);
      const { turn } = packLimits();
      get().updatePackItem(offerId, index, {
        rotate: clamp(now.rotate + delta, -turn, turn),
      }, repeating(`turn:${offerId}:pack${index}`));
    },

    resetPackItem(offerId, index) {
      live.gesture = null;
      get().updatePackItem(offerId, index, {
        offsetX: 0, offsetY: 0, scale: 1, rotate: 0, hidden: false,
      });
    },

    setPackItemHidden(offerId, index, hidden) {
      live.gesture = null;
      get().updatePackItem(offerId, index, { hidden });
    },

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
      live.gesture = null;
      get().updatePart(offerId, part, {
        offsetX: 0, offsetY: 0, scale: 1, hidden: false,
      });
    },

    setPartHidden(offerId, part, hidden) {
      live.gesture = null;
      get().updatePart(offerId, part, { hidden });
    },

    resetTile(offerId) {
      live.gesture = null;
      get().updateOverrides(offerId, {
        imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, parts: {}, pack: {},
      });
    },

    updatePageText(pageId, part, patch, name) {
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId
          ? { ...page, ...pageTextPatch(page, part, patch) }
          : page)),
      }), name);
    },

    nudgePageText(pageId, part, dx, dy) {
      const page = pageById(pageId);
      if (!page) return;
      const now = pageTextOverride(page, part);
      const { reach } = pageTextLimits();
      get().updatePageText(pageId, part, {
        offsetX: clamp(now.offsetX + dx, -reach, reach),
        offsetY: clamp(now.offsetY + dy, -reach, reach),
      }, repeating(`text-nudge:${pageId}:${part}`));
    },

    scalePageText(pageId, part, delta) {
      const page = pageById(pageId);
      if (!page) return;
      const now = pageTextOverride(page, part);
      const { minScale, maxScale } = pageTextLimits();
      get().updatePageText(pageId, part, {
        scale: clamp(now.scale + delta, minScale, maxScale),
      }, repeating(`text-scale:${pageId}:${part}`));
    },

    /*
     * Geometry and visibility, not wording — the same line `resetPart`
     * draws. Putting a heading back where the masthead had it must not
     * silently un-say what somebody typed into it.
     */
    resetPageText(pageId, part) {
      live.gesture = null;
      get().updatePageText(pageId, part, {
        offsetX: 0, offsetY: 0, scale: 1, hidden: false,
      });
    },

    setPageTextHidden(pageId, part, hidden) {
      live.gesture = null;
      get().updatePageText(pageId, part, { hidden });
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

    async addImagePage(at, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Lægger ${file.name} ind i avisen…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        set({ busy: null, note: `${file.name} lagt ind som side ${at + 1}` });
        mutate((document) => {
          const pages = [...document.pages];
          pages.splice(Math.max(0, Math.min(at, pages.length)), 0, CatalogPage.parse({
            id: `img-${Date.now().toString(36)}`,
            kind: 'image',
            background: {
              imageUrl: url,
              subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
              fit: 'cover',
              opacity: 1,
              focusX: 50,
              focusY: 50,
            },
            placements: [],
          }));
          return { ...document, pages };
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    async replaceImagePage(pageId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Skifter billedet på siden…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { url } = await api.uploadImage(brandId, toBase64(bytes), file.name);
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);
        set({ busy: null, note: `${file.name} lagt på siden` });
        get().setPageBackground(pageId, {
          imageUrl: url,
          subject: file.name.replace(/\.[a-z0-9]+$/i, ''),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },
  };
}
