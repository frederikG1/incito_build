import type { Offer, PlacementOverrides, TileArrangement } from '@incitio/schema';
import { slotAssignmentOrder, slotCells } from '@incitio/schema';
import { groupOffers, notOnePhotograph } from '@incitio/schema';
import { resolveTemplate, templatesForCount } from '@incitio/brands';
import { pagedSheet } from '@incitio/renderer';
import { freeSlots, growTemplate, grownId } from '../../grid.js';
import * as api from '../../api.js';
import { pool } from '../../pool.js';
import { count, type StudioState } from '../model.js';
import { message, reachable } from '../cluster.js';
import { FRESH, reseat } from '../layout.js';
import type { StoreContext } from '../context.js';
import { printedOffers, sameShown } from '../twins.js';

/** Varer sat på sider og i celler. */
export function placingActions(ctx: StoreContext): Pick<StudioState, 'addOffersToPage' | 'removeOfferFromPage' | 'fillSlot' | 'composeSlot' | 'testCluster' | 'pageSlots'> {
  const { set, get, pageById, mutate, settleGroup, standUpOn, live } = ctx;
  return {
    addOffersToPage(pageId, offerIds) {
      const { brand, document, feedOffers } = get();
      if (!brand || !document) return;
      const page = document.pages.find((p) => p.id === pageId);
      if (!page || page.kind !== 'offers') return;

      /*
       * Nothing that is already printed somewhere.
       *
       * The cell-level check was here from the start; the book-level
       * one was not, so a product on page one could be dealt onto page
       * three and the avis would print it twice. The library no longer
       * lets one be ticked — see `toggleLibraryPick` — and this is the
       * same rule at the place that actually seats them, so no other
       * caller can get round it.
       */
      const already = get().placedAt();
      // Nor the same product under another id — a publication's copy of a feed offer. See `sameShown`.
      const printed = printedOffers(document);
      const offerOf = (id: string) => document.offers.find((o) => o.id === id) ?? feedOffers.find((o) => o.id === id);
      const twin = (id: string) => { const offer = offerOf(id); return Boolean(offer && printed.some((p) => sameShown(offer, p))); };
      const wanted = [...new Set(offerIds)].filter((id) => !already.has(id) && !twin(id));
      if (wanted.length === 0) {
        const where = [...new Set(offerIds.map((id) => already.get(id)).filter(Boolean))];
        set({
          error: offerIds.length === 1
            ? `Varen ligger allerede på ${where[0] ?? 'en side'}`
            : `Varerne ligger allerede i avisen (${where.join(', ')})`,
        });
        return;
      }

      /*
       * A product picked out of the library may not be in the document
       * yet — the library also lists what is merely in the feed. It is
       * copied in here, because a document embeds the offers it prints:
       * a catalogue that could only be re-rendered while this week's
       * file was still open would not be reproducible.
       */
      const known = new Map(document.offers.map((offer) => [offer.id, offer]));
      const library = new Map(feedOffers.map((offer) => [offer.id, offer]));
      const missing = wanted.filter((id) => !known.has(id) && !library.has(id));
      if (missing.length > 0) {
        set({ error: `${count(missing.length, 'vare', 'varer')} findes hverken i avisen eller i feedet` });
        return;
      }
      const incoming = wanted
        .filter((id) => !known.has(id))
        .map((id) => library.get(id)!);

      const current = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      if (!current) return;

      const open = freeSlots(page, current).map((slot) => slot.id);
      const needed = page.placements.length + wanted.length;

      let templateId = page.templateId;
      let templates = document.templates;
      let placements = page.placements;
      let seats = open;

      if (open.length < wanted.length) {
        /*
         * A shape somebody drew beats a shape we grew, every time — so
         * the chain's own set is asked first, and only a page whose
         * layout is already the chain's may move within it. A page read
         * off a printed sheet has a grid describing that sheet; swapping
         * it for a brand layout would throw away the very thing the
         * import was for.
         *
         * Asked of the DOCUMENT, not of the brand. `state.brand` carries
         * the document's own layouts folded in — that is what makes them
         * renderable and re-seatable — so `resolveTemplate` answers yes
         * for both kinds and cannot tell them apart. The document's list
         * can: a template in it is one that travelled with these pages
         * and belongs to them.
         */
        const ownLayout = document.templates.some((t) => t.id === page.templateId);
        const designed = ownLayout ? undefined : templatesForCount(brand, needed)[0];

        if (designed) {
          const slots = slotAssignmentOrder(designed);
          placements = reseat(page, brand, designed);
          templateId = designed.id;
          seats = slots.slice(placements.length).map((slot) => slot.id);
        } else {
          const grown = growTemplate(
            current, wanted.length - open.length, grownId(pageId, needed),
          );
          if (!grown) {
            set({ error: 'siden kan ikke bære flere varer — læg dem på en ny side' });
            return;
          }
          templateId = grown.template.id;
          templates = [
            ...document.templates.filter((t) => t.id !== grown.template.id),
            grown.template,
          ];
          seats = [...open, ...grown.added];
        }
      }

      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        offers: [...doc.offers, ...incoming],
        templates,
        pages: doc.pages.map((p) => (p.id === pageId ? {
          ...p,
          templateId,
          placements: [
            ...placements,
            ...wanted.map((offerId, index) => ({
              offerId,
              slotId: seats[index]!,
              overrides: FRESH,
            })).filter((placement) => placement.slotId),
          ],
        } : p)),
      }));

      set({
        librarySelection: get().librarySelection.filter((id) => !wanted.includes(id)),
        note: `${count(wanted.length, 'vare', 'varer')} lagt på siden`,
        error: null,
      });
    },

    removeOfferFromPage(pageId, offerId) {
      live.gesture = null;
      mutate((document) => ({
        ...document,
        pages: document.pages.map((page) => (page.id === pageId ? {
          ...page,
          placements: page.placements.filter((placement) => placement.offerId !== offerId),
        } : page)),
      }));
      if (get().selectedOfferId === offerId) {
        set({ selectedOfferId: null, selectedPart: null, selectedPack: null });
      }
    },

    async fillSlot(pageId, slotId, offerIds, options = {}) {
      const { brand, document, feedOffers } = get();
      if (!brand || !document) return;
      const page = document.pages.find((p) => p.id === pageId);
      if (!page || page.kind !== 'offers') return;

      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      const slot = template?.slots.find((entry) => entry.id === slotId);
      if (!template || !slot) return;

      /*
       * Looked up in the document first and in the week's file second,
       * because a product picked out of the library may be either: what
       * is already in the catalogue, or what is merely in the feed.
       */
      const known = new Map([
        ...document.offers.map((offer) => [offer.id, offer] as const),
        ...feedOffers.map((offer) => [offer.id, offer] as const),
      ]);
      const picked = [...new Set(offerIds)]
        .map((id) => known.get(id))
        .filter((offer): offer is Offer => Boolean(offer));
      if (picked.length === 0) return;
      if (picked.length > 8) {
        set({ error: 'en plads kan bære otte varer — vælg færre' });
        return;
      }

      /*
       * How they sit together is asked, not assumed.
       *
       * The stylesheet's own rule draws the arrangement from the
       * offer's id: stable between renders, varied across a page, and
       * blind to what the products actually look like. That is the
       * right default for a tile nobody chose and a poor answer for one
       * an editor has just assembled — six upright bottles fan and six
       * flat trays do not, and the difference is in the photographs.
       *
       * So the model is shown the packshots and answers with an order,
       * one of four arrangement names and the two lines of Danish the
       * tile prints. It never returns geometry: the cell is where it
       * was and the stylesheet still draws the page.
       *
       * One product needs none of this, and a failure costs nothing —
       * `arrangeGroup` answers with the stylesheet's own choice and
       * says so with `model: null`.
       */
      const cell = slotCells(template, brand.pageAspect).get(slotId);
      /*
       * Picked order, stylesheet arrangement, the group's own name.
       *
       * All three used to be the model's and are now the defaults the
       * drop lands with — `settleGroup` improves on them afterwards if
       * it can. Kept as variables because the compose path still
       * names the image model in `by`.
       */
      const seated = picked;
      const arrangement: TileArrangement | null = null;
      let by: string | null = null;

      /*
       * The model no longer stands between the products and the cell.
       *
       * It used to: fifteen seconds of "Modellen sætter varerne
       * sammen…" with the whole toolbar greyed out, in front of an
       * answer that is an order, one of four stylesheet arrangements
       * and two lines of Danish. None of the three is needed for the
       * products to be in the cell and print — the pick order is an
       * order, the stylesheet has a default, and the tile has the name
       * `groupOffers` gave it.
       *
       * So the drop is instant and free, and the model's opinion is
       * fetched behind it and applied when it lands — see
       * `settleGroup`, which writes nothing over anything the editor
       * has touched in the meantime.
       */
      void cell;

      /*
       * Named after the cell it fills, so filling the same cell twice
       * replaces the tile rather than leaving the first one behind in
       * the document. It is also what keeps the cluster's arrangement
       * steady between renders when no model chose one — `packStyle`
       * draws it from the id.
       */
      let assembled = seated.length === 1
        ? seated[0]!
        : groupOffers(seated, `group/${pageId}/${slotId}`);

      /*
       * One photograph instead of a row of cutouts.
       *
       * The image model is handed the cutouts and asked to photograph
       * them standing together — shared floor, one hero in front, the
       * rest overlapping at the edges. What comes back replaces the
       * pack: the tile draws one picture, exactly as it does for a
       * published "frit valg" tile, whose photograph is also one image
       * of several products.
       *
       * `members` survives it, so the document still says what the
       * price covers even though the page no longer shows them apart.
       * The cost is stated where the button is: a composed tile cannot
       * be edited product by product.
       */
      if (options.compose && seated.length > 1) {
        set({ busy: 'AI sætter varerne op…', error: null, note: null });
        try {
          const drawn = await api.composeCluster(get().brandId!, {
            offers: seated,
            ...(cell?.aspect ? { aspect: cell.aspect } : {}),
            ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
          });
          // Same beat as `setTileImage`: a path the dev server has
          // never served answers 404 for a moment, and a tile that
          // names it shows a broken image until the next reload.
          if (!await reachable(drawn.url)) {
            throw new Error(`${drawn.url} kunne ikke hentes igen`);
          }
          assembled = { ...assembled, imageUrl: drawn.url, imagePack: [] };
          by = drawn.model;
        } catch (error) {
          set({ busy: null, error: message(error) });
          return;
        }
        set({ busy: null });
      }

      /*
       * A placement with nothing decided on it yet.
       *
       * The heading and the arrangement are written onto the PLACEMENT
       * rather than into the offer, the same way every other hand
       * correction is: the assembled record keeps the feed's own
       * facts, and the page keeps what somebody decided to print.
       * `settleGroup` fills them in a moment later, and so can a
       * person — whichever comes first wins.
       */
      const overrides: PlacementOverrides = { ...FRESH, arrangement };

      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        /*
         * The members travel with the document as well as the group.
         *
         * They are what the tile is showing, and a catalogue that
         * carried only the assembled record could not say what the
         * price covers once this week's file was gone. `benched` knows
         * they are on the page — see the note there.
         *
         * The group itself is rewritten rather than appended: filling
         * the same cell twice replaces its tile, and two offers under
         * one id is how a placement ends up pointing at last week's.
         */
        offers: [
          ...doc.offers.filter((offer) => offer.id !== assembled.id),
          ...seated.filter((member) => member.id !== assembled.id
            && !doc.offers.some((offer) => offer.id === member.id)),
          assembled,
        ],
        pages: doc.pages.map((p) => (p.id === pageId ? {
          ...p,
          placements: [
            // Whatever stood here goes to the bench: it stays in the
            // document, it is simply no longer on a page.
            ...p.placements.filter((placement) => placement.slotId !== slotId),
            { offerId: assembled.id, slotId, overrides },
          ],
        } : p)),
      }));

      set({
        librarySelection: [],
        selectedOfferId: assembled.id,
        selectedPart: null,
        selectedPack: null,
        note: seated.length === 1
          ? 'Varen lagt i pladsen'
          : [
            `${count(seated.length, 'vare', 'varer')} samlet i én plads`,
            options.compose ? 'som ét fotografi' : '',
            by ? `sat op af ${by}` : '',
          ].filter(Boolean).join(' · '),
      });

      /*
       * No model here. A plain fill — "Saml i pladsen", or a drop of
       * several products — used to ask the AI for the order and two
       * lines of text behind the finished tile, which no button said and
       * the house rule forbids (model calls only on an explicit action).
       * The products stand in the order they were picked, in the chain's
       * own arrangement; "Saml og stil pænt op" (`composeSlot`) is the
       * AI way, and says so.
       */
    },

    async composeSlot(pageId, slotId, offerIds) {
      /*
       * The cutouts, started before anything else.
       *
       * The arrangement cannot begin until the cell holds the products
       * AND the page has drawn them — see below — and that is two
       * writes, a render and a frame during which nothing at all is
       * being fetched. The pictures are the slowest part that does not
       * need any of it: they are somebody else's image service, one
       * request per product.
       *
       * Fired and dropped. `fetchImages` holds the PROMISE for ten
       * minutes, not just the answer, so the real call a moment later
       * joins this one rather than starting a second — see `cached` in
       * @incitio/decor. A failure here is not reported and must not
       * be: the call that needs it will fail again, with the tile in
       * front of the person reading it.
       */
      const warming = get().brandId;
      if (warming) {
        const pool = [...get().feedOffers, ...(get().document?.offers ?? [])];
        const chosen = offerIds
          .map((id) => pool.find((offer) => offer.id === id))
          .filter((offer): offer is Offer => Boolean(offer));
        if (chosen.length > 1) {
          void api.prepareCluster(warming, { offers: chosen }).catch(() => undefined);
        }
      }

      /*
       * Group first, with no model involved.
       *
       * The cell has to hold the products, and the page has to have
       * DRAWN them, before anything can be measured: the arithmetic
       * that moves a cutout reads where it currently stands from the
       * browser — see `standUpCluster`. So this is not an optimisation
       * step that could be folded into the next one; it is what makes
       * the next one possible.
       */
      /*
       * Seated with no model at all.
       *
       * The arrangement call decides three things — the order, one of
       * four stylesheet arrangements, and the two Danish lines the
       * tile prints — and the placement that follows a moment later
       * overwrites every position it chose. So the wait for it is
       * fifteen seconds of spinner in front of an answer nobody sees.
       * The wording is the part worth having, and it is fetched
       * BESIDE the placement rather than in front of it.
       */
      await get().fillSlot(pageId, slotId, offerIds, { arrange: false });

      const placed = pageById(pageId)?.placements.find((entry) => entry.slotId === slotId);
      if (!placed) return;

      // Not awaited: the two lines land when they land, and the
      // arrangement is already under way.
      void settleGroup(pageId, slotId, placed.offerId, false);

      /*
       * One paint before measuring.
       *
       * `fillSlot` has only just written the document; React has not
       * yet put the new tile on the page, and measuring a tile that
       * is not there yet reports "flisen skal være synlig på siden".
       *
       * A frame OR a tick, whichever comes first, and the tick is not
       * a belt-and-braces: `requestAnimationFrame` does not fire in a
       * tab that is not being drawn. Measured — in a background tab
       * this awaited forever, and the button looked like it had done
       * nothing at all.
       */
      await Promise.race([
        new Promise((ready) => { requestAnimationFrame(() => ready(null)); }),
        new Promise((ready) => { setTimeout(ready, 60); }),
      ]);

      /*
       * Quietly: the products are already in the cell and the page
       * already prints. What follows improves the arrangement, and
       * the editor should be able to go on working while it does.
       */
      await standUpOn(
        (get().document?.pages ?? []).filter((page) => page.id === pageId),
        placed.offerId,
        true,
      );
    },

    async testCluster() {
      const { brandId } = get();
      if (!brandId) return;

      // A draft first, when there is nothing to put a tile on. The
      // plain one: no model, no key, instant.
      if (!get().document) {
        if (!get().feed) {
          set({ error: 'der er intet feed at bygge af' });
          return;
        }
        await get().build({ fresh: true });
      }

      const document = get().document;
      const page = document?.pages.find((entry) => entry.kind === 'offers');
      if (!document || !page) return;

      const slot = get().pageSlots(page.id)[0];
      if (!slot) {
        set({ error: 'Siden har ingen pladser at fylde. Vælg et layout til siden først.' });
        return;
      }

      /*
       * Three products with photographs, out of ONE family.
       *
       * The family part is not tidiness. A tile holding washing
       * powder, a pizza and a beer is three offers that happen to
       * share a cell, and `notOnePhotograph` refuses it — rightly, and
       * measured: the first version of this button took the first
       * three products in the feed and was turned down every other
       * press. So the first category that can field a group is the
       * one it picks.
       */
      const usable = [...get().feedOffers, ...document.offers]
        .filter((offer) => offer.imageUrl && offer.members.length === 0);
      const families = new Map<string, Offer[]>();
      for (const offer of usable) {
        const family = offer.category || 'uden kategori';
        families.set(family, [...(families.get(family) ?? []), offer]);
      }
      const picked = [...families.values()]
        .map((group) => group.slice(0, 3))
        .find((group) => group.length >= 2 && !notOnePhotograph(group));
      if (!picked) {
        set({ error: 'ingen varegruppe har to varer med billede, der kan være ét fotografi' });
        return;
      }

      set({ activePageId: page.id });
      await get().composeSlot(page.id, slot.slotId, picked.map((offer) => offer.id));
    },

    pageSlots(pageId) {
      const { brand, document } = get();
      const page = document?.pages.find((p) => p.id === pageId);
      if (!brand || !document || !page || page.kind !== 'offers') return [];
      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((t) => t.id === page.templateId);
      if (!template) return [];

      const names = new Map(document.offers.map((offer) => [offer.id, offer.name]));
      const sheet = pagedSheet(page.incito);
      // Reading order, which is the order the cells are drawn in — a
      // picker numbered by the template's declaration order would count
      // differently from the page in front of the person using it.
      return slotAssignmentOrder(template).map((slot, index) => {
        const sitting = page.placements.find((placement) => placement.slotId === slot.id);
        // A page picture's cell shows what was printed there until it is filled.
        const printed = !sitting && sheet && !sheet.printed?.[slot.id];
        const name = sitting ? names.get(sitting.offerId) ?? sitting.offerId : printed ? 'som trykt' : 'tom';
        return { slotId: slot.id, label: `${index + 1} · ${name.slice(0, 28)}` };
      });
    },
  };
}
