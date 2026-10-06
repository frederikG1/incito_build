import type { CatalogDocument, CatalogWeek, Offer } from '@incitio/schema';
import { CatalogPage, slotCells } from '@incitio/schema';
import { groupOffers } from '@incitio/schema';
import { weekName } from '@incitio/schema';
import { coveredByText, type Finding } from '../findings.js';
import { resolveTemplate } from '@incitio/brands';
import { sizedImage } from '@incitio/renderer';
import * as api from '../api.js';
import { onWhite } from '../ink.js';
import { pool } from '../pool.js';
import { placePrompt } from '@incitio/curator/place-prompt';
import { byImportance, departmentOf, familyOf, type Department } from '@incitio/compose';
import { count, type StudioState } from './model.js';
import { message, withTemplates, toBase64, reachable, pictureAspect, cutoutAspect, packMembers, type Ghost, type StoodUp, standUpCluster, backToFront, tileName, withPatches, keepGhost, withGhost, pagePhotographs, CLUSTER_AT_ONCE, type ClusterRun, PROMPT_RUNS, RUNS_KEY } from './cluster.js';
import { FRESH, withFeedFacts, DIFF_NAMES, kroner, rememberCells, unplaced, THUMB_PX, EDITOR_PX } from './layout.js';
import type { StoreApi } from 'zustand';

/**
 * What every slice of the studio's store shares: `set` and `get`, the
 * open-gesture bookkeeping (`live`), and the helpers the actions call —
 * loading a feed, mutating the document with one undo step, standing a
 * cluster up. They lived in the closure of `create` beside 300 actions;
 * here they are made once per store and handed to each slice.
 */
