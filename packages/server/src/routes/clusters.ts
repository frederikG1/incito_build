import { Hono } from 'hono';
import { z } from 'zod';
import { Offer, packSizeOf } from '@incitio/schema';
import { arrangeGroup, placeCluster, readClusterLayout } from '@incitio/curator';
import { mediaType } from '@incitio/match';
import { uploadStore } from '../uploads.js';
import { clusterPrompt, composeCluster, backdropPrompt, motifPrompt, keyOutMotifs, composedCount, cropBoxes, cutout, findIslands, findVariants, generateImage, ASPECTS, sharedBrowser, DEFAULT_IMAGE_MODEL, GeminiError } from '@incitio/decor';
import { imageKey, type Scope, copyCutouts, cutOptions } from '../http.js';
import type { RouteContext } from '../index.js';

/** Flere varer i én flise: opstilling, udklip og baggrunde. */
export function clustersRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { options, imagesFor, uploadsFor, ArrangeRequest } = ctx;
  /**
   * How several products should share one cell.
   *
   * Called when the editor drops a handful of products into a cell that
   * already exists. The model sees the PHOTOGRAPHS and answers with an
   * ordering, one of four arrangement names, and the two lines of
   * Danish the tile prints — never a coordinate, a size or a colour.
   *
   * Never fails. `arrangeGroup` answers with the stylesheet's own
   * choice when there is no key, when the model refuses, or when the
   * network is down, and says so by returning `model: null`. An editor
   * whose drop would not land because an API was unreachable is a worse
   * product than one with no API at all.
   */
  app.post('/api/brand/arrange', async (c) => {
    const definition = c.get('brand');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = ArrangeRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const result = await arrangeGroup({
      offers: parsed.data.offers,
      cell: parsed.data.cell,
      brandName: definition.brand.name,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return c.json(result);
  });

  const ClusterRequest = z.object({
    /** The products that are to become one photograph. Two to eight. */
    offers: z.array(Offer).min(2).max(8),
    /** Width over height of the cell it will sit in. */
    aspect: z.number().positive().max(20).optional(),
    /** The editor's own words, added on top of the craft. */
    note: z.string().max(500).optional(),
    /**
     * Also return the cutouts re-served from here, as `/prepare` does.
     *
     * The studio needs both — the composition to read, and same-origin
     * copies to measure the products against, because a canvas may not
     * read another origin's pixels. Asking for them here rather than
     * calling `/prepare` first saves a whole round of downloads from
     * the chain's image host per cluster, which is most of the wait
     * that is not the model's own.
     */
    copies: z.boolean().optional(),
    /**
     * Which image model draws it.
     *
     * A field rather than only an env var, because the choice is the
     * editor's and it is a price: the flash models cost a few cents a
     * picture and the pro ones several times that. `GEMINI_IMAGE_MODEL`
     * stays the default for anyone who does not pass one.
     */
    model: z.string().max(80).optional(),
  });

  /**
   * Several products as ONE leaflet photograph.
   *
   * The other way to fill a cell — see `PlacementOverrides.pack` for the
   * way that keeps every product movable. This one hands the cutouts to
   * the image model and asks for a photograph of them standing
   * together: a shared floor, one hero in front, the rest overlapping,
   * which is what a printed page has and what no stylesheet produces.
   *
   * It throws where `/arrange` falls back, and on purpose: the editor
   * already has a working tile and pressed this button to get a
   * different one, so a silent fallback would leave them wondering
   * whether anything happened.
   */
  app.post('/api/brand/cluster', async (c) => {
    if (!options.assetDir) {
      return c.json({ error: 'serveren har ingen assetDir at gemme billeder i' }, 503);
    }
    const apiKey = imageKey(c);
    if (!apiKey) {
      return c.json({
        error: 'ingen nøgle til billedmodellen',
        detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env'
          + ' og genstart API-serveren. Billedgenerering kræver desuden fakturering'
          + ' på Google-projektet.',
      }, 503);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = ClusterRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const offers = parsed.data.offers;
    const fetched = await imagesFor(offers.map((offer) => offer.imageUrl));
    const missing = offers.filter((_, index) => fetched[index] === null);
    if (missing.length > 0) {
      /*
       * Named, not counted. The prompt calls image N by product N's
       * name, so a list with a hole in it would put every label on the
       * wrong product — and the editor can only fix it if they are told
       * which photograph is the problem.
       */
      return c.json({
        error: 'billedet kunne ikke hentes for '
          + missing.map((offer) => offer.name).join(', '),
      }, 422);
    }

    try {
      const drawn = await composeCluster({
        products: offers.map((offer) => ({
          name: offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
          /*
           * The real size, wherever it is written.
           *
           * It used to fall back to `offer.pack`, which says "1 stk."
           * for a lemon and for a 15-pack of beer alike — so the prompt
           * demanded natural relative sizes and then handed over
           * nothing to judge them by. `packSizeOf` reads the chain's
           * own sentence when the structured field is empty, which in
           * this feed is always. See the note there.
           */
          ...(() => {
            const size = packSizeOf(offer);
            return size ? { size } : {};
          })(),
        })),
        references: fetched.filter((image): image is NonNullable<typeof image> => image !== null),
        ...(parsed.data.aspect ? { aspect: parsed.data.aspect } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        // The editor's own key when the browser sent one, the
        // server's otherwise — see `imageKey`.
        gemini: { apiKey, ...(parsed.data.model ? { model: parsed.data.model } : {}) },
      });

      /*
       * Cut before it is stored.
       *
       * The prompt demands a white field reaching all four edges, and a
       * white rectangle pasted onto SuperBrugsen's yellow reads as a
       * rendering bug. `kept` says how much survived: near 1 means the
       * fill found nothing, which is what a model that drew a room
       * instead of a field produces — reported rather than discovered
       * on a printed page.
       */
      const cut = await cutout(drawn.bytes, drawn.mimeType, await cutOptions());
      const files = uploadStore(options.assetDir, c.get('brand').brand.id);
      const stored = files.put(cut.bytes, 'png');

      return c.json({
        url: stored.ref,
        bytes: cut.bytes.length,
        prompt: drawn.prompt,
        model: drawn.model || DEFAULT_IMAGE_MODEL,
        cut: { kept: cut.kept, threshold: cut.threshold },
        // The same cutouts `/prepare` hands back, when the caller says
        // it needs them — the bytes are already here and downloading
        // them a second time is the slowest thing this route does.
        ...(parsed.data.copies
          ? {
            files: copyCutouts(
              offers,
              fetched as { bytes: Buffer; mimeType: string }[],
              files,
            ),
          }
          : {}),
      });
    } catch (error) {
      if (error instanceof GeminiError) return c.json({ error: error.message }, 422);
      return c.json({
        error: error instanceof Error ? error.message : 'billedet kunne ikke laves',
      }, 500);
    }
  });

  const PrepareRequest = z.object({
    offers: z.array(Offer).min(2).max(8),
    aspect: z.number().positive().max(20).optional(),
    note: z.string().max(500).optional(),
  });

  /**
   * The cutouts, re-served from here, and the prompt that goes with
   * them.
   *
   * It was the way to run the composition by hand in Gemini's own
   * app, back when the image model was behind a billing account
   * nobody had. The studio does the whole job itself now, and what
   * this is still for is the half that has nothing to do with models:
   * a canvas may not read another origin's pixels, so the arrangement
   * cannot measure how much of a packshot is product until there is a
   * same-origin copy of it. That is what these are.
   *
   * The prompt comes along because it costs nothing to build and is
   * worth reading when a tile comes out wrong.
   */
  app.post('/api/brand/cluster/prepare', async (c) => {
    if (!options.assetDir) {
      return c.json({ error: 'serveren har ingen assetDir at gemme billeder i' }, 503);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = PrepareRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const offers = parsed.data.offers;
    const fetched = await imagesFor(offers.map((offer) => offer.imageUrl));
    const missing = offers.filter((_, index) => fetched[index] === null);
    if (missing.length > 0) {
      return c.json({
        error: 'billedet kunne ikke hentes for '
          + missing.map((offer) => offer.name).join(', '),
      }, 422);
    }

    const files = copyCutouts(
      offers,
      fetched as { bytes: Buffer; mimeType: string }[],
      uploadStore(options.assetDir, c.get('brand').brand.id),
    );

    return c.json({
      prompt: clusterPrompt(
        // The same sizes the automatic route sends — see the note there.
        offers.map((offer) => ({
          name: offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
          ...(() => {
            const size = packSizeOf(offer);
            return size ? { size } : {};
          })(),
        })),
        {
          ...(parsed.data.aspect ? { aspect: parsed.data.aspect } : {}),
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
      ),
      files,
    });
  });

  const PlaceRequest = z.object({
    offers: z.array(Offer).min(2).max(8),
    /** Width over height of the cell they have to stand in. */
    aspect: z.number().positive().max(20).optional(),
    /**
     * The cell in pixels, as the page actually draws it.
     *
     * Measured in the browser and sent, because only the browser knows
     * it — and the answer is in pixels, so a made-up canvas would put
     * every size a few per cent out. `aspect` is the fallback when it
     * is missing.
     */
    canvas: z.object({
      width: z.number().positive().max(10_000),
      height: z.number().positive().max(10_000),
    }).optional(),
    /**
     * Each cutout's own proportions, width over height, in the offers'
     * order.
     *
     * Also measured in the browser: the ink inside a cutout is not the
     * cutout's frame, and the studio has already scanned it to place
     * the product — see `inkOf`. Reading it again here would mean
     * decoding every packshot on the server for a number it already
     * has.
     */
    aspects: z.array(z.number().positive().max(20)).max(8).optional(),
    /** What the offer is called, so the hero can be the product it names. */
    offerName: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
    /** Which vision model does the placing. */
    model: z.string().max(80).optional(),
    /**
     * Refuse to answer with anything but `model` — see
     * `PlaceOptions.strict`. Off by default, because a batch nobody is
     * watching is better served by an answer from the next model than
     * by no answer at all.
     */
    strict: z.boolean().optional(),
    /**
     * The editor's own version of the standing prompt.
     *
     * The studio shows the prompt and lets it be rewritten for the
     * session — see `PLACE_SYSTEM`, which is the default and stays
     * the default. This is the fastest loop anybody has found for
     * improving a tile: change a line, press the button, look.
     */
    system: z.string().max(8000).optional(),
  });

  /**
   * The arrangement as numbers, with no picture drawn.
   *
   * The cheap half of the round trip and the way round its billing
   * gate: `/cluster` pays an image model to photograph the products
   * together and `/cluster/layout` pays a second model to measure the
   * result, while this asks one vision model to look at the cutouts
   * and say where each should stand. Same answer shape as
   * `/cluster/layout`, so the studio can swap one for the other
   * without changing anything downstream.
   *
   * No Gemini key is involved at all — this is the reading model's
   * work, and that key has never been the one behind a paywall.
   */
  app.post('/api/brand/cluster/place', async (c) => {
    /*
     * Gemini's key, not Anthropic's — see `DEFAULT_PLACE_MODEL`.
     *
     * The placing model is a text-and-vision one, and those DO have a
     * free tier on that API; it is only the image models that do not.
     * So the cheap way needs the key the editor already pasted into
     * the studio, and nothing else. A Claude model id is still
     * accepted for a comparison, and then it is Anthropic's key that
     * has to be there.
     */
    const geminiKey = imageKey(c);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = PlaceRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const wantsClaude = /^claude/i.test(parsed.data.model ?? '');
    if (wantsClaude && !process.env['ANTHROPIC_API_KEY']) {
      return c.json({
        error: 'ingen API-nøgle',
        detail: 'Sæt ANTHROPIC_API_KEY i .env og genstart API-serveren.',
      }, 503);
    }
    if (!wantsClaude && !geminiKey) {
      return c.json({
        error: 'ingen nøgle til opstillingsmodellen',
        detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env.'
          + ' Opstilling efter koordinater bruger en tekstmodel, som er med i'
          + ' gratis-niveauet — til forskel fra billedmodellerne.',
      }, 503);
    }

    const offers = parsed.data.offers;
    const fetched = await imagesFor(offers.map((offer) => offer.imageUrl));
    const missing = offers.filter((_, index) => fetched[index] === null);
    if (missing.length > 0) {
      return c.json({
        error: 'billedet kunne ikke hentes for '
          + missing.map((offer) => offer.name).join(', '),
      }, 422);
    }

    const started = Date.now();
    try {
      /*
       * The canvas the answer is measured in.
       *
       * The browser's own numbers when it sent them; otherwise a box
       * of the right proportions at a plausible print size, because
       * the prompt asks for pixels and "1:1" is not a canvas.
       */
      const ratio = parsed.data.aspect ?? 1;
      const canvas = parsed.data.canvas ?? { width: Math.round(500 * ratio), height: 500 };

      const placed = await placeCluster({
        products: offers.map((offer, index) => {
          const size = packSizeOf(offer);
          const shape = parsed.data.aspects?.[index];
          return {
            name: offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
            ...(size ? { size } : {}),
            ...(shape ? { aspect: shape } : {}),
          };
        }),
        references: fetched.map((image) => ({
          base64: image!.bytes.toString('base64'),
          mimeType: image!.mimeType,
        })),
        canvas,
        ...(parsed.data.offerName ? { offerName: parsed.data.offerName } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(parsed.data.model ? { model: parsed.data.model } : {}),
        ...(parsed.data.strict ? { strict: true } : {}),
        ...(parsed.data.system?.trim() ? { system: parsed.data.system.trim() } : {}),
        // Anthropic reads its own key from the environment; Gemini's
        // may have come from the browser — see `imageKey`.
        ...(!wantsClaude && geminiKey ? { apiKey: geminiKey } : {}),
      });
      return c.json({ ...placed, elapsedMs: Date.now() - started });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'opstillingen kunne ikke laves',
      }, 500);
    }
  });

  const ClusterLayoutRequest = z.object({
    /** The composed picture, base64. */
    file: z.string().min(1).max(24_000_000),
    /**
     * The products the picture MIGHT hold, numbered.
     *
     * Not a cluster, which is why the cap is not `MAX_CLUSTER`. A
     * composition is at most eight products, but this route is asked
     * "which of these does the picture contain, and where" — and the
     * studio asks it with every product on the sheet, or in the whole
     * book, precisely so nobody has to pair a file with a tile by
     * hand. Capped at eight it rejected any page with more than eight
     * grouped products as an invalid request, which is how it was
     * found. The reader itself has no such limit; the number is here
     * only so a runaway body is refused.
     */
    offers: z.array(Offer).min(2).max(240),
  });

  /**
   * Measure a composed picture so the same composition can be rebuilt
   * from the ORIGINAL cutouts.
   *
   * The reason this route exists rather than the picture simply being
   * printed: an image model redraws pixels, and what it redraws worst
   * is small type. The composition it produces is good and its labels
   * are not the chain's. So the picture is read for its geometry and
   * then thrown away, and what prints is the artwork the chain
   * supplied, standing where the composition put it.
   */
  app.post('/api/brand/cluster/layout', async (c) => {
    if (!process.env['ANTHROPIC_API_KEY']) {
      return c.json({
        error: 'ingen API-nøgle',
        detail: 'Sæt ANTHROPIC_API_KEY i .env og genstart API-serveren.',
      }, 503);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = ClusterLayoutRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const image = Buffer.from(parsed.data.file, 'base64');
    if (image.length === 0) return c.json({ error: 'billedet kunne ikke afkodes' }, 400);

    let type: string;
    try {
      type = mediaType(image);
    } catch {
      return c.json({ error: 'filen er ikke et billede (PNG, JPEG, WebP eller GIF)' }, 415);
    }

    try {
      const reading = await readClusterLayout({
        image,
        mimeType: type,
        products: parsed.data.offers.map((offer) => ({
          name: offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
        })),
      });
      return c.json(reading);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'opstillingen kunne ikke læses',
      }, 500);
    }
  });


  /**
   * Rebuild a published leaflet from its own link.
   *
   * The cheap half of this whole repo: a published page states its own
   * grid, so there is no model call, no cost and no variation between
   * two runs of the same link. The request is made from the SERVER
   * rather than the browser because a publication is served from
   * another origin — and because a URL that reaches the server's own
   * network is checked before it is fetched, in `@incitio/publication`.
   */
  /*
   * One packshot of several variants, as one cutout per variant — see
   * `findVariants`. The crops are kept as the chain's own uploads, so
   * the tile they make survives a reload like any other picture.
   */
  app.post('/api/brand/split', async (c) => {
    const brandId = c.get('brand').brand.id;
    const uploads = uploadsFor(brandId);
    if (!uploads) return c.json({ error: 'serveren har ingen assetDir at gemme billeder i' }, 503);
    const apiKey = imageKey(c);
    if (!apiKey) {
      return c.json({
        error: 'ingen Gemini-nøgle',
        detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env.',
      }, 503);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }
    const parsed = z.object({ imageUrl: z.string().min(1).max(4000) }).safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400);

    try {
      const [image] = await imagesFor([parsed.data.imageUrl]);
      if (!image) return c.json({ error: 'billedet kunne ikke hentes' }, 502);
      // A Tjek packshot says how many photographs it is made of.
      const expected = composedCount(parsed.data.imageUrl);
      const options = await cutOptions();
      /*
       * The picture's own pixels first: packages standing apart on a
       * clear background are islands of ink, found instantly and
       * exactly. The model is asked only when they touch or overlap.
       */
      let boxes = await findIslands(image, options.browser ? { browser: options.browser } : {})
        .catch(() => []);
      if (boxes.length < 2 || (expected !== null && boxes.length !== expected)) {
        const seen = await findVariants(image, { apiKey, expected }).then((r) => r.boxes).catch(() => []);
        if (seen.length >= boxes.length) boxes = seen;
      }
      if (boxes.length < 2) {
        return c.json({
          error: expected
            ? `Billedet består af ${expected} varer, men Gemini kunne ikke skelne dem — prøv igen om lidt`
            : 'Der er kun én vare i billedet — der er ikke flere at stille op',
        }, 422);
      }
      const crops = await cropBoxes(image, boxes, options.browser ? { browser: options.browser } : {});
      const products = [];
      for (const [index, bytes] of crops.entries()) {
        /*
         * Cut out when the crop sits on a light field; kept as cropped
         * when the fill finds nothing (a packshot that is already
         * transparent, or photographed on a table).
         */
        let finished = bytes;
        try {
          const cut = await cutout(bytes, 'image/png', options);
          if (cut.kept < 0.97) finished = cut.bytes;
        } catch { /* the crop stands */ }
        const { ref } = uploads.put(finished, 'png');
        products.push({ name: boxes[index]!.name || `Variant ${index + 1}`, ref });
      }
      return c.json({ products });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'opdelingen fejlede' }, 500);
    }
  });

  /*
   * The background picture for one page — see `backdropPrompt`.
   * The studio measures the page; the brief is written here, so the
   * words the model gets are one function's, not two copies of it.
   */
  const BackdropRequest = z.object({
    aspect: z.enum(ASPECTS),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i),
    regions: z.array(z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() })).max(24),
    text: z.array(z.string().max(20)).max(40),
    offer: z.string().max(200),
    products: z.array(z.string().max(120)).max(20),
    style: z.string().max(600).optional(),
    /** The free places on the page, in percent — see `measurePage`. */
    spots: z.array(z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() })).max(3).optional(),
    /** The sheet's width over its height. */
    ratio: z.number().min(0.2).max(5).optional(),
    /** One motif alone, for a place the studio chose — see `motifPrompt`. */
    isolated: z.boolean().optional(),
  });

  app.post('/api/brand/backdrop', async (c) => {
    const brandId = c.get('brand').brand.id;
    const uploads = uploadsFor(brandId);
    if (!uploads) return c.json({ error: 'serveren har ingen assetDir at gemme billeder i' }, 503);
    const apiKey = imageKey(c);
    if (!apiKey) {
      return c.json({
        error: 'ingen nøgle til billedmodellen',
        detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env.',
      }, 503);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }
    const parsed = BackdropRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    if (parsed.data.spots) {
      /*
       * Motifs for a page, from the editor's own brief: the page painted
       * in its own flat colour with the motif placed around the products
       * and the words. The flat colour is then taken out and each group
       * of objects returned as its own picture at the place the model
       * gave it — laid by the studio as decorations on the page's real
       * background, each movable by hand.
       */
      try {
        const browser = await sharedBrowser();
        const prompt = parsed.data.isolated
          ? motifPrompt(parsed.data)
          : backdropPrompt(parsed.data as Parameters<typeof backdropPrompt>[0]);
        const image = await generateImage(prompt, { apiKey, aspectRatio: parsed.data.aspect })
          .catch((error: unknown) => {
            if (error instanceof Error && /400|imageConfig|aspect/i.test(error.message)
              && !/kvoten|quota/i.test(error.message)) {
              return generateImage(prompt, { apiKey });
            }
            throw error;
          });
        const keyed = await keyOutMotifs(image, { browser, max: parsed.data.isolated ? 1 : 2 });
        if (keyed.length === 0) throw new Error('billedet havde intet motiv at tage ud — prøv igen');
        const motifs = keyed.map((motif) => {
          const { ref } = uploads.put(motif.png, 'png');
          return { url: ref, spot: motif.box, width: motif.width, height: motif.height };
        });
        return c.json({ motifs, prompt });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'billedet kunne ikke tegnes' }, 502);
      }
    }
    const prompt = backdropPrompt(parsed.data as Parameters<typeof backdropPrompt>[0]);
    try {
      /*
       * The shape as a setting when the model takes it; a model that
       * refuses the setting (a 400 naming it) is asked again without —
       * the brief states the ratio in words as well.
       */
      const image = await generateImage(prompt, { apiKey, aspectRatio: parsed.data.aspect })
        .catch((error: unknown) => {
          if (error instanceof Error && /400|imageConfig|aspect/i.test(error.message)
            && !/kvoten|quota/i.test(error.message)) {
            return generateImage(prompt, { apiKey });
          }
          throw error;
        });
      const extension = mediaType(image.bytes).split('/')[1]!;
      const { ref } = uploads.put(image.bytes, extension);
      return c.json({ url: ref, prompt });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'billedet kunne ikke tegnes' }, 502);
    }
  });

}
