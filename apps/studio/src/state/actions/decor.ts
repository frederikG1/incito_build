import type { Offer } from '@incitio/schema';
import * as api from '../../api.js';
import { pool } from '../../pool.js';
import { MOTIF_SUBJECT, loadPagePictures, measurePage, motifDecoration, motifTarget } from '../../backdropMeasure.js';
import { nearestAspect } from '@incitio/decor/backdrop';
import { count, type StudioState } from '../model.js';
import { message, WAY_KEY, IMAGE_MODEL_KEY, PLACE_MODEL_KEY, STRICT_KEY, PROMPT_KEY, PROMPT_ID_KEY, remember } from '../cluster.js';
import type { StoreContext } from '../context.js';

/** Stemningsbilleder og AI-indstillinger. */
export function decorActions(ctx: StoreContext): Pick<StudioState, 'setDecorNote' | 'setDecorStyle' | 'setClusterWay' | 'setClusterImageModel' | 'setClusterPlaceModel' | 'setPlaceStrict' | 'setClusterPrompt' | 'setClusterPromptId' | 'setImageKey' | 'drawBackdrops' | 'decorate'> {
  const { set, get, mutate, live } = ctx;
  return {
    setDecorNote: (value) => set({ decorNote: value }),
    setDecorStyle: (value) => set({ decorStyle: value }),

    setClusterWay: (way) => {
      remember(WAY_KEY, way);
      set({ clusterWay: way });
    },

    setClusterImageModel: (model) => {
      remember(IMAGE_MODEL_KEY, model);
      set({ clusterImageModel: model });
    },

    setClusterPlaceModel: (model) => {
      remember(PLACE_MODEL_KEY, model);
      set({ clusterPlaceModel: model });
    },

    setPlaceStrict: (strict) => {
      remember(STRICT_KEY, strict ? '1' : '0');
      set({ placeStrict: strict });
    },

    setClusterPrompt: (prompt) => {
      remember(PROMPT_KEY, prompt);
      set({ clusterPrompt: prompt });
    },

    setClusterPromptId: (id) => {
      remember(PROMPT_ID_KEY, id);
      set({ clusterPromptId: id });
    },

    setImageKey: (key) => {
      api.setImageKey(key);
      set({
        imageKeyTail: api.imageKeyTail(),
        decorReady: get().serverKey || api.hasImageKey(),
      });
    },

    /**
     * Paint mood artwork behind the offers on every page.
     *
     * Pushed onto the history like any other edit, so it is one ⌘Z — the
     * whole point of returning a document rather than patching pages.
     * Nothing else about the catalogue moves: decoration runs over a
     * finished layout and touches no placement.
     *
     * The note says how many pages were deliberately left plain, because
     * that is the number people query. A page with no motif looks like a
     * failure and is usually the model correctly refusing to put a
     * photograph of toilet paper behind the toilet paper.
     */
    async drawBackdrops(pageIds) {
      const { brandId, document, decorStyle } = get();
      if (!brandId || !document) return;
      // The published pages' packshots, measured by the product and not its box.
      await Promise.all(pageIds.map(loadPagePictures));

      const tasks = pageIds.map((pageId) => {
        const page = document.pages.find((entry) => entry.id === pageId);
        if (!page || page.kind === 'image') return null;
        const measure = measurePage(pageId, page.ground);
        if (!measure) return null;
        const offers = page.placements
          .map((placement) => document.offers.find((entry) => entry.id === placement.offerId))
          .filter((offer): offer is Offer => Boolean(offer));
        // The place is chosen here, and there always is one — see `motifTarget`.
        return { page, measure, offers, target: motifTarget(measure) };
      }).filter((task): task is NonNullable<typeof task> => Boolean(task));
      if (tasks.length === 0) {
        set({ error: 'fandt ingen sider at tegne til — åbn siden først' });
        return;
      }

      let finished = 0;
      set({ busy: `Tegner motiver… 0/${tasks.length}`, error: null, note: null });
      const failures: string[] = [];
      const drawn = await pool(tasks, 3, async (task) => {
        const number = document.pages.indexOf(task.page) + 1;
        // What the page is about: its heading, else its leading offer.
        const about = task.page.title.trim() || task.offers[0]?.name || 'tilbud';
        try {
          /*
           * One motif, drawn in exactly the shape of its place. The model
           * draws at the nearest shape it offers; that picture is fitted
           * into the place, and the cut-out lands where it sat in the
           * picture — there is nothing about the page to get wrong.
           */
          const t = task.target;
          const ratio = task.measure.ratio;
          const aspect = nearestAspect(((t.x1 - t.x0) * ratio) * 10, (t.y1 - t.y0) * 10);
          const [aw, ah] = aspect.split(':').map(Number) as [number, number];
          const reply = await api.drawBackdrop(brandId, {
            ...task.measure,
            aspect,
            offer: about,
            /*
             * The page's lead product only. Every name on the page made
             * the model show every product — schnitzel, meatballs and a
             * plate of mash on one freezer page. One motif is the point.
             */
            products: task.offers[0] ? [task.offers[0].name] : [],
            ...(decorStyle.trim() ? { style: decorStyle.trim() } : {}),
            isolated: true,
          });
          const stamp = Date.now().toString(36);
          const tw = t.x1 - t.x0; const th = t.y1 - t.y0;
          // Width over height on the page, in the page's own percent units.
          const drawn = aw / ah / ratio;
          const fw = Math.min(tw, th * drawn);
          const fh = fw / drawn;
          const frame = { x0: t.x0 + (tw - fw) / 2, y0: t.y0 + (th - fh) / 2, w: fw, h: fh };
          const decorations = reply.motifs.slice(0, 1).map((motif, index) => motifDecoration({
            ...motif,
            spot: {
              x0: frame.x0 + (motif.spot.x0 / 100) * frame.w, x1: frame.x0 + (motif.spot.x1 / 100) * frame.w,
              y0: frame.y0 + (motif.spot.y0 / 100) * frame.h, y1: frame.y0 + (motif.spot.y1 / 100) * frame.h,
            },
          }, ratio, `motif-${stamp}-${index}`, `${MOTIF_SUBJECT} ${about}`, 0));
          if (decorations.length === 0) {
            failures.push(`Side ${number}: billedet havde intet motiv — prøv igen`);
            return null;
          }
          return { pageId: task.page.id, decorations };
        } catch (error) {
          failures.push(`Side ${number}: ${message(error)}`);
          return null;
        } finally {
          finished += 1;
          set({ busy: `Tegner motiver… ${finished}/${tasks.length}` });
        }
      });

      const done = drawn
        .map((entry) => (entry.ok ? entry.value : null))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (done.length > 0) {
        live.gesture = null;
        /*
         * Laid on the page as decorations — movable like every other
         * picture. Drawing again replaces the page's earlier motifs
         * rather than piling new ones on them.
         */
        mutate((doc) => ({
          ...doc,
          pages: doc.pages.map((page) => {
            const mine = done.find((entry) => entry.pageId === page.id);
            if (!mine) return page;
            // First in the list, so the page's own pictures — its logo,
            // its heading artwork — are painted over them.
            const kept = page.decorations.filter((decor) => !decor.id.startsWith('motif-'));
            return { ...page, decorations: [...mine.decorations, ...kept].slice(0, 12) };
          }),
        }));
      }
      set({
        busy: null,
        note: done.length > 0
          ? `${count(done.length, 'side', 'sider')} fik motiver — tag dem i hånden under siden for at flytte dem`
          : null,
        error: failures.length > 0 ? failures.slice(0, 3).join(' · ') : null,
      });
    },

    async decorate(pageIds) {
      const { brandId, document, decorNote, decorStyle, past } = get();
      if (!brandId || !document) return;

      set({ busy: 'Finder et motiv i sidens varer og tegner det…', error: null, note: null });
      try {
        const reply = await api.decorateDocument(brandId, document, {
          brief: decorNote,
          style: decorStyle,
          ...(pageIds ? { pageIds } : {}),
        });
        const number = (pageId: string) =>
          reply.document.pages.findIndex((page) => page.id === pageId) + 1;
        set({
          document: reply.document,
          past: [...past.slice(-29), document],
          future: [],
          busy: null,
          note: [
            // What was drawn, by name — "Side 3: kaffebønner" says why the
            // picture is there; a count does not.
            reply.subjects && reply.subjects.length > 0 && reply.subjects.length <= 4
              ? reply.subjects.map((entry) => `Side ${number(entry.pageId)}: ${entry.subject}`).join(' · ')
              : `${count(reply.drawn, 'side', 'sider')} fik et stemningsbillede`,
            ...(reply.cached > 0 ? [`${reply.cached} fra cache`] : []),
            ...(reply.skipped > 0
              ? [pageIds?.length === 1 && reply.drawn === 0
                ? 'intet oplagt motiv i sidens varer'
                : `${reply.skipped} bevidst uden`]
              : []),
          ].join(' · '),
          // Reported, not thrown: pages that DID get artwork are kept.
          ...(reply.errors.length > 0
            ? { error: reply.errors.map((e) => e.message).join(' · ') }
            : {}),
        });
      } catch (error) {
        set({ busy: null, error: message(error) });
      }
    },
  };
}