export function makeContext(set: StoreApi<StudioState>['setState'], get: StoreApi<StudioState>['getState']) {
  /*
   * The open gesture, if one is running. Not part of the public state:
   * it is bookkeeping for the undo stack, and a component that read it
   * would be reaching into how history is kept.
   */
  const live = { gesture: null as string | null, opening: 0 };
  let idle: number | undefined;

  /**
   * Keep a keyboard gesture open while the key repeats.
   *
   * Held arrow keys are one movement to the person holding them, so
   * they have to be one entry in history — but there is no key-up to
   * close the gesture on when the user simply stops. A short idle
   * window is what separates "still nudging" from "done".
   */
  function repeating(name: string): string {
    window.clearTimeout(idle);
    idle = window.setTimeout(() => { live.gesture = null; }, 600);
    return name;
  }

  /**
   * Run a feed through the chain's own reader and put the products in
   * the library.
   *
   * Shared by the upload and by the sample the chain ships, because the
   * difference between the two is only how loudly it is announced: an
   * upload is something somebody just did and gets a line about what was
   * in the file; the sample is simply what the editor opens with, and
   * saying "1235 varer" about it every time the page reloads is noise.
   *
   * Failure never costs the feed. The plain draft and the rebuild both
   * take the raw text and run their own reader, and one of them may yet
   * be pointed at the right source by hand — so a file this could not
   * read stays loaded, and only the library is empty.
   */
  /*
   * The week's photographs, fetched before anybody asks for them.
   *
   * Laying a new week into the avis takes a few milliseconds; what the
   * pages then wait for is several hundred product photographs. Fetched
   * here, quietly and a few at a time, at the sizes the overview and the
   * page editor draw them, they are in the browser's cache by the time
   * the pages want them. A newer feed stops an older warm-up.
   *
   * Through the API's image cache (`image-route.ts`): warmed straight
   * from the chain's image service, every reload asked it for every
   * picture twice, and Republica wrote to ask why.
   */
  let warming = 0;
  function warmImages(offers: Offer[]): void {
    const run = ++warming;
    const urls = [...new Set(offers.flatMap((offer) => [offer.imageUrl, ...offer.imagePack])
      .filter((url): url is string => Boolean(url)))];
    const queue = [...urls.map((url) => sizedImage(url, THUMB_PX)), ...urls.map((url) => sizedImage(url, EDITOR_PX))];
    const next = (): void => {
      const url = queue.shift();
      if (!url || run !== warming) return;
      const image = new Image();
      image.decoding = 'async';
      image.onload = image.onerror = () => next();
      image.src = url;
    };
    for (let lane = 0; lane < 6; lane += 1) next();
  }

  async function loadFeed(
    brandId: string, name: string, text: string, announce: boolean,
  ): Promise<void> {
    if (announce) set({ busy: 'Læser feedet…' });
    try {
      /*
       * Read again, a few times, before giving up. On a reload the API
       * may still be starting, and a single miss left the list of the
       * week's products empty with nothing on screen to say why.
       */
      let reading: Awaited<ReturnType<typeof api.readFeed>> | null = null;
      for (let attempt = 0; !reading; attempt += 1) {
        try {
          reading = await api.readFeed(brandId, text, name);
        } catch (error) {
          if (attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        }
      }
      warmImages(reading.offers);
      // What the avis's own products did not know yet, from the week's file — see `withFeedFacts`.
      const open = get().document;
      const healed = open ? withFeedFacts(open, reading.offers) : null;
      set({
        ...(healed && healed !== open ? { document: healed } : {}),
        feedOffers: reading.offers,
        feedReading: { source: reading.source, withImage: reading.withImage },
        librarySelection: [],
        ...(announce
          ? {
            libraryOpen: true,
            busy: null,
            note: [
              reading.source.name,
              count(reading.offers.length, 'vare', 'varer'),
              `${reading.withImage} med billede`,
            ].join(' · '),
          }
          : {}),
      });
    } catch (error) {
      set({
        feedOffers: [],
        feedReading: null,
        ...(announce
          ? { busy: null, error: `${name} kunne ikke læses: ${message(error)}` }
          : { error: 'Ugens varer kunne ikke hentes — genindlæs siden om lidt.' }),
      });
    }
  }

  /**
   * What a new cell may be filled with: the avis's own unplaced products
   * and this week's feed, photographed, strongest first — the departments
   * asked for, then their neighbours, never the whole shop. None asked
   * for: the strongest of anything.
   */
  function reserveFor(document: CatalogDocument, wanted: Department[]): { reserve: Offer[]; fromFeed: Offer[] } {
    const related = new Set(wanted.flatMap(familyOf));
    const inAvis = new Set(document.offers.map((offer) => offer.id));
    const fromFeed = get().feedOffers.filter((offer) => !inAvis.has(offer.id) && offer.members.length === 0);
    const free = [...unplaced(document), ...fromFeed].filter((offer) => offer.imageUrl).sort(byImportance(get().brand?.offerRules));
    const own = free.filter((offer) => wanted.length === 0 || wanted.includes(departmentOf(offer)));
    const near = wanted.length === 0 ? [] : free.filter((offer) => !own.includes(offer) && related.has(departmentOf(offer)));
    return { reserve: [...own, ...near], fromFeed };
  }

  /** One placement's corrections, or undefined if it is not on a page. */
  function overridesOf(offerId: string) {
    return get().document?.pages
      .flatMap((page) => page.placements)
      .find((placement) => placement.offerId === offerId)
      ?.overrides;
  }

  function pageById(pageId: string): CatalogPage | undefined {
    return get().document?.pages.find((page) => page.id === pageId);
  }

  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

  /**
   * Push the current document onto the undo stack before mutating it.
   *
   * Naming a gesture that is already open skips the push, so the whole
   * drag lands in history as the one change the user perceives.
   */
  function mutate(
    change: (document: CatalogDocument) => CatalogDocument,
    name?: string,
  ): void {
    const { document, past } = get();
    if (!document) return;
    const continues = name !== undefined && name === live.gesture;
    live.gesture = name ?? null;
    const next = rememberCells(document, change(document));
    set({
      ...(continues ? {} : { past: [...past.slice(-29), document], future: [] }),
      document: next,
      ...templatesFollow(document, next),
    });
  }

  /*
   * The chain carries the document's own layouts folded in — that is
   * how a page on one of them renders at all — and the fold is a copy.
   * When an edit changes the document's layouts (a cell dragged to a
   * new size), the chain's copy has to follow or the page keeps drawing
   * the old one.
   */
  function templatesFollow(before: CatalogDocument, after: CatalogDocument): Partial<StudioState> {
    const brand = get().brand;
    if (!brand || before.templates === after.templates) return {};
    return { brand: withTemplates(brand, after.templates) };
  }

  /**
   * The two Danish lines a cluster prints, fetched alongside the
   * arrangement rather than before it.
   *
   * `arrangeGroup` answers with an order, an arrangement name and
   * these two lines. The first two are what `composeSlot` no longer
   * waits for — the placement replaces them — and this is the part
   * that survives: what the tile is CALLED, which no placement can
   * decide and which the feed does not state for an assembled group.
   *
   * Never load-bearing and never noisy: a failure leaves the tile
   * with the name `groupOffers` gave it, and an editor who has
   * already typed their own heading keeps it.
   */
  async function settleGroup(
    pageId: string,
    slotId: string,
    offerId: string,
    /*
     * Whether the order and the arrangement are the model's to
     * decide, or somebody else's.
     *
     * Both, for a cell filled by hand: nothing else has an opinion
     * about how six cheeses stand. Neither, in the compose path,
     * where a placement call a second later gives every product a
     * position in pixels — applying an order here would only scramble
     * the tile on the way past.
     */
    reorder: boolean,
  ): Promise<void> {
    const { brandId, brand, document } = get();
    if (!brandId || !brand || !document) return;
    const page = document.pages.find((entry) => entry.id === pageId);
    const template = page
      ? resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId)
      : undefined;
    const slot = template?.slots.find((entry) => entry.id === slotId);
    const offer = document.offers.find((entry) => entry.id === offerId);
    if (!template || !slot || !offer || offer.members.length < 2) return;

    const cell = slotCells(template, brand.pageAspect).get(slotId);
    try {
      const said = await api.arrangeGroup(brandId, {
        offers: packMembers(offer, document),
        cell: { role: slot.role, aspect: cell?.aspect ?? 1, width: cell?.width ?? 0.5 },
        ...(get().arrangeNote.trim() ? { note: get().arrangeNote.trim() } : {}),
      });
      /*
       * The cell may not be this cell any more.
       *
       * This runs unawaited, seconds after the products landed, and
       * in those seconds the editor may have filled the cell again,
       * dragged the tile somewhere else or deleted it. Everything
       * below is written only if the same group is still sitting in
       * the same cell.
       */
      const now = overridesOf(offerId);
      const still = pageById(pageId)?.placements
        .some((entry) => entry.slotId === slotId && entry.offerId === offerId);
      if (!now || !still) return;

      /*
       * The order, applied by rebuilding the group.
       *
       * `groupOffers` derives the pack from the member order, so the
       * only way to reorder a tile is to assemble it again — with the
       * SAME id, so the placement goes on pointing at it and every
       * correction on the placement survives.
       *
       * Never over a hand-moved pack: a `pack` override means
       * somebody has already dragged a product in this tile, and
       * reshuffling the pack under them would move the wrong one.
       */
      if (reorder && Object.keys(now.pack).length === 0) {
        const rank = new Map(said.order.map((id, index) => [id, index]));
        const ordered = [...packMembers(offer, get().document!)]
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
        const same = ordered.every((member, index) => member.id === offer.members[index]);
        if (!same) {
          const rebuilt = groupOffers(ordered, offer.id);
          mutate((doc) => ({
            ...doc,
            offers: doc.offers.map((entry) => (entry.id === offer.id ? rebuilt : entry)),
          }), `settle/${offer.id}`);
        }
      }

      // Only into a line nobody has written, and an arrangement
      // nobody has chosen. By the time this lands the editor may have
      // typed their own, and overwriting that would be the worst kind
      // of help.
      const after = overridesOf(offerId);
      if (!after) return;
      get().updateOverrides(offerId, {
        ...(reorder && !after.arrangement && said.arrangement
          ? { arrangement: said.arrangement }
          : {}),
        ...(said.heading && !after.displayName && !after.description
          ? {
            displayName: said.heading,
            ...(said.support ? { description: said.support } : {}),
          }
          : {}),
      }, `settle/${offer.id}`);
    } catch {
      /* The tile keeps the name and the order the group was given. */
    }
  }

  /**
   * Stand every cluster on these sheets up, a few at a time.
   *
   * One routine for one page and for the whole book, because the only
   * difference between them is how many tiles go into the same pool —
   * and the pool is the point. Standing a cluster up is a download, an
   * image model and a vision call, the better part of a minute, and
   * none of it needs anything from the cluster next to it. Done one
   * after the other a six-page book is half an hour; done
   * `CLUSTER_AT_ONCE` at a time it is a few minutes.
   *
   * Three other things the loop used to pay for, gone:
   *   - the cutouts were fetched twice per tile, once for the copies
   *     the measurement needs and once for the composition. `copies`
   *     makes the compose call hand back both.
   *   - the server launched a Chromium per flood fill. It keeps one.
   *   - the same cutout was downloaded again on every re-run. The
   *     server holds them for ten minutes.
   *
   * What has NOT changed: one write at the end, so a book stood up in
   * one go is one undo step, and every failure is a line in the note
   * rather than an exception that takes the other tiles with it.
   */
  /**
   * One product's picture taken apart into the products it shows — three
   * bottles in one packshot become three pictures, each movable. A feed
   * that already photographs each variant needs nothing cut. Returns how
   * many products the tile now holds; below two, nothing is changed.
   */
  async function splitOffer(offerId: string): Promise<number> {
    const { brandId, document } = get();
    const offer = document?.offers.find((entry) => entry.id === offerId);
    if (!brandId || !document || !offer || !(offer.imageUrl || offer.imagePack.length > 1)) return 0;
    const products = offer.imagePack.length > 1
      ? offer.imagePack.map((ref) => ({ name: '', ref }))
      : (await api.splitVariants(brandId, offer.imageUrl!)).products;
    if (products.length < 2) return products.length;
    const children = products.map((product, index) => ({
      ...offer,
      id: `${offer.id}~v${index + 1}`,
      name: product.name || `${offer.name} ${index + 1}`,
      imageUrl: product.ref,
      imagePack: [],
      members: [],
    }));
    live.gesture = null;
    mutate((doc) => ({
      ...doc,
      offers: [
        ...doc.offers
          .filter((entry) => !entry.id.startsWith(`${offerId}~v`))
          .map((entry) => (entry.id === offerId
            ? { ...entry, imagePack: children.map((child) => child.imageUrl!), members: children.map((child) => child.id) }
            : entry)),
        ...children,
      ],
    }));
    return children.length;
  }

  async function standUpOn(
    pages: CatalogPage[],
    onlyOfferId?: string,
    /*
     * Report on the TILE instead of in the toolbar.
     *
     * One cell somebody just filled is not the same errand as a whole
     * book: the products are already in the cell and printable, the
     * arrangement is an improvement arriving a few seconds later, and
     * a banner that disables every other control while it comes is
     * why a job of a few seconds felt like a wait. A batch of six
     * still takes the banner — there, the waiting IS the errand.
     */
    quiet = false,
  ): Promise<void> {
    const { brandId, document, brand } = get();
    if (!brandId || !document || !brand || pages.length === 0) return;

    const notes: string[] = [];
    const tasks: {
      pageId: string; offerId: string; members: Offer[]; aspect?: number;
    }[] = [];

    for (const page of pages) {
      const { clusters, skipped } = pagePhotographs(page, document);
      notes.push(...skipped);
      const template = resolveTemplate(brand, page.templateId)
        ?? document.templates.find((entry) => entry.id === page.templateId);
      const cells = template ? slotCells(template, brand.pageAspect) : undefined;
      for (const { offer, members } of clusters) {
        // One tile, when the caller named one: the same engine drives
        // the whole book and a single cluster somebody just assembled.
        if (onlyOfferId && offer.id !== onlyOfferId) continue;
        const slot = page.placements.find((entry) => entry.offerId === offer.id)?.slotId;
        const aspect = slot ? cells?.get(slot)?.aspect : undefined;
        tasks.push({
          pageId: page.id, offerId: offer.id, members, ...(aspect ? { aspect } : {}),
        });
      }
    }

    if (tasks.length === 0) {
      set({
        standingUp: [],
        error: notes.length > 0 ? notes.join(' · ') : 'ingen af sidens fliser viser flere varer at stille op',
      });
      return;
    }

    const note = get().arrangeNote.trim();
    const way = get().clusterWay;
    const imageModel = get().clusterImageModel.trim();
    const placeModel = get().clusterPlaceModel.trim();
    /*
     * The words this run is sent with.
     *
     * Whatever is in the box, and otherwise the standing prompt that
     * is chosen — never the server's own default, so what a tile was
     * made with is always the thing the studio is showing.
     *
     * The two are kept apart afterwards: `typed` is what a person
     * wrote and is what the run list offers to put back, while
     * `promptId` merely names which of the shipped prompts was used.
     * Folding them together would make every run look like somebody
     * had hand-written a prompt for it.
     */
    const typed = get().clusterPrompt.trim();
    const promptId = get().clusterPromptId;
    const ownPrompt = typed || placePrompt(promptId);
    const started = Date.now();
    set({
      ...(quiet ? {} : { busy: `0/${tasks.length} klynger stillet op…` }),
      standingUp: tasks.map((task) => task.offerId),
      error: null,
      note: null,
      clusterRun: null,
    });

    try {
      const done = await pool(tasks, CLUSTER_AT_ONCE, async (task) => {
        const page = document.pages.find((entry) => entry.id === task.pageId)!;
        const request = {
          offers: task.members,
          ...(task.aspect ? { aspect: task.aspect } : {}),
          ...(note ? { note } : {}),
        };
        const overrides = page.placements
          .find((entry) => entry.offerId === task.offerId)?.overrides ?? { ...FRESH };

        /*
         * The cheap way: numbers, straight out.
         *
         * No picture is drawn and none is thrown away — one vision
         * call looks at the cutouts and says where each should stand,
         * and everything below is the same arithmetic the round trip
         * feeds. The cell's own proportions stand in for the
         * photograph's, because the numbers are fractions of the cell.
         */
        if (way === 'koordinater') {
          const ready = await api.prepareCluster(brandId, request);

          /*
           * The cell as the page actually draws it, and each cutout's
           * own proportions.
           *
           * Both are the browser's to know and nobody else's — the
           * cell is a rectangle in a laid-out page, and the ink inside
           * a packshot is only visible once the file is decoded. The
           * prompt asks for pixels inside a stated canvas, so handing
           * over the real one is the difference between a size that is
           * right and one that is a few per cent out on every product.
           */
          const tile = window.document
            .querySelector(`[data-offer-id="${CSS.escape(task.offerId)}"]`);
          const box = tile?.querySelector('.tile__media, .dtile__pack')?.getBoundingClientRect();
          const aspects = await Promise.all(
            ready.files.map((copy) => cutoutAspect(copy.url)),
          );

          const placed = await api.placeCluster(brandId, {
            ...request,
            ...(box && box.width > 0 && box.height > 0
              ? { canvas: { width: Math.round(box.width), height: Math.round(box.height) } }
              : {}),
            aspects,
            offerName: tileName(task.members),
            ...(placeModel ? { model: placeModel } : {}),
            ...(get().placeStrict ? { strict: true } : {}),
            ...(ownPrompt ? { system: ownPrompt } : {}),
          });
          const stood = await standUpCluster({
            offerId: task.offerId,
            members: task.members,
            overrides,
            copies: ready.files,
            placed: placed.products,
            // The canvas the numbers were measured in — the same box,
            // or the template's ideal when it could not be measured.
            picture: box && box.height > 0 ? box.width / box.height : (task.aspect ?? 1),
          });
          if ('error' in stood) return { stood };
          return {
            stood,
            missing: placed.missing.length,
            ghost: null,
            model: placed.model,
            ...(placed.insteadOf ? { insteadOf: placed.insteadOf } : {}),
            drawnBy: null,
            tokens: (placed.usage?.inputTokens ?? 0) + (placed.usage?.outputTokens ?? 0),
            inputTokens: placed.usage?.inputTokens ?? 0,
            outputTokens: placed.usage?.outputTokens ?? 0,
            view: placed.view ?? null,
          };
        }

        /*
         * One call, not two. The compose route returns the same-origin
         * copies the measurement needs alongside the composition —
         * `copies` — so the cutouts cross the wire once. An older
         * server that does not know the flag still answers, and the
         * copies are fetched the old way rather than the tile being
         * measured against nothing.
         */
        const drawn = await api.composeCluster(brandId, {
          ...request,
          copies: true,
          ...(imageModel ? { model: imageModel } : {}),
        });
        const copies = drawn.files
          ?? (await api.prepareCluster(brandId, request)).files;

        /*
         * A file written a second ago is not yet a file the dev server
         * will serve — see `reachable`. Reading it before it is there
         * is how a composed tile ends up showing a broken image.
         */
        if (!await reachable(drawn.url)) {
          throw new Error(`${drawn.url} kunne ikke hentes igen`);
        }

        // The composition arrives keyed out and trimmed; a reader needs
        // it on white — see `onWhite`.
        const bytes = await onWhite(drawn.url);
        const reading = await api.readClusterLayout(brandId, {
          file: toBase64(bytes), offers: task.members,
        });

        const stood = await standUpCluster({
          offerId: task.offerId,
          members: task.members,
          overrides,
          copies,
          placed: reading.products,
          picture: await pictureAspect(new File([bytes as BlobPart], 'composed.png')),
        });
        if ('error' in stood) return { stood };

        return {
          stood,
          missing: reading.missing.length,
          ghost: await keepGhost(brandId, stood, bytes, 'komposition.png'),
          model: reading.model,
          drawnBy: drawn.model,
          tokens: (reading.usage?.inputTokens ?? 0) + (reading.usage?.outputTokens ?? 0),
          inputTokens: reading.usage?.inputTokens ?? 0,
          outputTokens: reading.usage?.outputTokens ?? 0,
        };
      }, (finished, total) => {
        if (!quiet) set({ busy: `${finished}/${total} klynger stillet op…` });
      });

      /*
       * Read back in the order they went in, never in the order they
       * finished: a page whose tiles rearranged themselves by who
       * answered first would be a different page every run.
       */
      const stoodUp: StoodUp[] = [];
      const ghosts: Ghost[] = [];
      for (const [index, result] of done.entries()) {
        const name = tileName(tasks[index]!.members);
        if (!result.ok) { notes.push(`${name}: ${message(result.error)}`); continue; }
        const { stood } = result.value;
        if ('error' in stood) { notes.push(stood.error); continue; }
        if (stood.patches.size === 0) {
          notes.push(`${name}: ingen af varerne kunne genfindes i kompositionen`);
          continue;
        }
        stoodUp.push(stood);
        if (result.value.ghost) ghosts.push(result.value.ghost);
        notes.push(`${name}: ${count(stood.patches.size, 'vare', 'varer')} stillet op${
          result.value.missing ? `, ${result.value.missing} ikke genfundet` : ''}${
          stood.complaints.length > 0
            ? `, ${count(stood.complaints.length, 'advarsel', 'advarsler')}` : ''}`);
      }

      if (stoodUp.length === 0) {
        // The spinner on each tile goes too — a failed run that leaves
        // "stiller op…" behind looks like one still going.
        set({ busy: null, standingUp: [], error: notes.join(' · ') || 'ingen af klyngerne kunne stilles op' });
        return;
      }

      /*
       * What the run did, for the panel.
       *
       * Measured, never estimated: the models that answered, the
       * tokens they reported, the wall clock, and how many products
       * actually moved. The back-to-front order is the tile's own pack
       * order after the arrangement — which is the one thing a person
       * looking at a cluster wants to check without clicking into it.
       */
      const first = done.find((entry) => entry.ok && !('error' in entry.value.stood));
      const answered = first?.ok ? first.value : null;
      const run: ClusterRun = {
        way,
        model: answered && 'model' in answered ? answered.model ?? '' : '',
        insteadOf: answered && 'insteadOf' in answered ? answered.insteadOf ?? null : null,
        drawnBy: answered && 'drawnBy' in answered ? answered.drawnBy ?? null : null,
        elapsedMs: Date.now() - started,
        tokens: done.reduce((total, entry) => (
          entry.ok && 'tokens' in entry.value ? total + (entry.value.tokens ?? 0) : total
        ), 0) || null,
        // Summed over every cluster in the run, because the price is
        // what the run cost and not what its first tile cost.
        inputTokens: done.reduce((total, entry) => (
          entry.ok && 'inputTokens' in entry.value ? total + (entry.value.inputTokens ?? 0) : total
        ), 0),
        outputTokens: done.reduce((total, entry) => (
          entry.ok && 'outputTokens' in entry.value
            ? total + (entry.value.outputTokens ?? 0) : total
        ), 0),
        placed: stoodUp.reduce((total, stood) => total + stood.patches.size, 0),
        of: tasks.reduce((total, task) => total + task.members.length, 0),
        order: stoodUp.length === 1
          ? backToFront(stoodUp[0]!, tasks[0]!.members)
          : [],
        complaints: stoodUp.flatMap((stood) => stood.complaints.map((entry) => entry.said)),
        view: answered && 'view' in answered ? answered.view ?? null : null,
      };

      /*
       * Kept, so the next run can be compared with this one.
       *
       * Only the coordinate way: the round trip's quality is the
       * image model's, and its prompt is not the one anybody is
       * editing here.
       */
      const runs = way === 'koordinater'
        ? [
          {
            at: new Date().toISOString(),
            tile: tileName(tasks[0]?.members ?? []),
            prompt: typed,
            promptId,
            model: run.model,
            elapsedMs: run.elapsedMs,
            placed: run.placed,
            of: run.of,
          },
          ...get().promptRuns,
        ].slice(0, PROMPT_RUNS)
        : get().promptRuns;
      if (runs !== get().promptRuns) {
        try {
          window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
        } catch { /* out of room; the list is a convenience */ }
      }

      live.gesture = null;
      mutate((doc) => withPatches(doc, stoodUp));
      set({
        busy: null,
        standingUp: [],
        clusterRun: run,
        promptRuns: runs,
        ghosts: ghosts.reduce(withGhost, get().ghosts),
        // How long it took, in front of the person who asked for it —
        // this is the number the parallelism exists for.
        note: [`${count(stoodUp.length, 'klynge', 'klynger')} på ${
          Math.round((Date.now() - started) / 1000)}s`, ...notes].join(' · '),
      });
    } catch (error) {
      set({ busy: null, standingUp: [], error: message(error) });
    }
  }

  /**
   * Hold a request until somebody says which week.
   *
   * Asked at the last possible moment and only once: the studio does
   * not open with a modal, it asks the first time a request would
   * produce pages that have to be called something. The request itself
   * is kept, so answering the question also runs the thing that was
   * asked for — the alternative is a dialog that closes and leaves the
   * person to press the button again.
   */
  function askingWeek(then: () => void): boolean {
    if (get().week) return false;
    set({ askWeek: { then }, busy: null });
    return true;
  }

  /**
   * What the last applied feed changed, as lines in the checklist.
   *
   * A changed price is worth a look, not a stop: the tile already
   * prints the new number. A product pulled from the feed IS a stop —
   * printing it is advertising something the shop will not have.
   */
  /**
   * The products the chain says must be in the avis and no page shows.
   * Here and not in `readFindings`: the product may only be in the
   * week's feed, not yet in the avis at all.
   */
  /**
   * Products dealt in under one of the page's own texts, taken back off.
   *
   * Measured once the pages are drawn — a text's height is only known
   * then — and run after anything that fills cells in bulk: a section,
   * several, a new week. What came off goes back to the reserve and is
   * said, so nobody wonders where it went. One undo step of its own.
   */
  function clearUnderText(pageIds: string[] | null): void {
    window.setTimeout(() => {
      const document = get().document;
      if (!document) return;
      const wanted = new Set(pageIds ?? document.pages.map((page) => page.id));
      const covered = new Map<string, Set<string>>();
      for (const element of window.document.querySelectorAll<HTMLElement>('.page[data-page-id]')) {
        const pageId = element.dataset['pageId']!;
        if (!wanted.has(pageId)) continue;
        for (const { offerId } of coveredByText(element)) {
          if (!covered.has(pageId)) covered.set(pageId, new Set());
          covered.get(pageId)!.add(offerId);
        }
      }
      const count = [...covered.values()].reduce((n, ids) => n + ids.size, 0);
      if (count === 0) return;
      const names = [...covered.values()].flatMap((ids) => [...ids])
        .map((id) => document.offers.find((offer) => offer.id === id)?.name.split(/[,(]/)[0]!.trim() ?? id);
      live.gesture = null;
      mutate((doc) => ({
        ...doc,
        pages: doc.pages.map((page) => (covered.has(page.id)
          ? { ...page, placements: page.placements.filter((placement) => !covered.get(page.id)!.has(placement.offerId)) }
          : page)),
      }));
      set({
        note: `${[get().note, `${names.length === 1 ? 'Én vare' : `${names.length} varer`} lagt tilbage i reserven — en tekst på siden dækkede pladsen: ${names.join(', ')}`].filter(Boolean).join(' · ')}`,
      });
      get().refreshFindings();
    }, 400);
  }

  function mustFindings(): Finding[] {
    const { document, feedOffers } = get();
    const must = document?.mustInclude ?? [];
    if (!document || must.length === 0) return [];
    const byId = new Map([...feedOffers, ...document.offers].map((offer) => [offer.id, offer]));
    const shown = new Set<string>();
    for (const placement of document.pages.flatMap((page) => page.placements)) {
      shown.add(placement.offerId);
      for (const member of byId.get(placement.offerId)?.members ?? []) shown.add(member);
    }
    return must
      .filter((id) => !shown.has(id) && byId.has(id))
      .map((id) => ({
        id: `skalmed:${id}`,
        kind: 'skalmed' as const,
        said: `${byId.get(id)!.name} skal med, men er ikke på en side`,
        pageId: null,
        pageNumber: null,
        offerId: id,
        weight: 'stop' as const,
      }));
  }

  function changeFindings(): Finding[] {
    const { feedChanges, document } = get();
    if (!feedChanges || !document) return [];
    const numberOf = new Map(document.pages.map((page, index) => [page.id, index + 1]));
    const found: Finding[] = [];
    for (const change of feedChanges.changed) {
      if (!change.pageId || !numberOf.has(change.pageId)) continue;
      const price = change.fields.find((entry) => entry.field === 'price');
      found.push({
        id: `feed:${change.offerId}:ændret`,
        kind: 'pris',
        said: `Side ${numberOf.get(change.pageId)}: ${change.next.name} — `
          + (price
            ? `ny pris ${kroner(price.before)} → ${kroner(price.after)}`
            : `${change.fields.map((entry) => DIFF_NAMES[entry.field] ?? entry.field).join(', ')} ændret`),
        pageId: change.pageId,
        pageNumber: numberOf.get(change.pageId) ?? null,
        offerId: change.offerId,
        weight: 'se',
      });
    }
    for (const gone of feedChanges.removed) {
      const still = document.pages.find((page) => page.id === gone.pageId)
        ?.placements.some((placement) => placement.offerId === gone.offer.id);
      if (!still) continue;
      found.push({
        id: `feed:${gone.offer.id}:udgået`,
        kind: 'pris',
        said: `Side ${numberOf.get(gone.pageId)}: ${gone.offer.name} er udgået af feedet`,
        pageId: gone.pageId,
        pageNumber: numberOf.get(gone.pageId) ?? null,
        offerId: gone.offer.id,
        weight: 'stop',
      });
    }
    return found;
  }

  /** The latest `openCatalogue` asked for — see there. */

  /** Where week 39's avis is stored. One avis per week, per chain. */
  function weekId(brandId: string, week: CatalogWeek): string {
    return `${brandId}-${week.year}-u${String(week.week).padStart(2, '0')}`;
  }

  /**
   * Stamp a document that is being created right now.
   *
   * Id, name and week together, because they are one fact: this is
   * week 39's paper for this chain. The id being derived is what makes
   * a second run of week 39 a new VERSION of it — every save appends
   * to the version table — rather than a sixteenth row in the picker
   * with the same name as the other fifteen.
   */
  function forWeek(document: CatalogDocument): CatalogDocument {
    const week = get().week;
    if (!week) return document;
    return {
      ...document,
      id: weekId(document.brandId, week),
      name: weekName(get().brand?.name ?? document.brandId, week),
      week,
    };
  }

  /** The week alone, for a document that keeps the id and name it has. */
  function withWeek(document: CatalogDocument): CatalogDocument {
    const week = get().week;
    return week ? { ...document, week } : document;
  }

  return {
    set, get,
    repeating,
    warmImages,
    loadFeed,
    reserveFor,
    overridesOf,
    pageById,
    clamp,
    mutate,
    templatesFollow,
    settleGroup,
    splitOffer,
    standUpOn,
    askingWeek,
    clearUnderText,
    mustFindings,
    changeFindings,
    weekId,
    forWeek,
    withWeek,
    live,
  };
}

export type StoreContext = ReturnType<typeof makeContext>;
