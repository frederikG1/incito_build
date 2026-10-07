import type { Offer } from '@incitio/schema';
import * as api from '../../api.js';
import { pool } from '../../pool.js';
import { count, type StudioState } from '../model.js';
import { message, toBase64, reachable, pictureAspect, packMembers, standUpCluster, withPatches, keepGhost, withGhost } from '../cluster.js';
import { FRESH } from '../layout.js';
import type { StoreContext } from '../context.js';

/** Opstilling af flere varer i én flise. */
export function clustersActions(ctx: StoreContext): Pick<StudioState, 'applyClusterLayout' | 'standUpClusters' | 'standUpAllClusters' | 'standUpOneCluster' | 'splitAndStandUp' | 'toggleGhost' | 'setTileImage'> {
  const { set, get, mutate, splitOffer, standUpOn, live } = ctx;
  return {
    async applyClusterLayout(offerId, file) {
      const { brandId, document } = get();
      if (!brandId || !document) return;

      const offer = document.offers.find((entry) => entry.id === offerId);
      const members = offer ? packMembers(offer, document) : [];
      if (!offer || members.length < 2) {
        set({ error: 'Den valgte flise har kun én vare. Læg flere varer i pladsen først — træk dem fra listen.' });
        return;
      }

      set({ busy: 'Læser opstillingen…', error: null, note: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const reading = await api.readClusterLayout(brandId, {
          file: toBase64(bytes),
          offers: members,
        });

        const stood = await standUpCluster({
          offerId,
          members,
          overrides: document.pages.flatMap((entry) => entry.placements)
            .find((entry) => entry.offerId === offerId)?.overrides ?? { ...FRESH },
          /*
           * No same-origin copies here.
           *
           * The by-hand route used to leave a set behind, and it is
           * gone — a picture dropped on a tile now arrives with
           * nothing but itself. `standUpCluster` falls back to
           * treating each cutout as all product, which is right for
           * the trimmed artwork a chain supplies and a little
           * generous for a packshot with a margin.
           */
          copies: [],
          placed: reading.products,
          /*
           * The picture's own proportions, read from the file rather
           * than assumed from the prompt: the cell's aspect ratio is
           * ASKED for and the image model answers with whatever it
           * renders, usually a square.
           */
          picture: await pictureAspect(file),
        });
        if ('error' in stood) {
          set({ busy: null, error: stood.error });
          return;
        }
        if (stood.patches.size === 0) {
          set({ busy: null, error: 'ingen af varerne kunne genfindes i billedet' });
          return;
        }

        live.gesture = null;
        mutate((doc) => withPatches(doc, [stood]));

        const ghost = await keepGhost(brandId, stood, bytes, file.name);
        set({
          busy: null,
          ghosts: withGhost(get().ghosts, ghost),
          note: [
            `${count(stood.patches.size, 'vare', 'varer')} stillet op efter billedet`,
            reading.missing.length > 0
              ? `${reading.missing.length} kunne ikke genfindes og står som før`
              : '',
            stood.complaints.length > 0
              ? `${count(stood.complaints.length, 'advarsel', 'advarsler')} — se tallene i panelet`
              : '',
            ghost ? 'referencen ligger over flisen' : '',
          ].filter(Boolean).join(' · '),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    /*
     * The whole page in one press — every tile, not only the ones put
     * together by hand. A tile of one product first has its picture
     * taken apart into the products it shows (a few at a time, as the
     * single tile's own button does it); then every tile of two or more
     * is stood up in one run. A picture of one product stays as it is.
     */
    async standUpClusters(pageId: string) {
      const { document } = get();
      const page = document?.pages.find((entry) => entry.id === pageId);
      if (!document || !page) return;
      const singles = page.placements
        .map((placement) => document.offers.find((offer) => offer.id === placement.offerId))
        .filter((offer): offer is Offer => offer !== undefined)
        .filter((offer) => offer.members.length <= 1 && Boolean(offer.imageUrl || offer.imagePack.length > 1));
      if (singles.length > 0) {
        let done = 0;
        set({ busy: `Finder varerne i billederne… 0/${singles.length}`, error: null, note: null });
        await pool(singles, 3, async (offer) => {
          try { await splitOffer(offer.id); } catch { /* one tile's picture failing is not the page's */ }
          done += 1;
          set({ busy: `Finder varerne i billederne… ${done}/${singles.length}` });
        });
        set({ busy: null });
      }
      await standUpOn((get().document?.pages ?? []).filter((entry) => entry.id === pageId));
    },

    standUpAllClusters: () => standUpOn(get().document?.pages ?? []),

    standUpOneCluster: (offerId: string) => standUpOn(get().document?.pages ?? [], offerId),

    async splitAndStandUp(offerId) {
      set({ busy: 'Finder varerne i billedet…', error: null, note: null });
      try {
        const found = await splitOffer(offerId);
        if (found < 2) {
          set({ busy: null, note: 'billedet viser kun én vare — der er intet at stille op' });
          return;
        }
        set({ busy: null, note: `${count(found, 'vare', 'varer')} fundet i billedet — stiller dem op` });
        await get().standUpOneCluster(offerId);
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },

    toggleGhost: (offerId) => set((state) => ({
      ghosts: state.ghosts.map((entry) => (entry.offerId === offerId
        ? { ...entry, shown: !entry.shown }
        : entry)),
    })),

    async setTileImage(offerId, file) {
      const { brandId } = get();
      if (!brandId) return;
      set({ busy: `Skærer baggrunden fra ${file.name}…`, error: null });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        /*
         * Cut on the way in, and this is the one upload in the studio
         * that is.
         *
         * A composed cluster is drawn to a prompt that demands white to
         * all four edges precisely so it can be keyed out, and a white
         * rectangle on SuperBrugsen's yellow reads as a rendering bug.
         * Every other upload here is a designer's own photograph and is
         * stored untouched — a flood fill on one of those takes the sky.
         */
        const { url, cut } = await api.uploadImage(brandId, toBase64(bytes), file.name, true);
        // The dev server's static tree needs a beat to notice a path it
        // has never served — see `reachable`.
        if (!await reachable(url)) throw new Error(`${url} kunne ikke hentes igen`);

        live.gesture = null;
        mutate((document) => ({
          ...document,
          offers: document.offers.map((offer) => (offer.id === offerId
            /*
             * One picture, so the pack goes. `members` stays: the
             * document still has to be able to say what the price
             * covers, even though the page no longer shows them apart.
             */
            ? { ...offer, imageUrl: url, imagePack: [] }
            : offer)),
          pages: document.pages.map((page) => ({
            ...page,
            // The per-variant corrections described products that are
            // no longer drawn separately. Left behind they would be
            // applied to whatever happened to land on those indices.
            placements: page.placements.map((placement) => (placement.offerId === offerId
              ? { ...placement, overrides: { ...placement.overrides, pack: {} } }
              : placement)),
          })),
        }));
        /*
         * Said out loud when the fill found nothing.
         *
         * `kept` near 1 means the picture had no white field to remove —
         * a model that drew a room, a table, a gradient. The file is on
         * the tile either way, because it is the editor's file and
         * refusing it would be worse; but they are told, because the
         * alternative is discovering a white rectangle on a coloured
         * page at the proof stage.
         */
        const uncut = cut !== undefined && cut.kept > 0.97;
        set({
          busy: null,
          selectedPack: null,
          note: uncut ? null : `${file.name} lagt på flisen · baggrunden skåret fra`,
          error: uncut
            ? `${file.name} har ingen hvid baggrund at skære fra — den lagt på som den er.`
              + ' Bed modellen om ren hvid bund helt ud til kanten.'
            : null,
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },
  };
}
