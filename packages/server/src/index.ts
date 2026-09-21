import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CatalogDocument, Offer, packSizeOf } from '@incitio/schema';
import {
  findBrand, findSource, listBrands, resolveSource, type BrandDefinition,
} from '@incitio/brands';
import { buildCatalogue } from '@incitio/pipeline';
import { arrangeGroup, readClusterLayout } from '@incitio/curator';
import {
  EMPTY_LABEL_DICTIONARY, ingestCsv, ingestJson, type LabelDictionary,
} from '@incitio/ingest';
import { imaginePage, matchPage, MatchError, mediaType } from '@incitio/match';
import { uploadStore } from './uploads.js';
import { renderCataloguePdf } from '@incitio/pdf';
import {
  clusterPrompt, composeCluster, cutout, decorate, fetchImages,
  DEFAULT_IMAGE_MODEL, GeminiError,
} from '@incitio/decor';
import { importPublication, PublicationError } from '@incitio/publication';
import { Store } from './db.js';

export { Store } from './db.js';

/**
 * How a request says which chain it is acting as.
 *
 * A header rather than a path segment or a body field, because it must
 * be impossible to forget: the middleware below resolves it once, and
 * every route reads the resolved brand instead of a string from the
 * caller. When real authentication arrives it replaces this one function
 * and nothing else — the routes never learn where the brand came from.
 */
export const BRAND_HEADER = 'x-incitio-brand';

interface Scope {
  Variables: { brand: BrandDefinition };
}

export interface AppOptions {
  /** Directory root-relative feed images resolve against, for PDF export. */
  assetDir?: string;
  /**
   * The certification marks, for turning a feed's label names into
   * artwork.
   *
   * Passed in rather than read here, for the same reason `assetDir` is:
   * this is a library and does not own a filesystem. `main.ts` loads the
   * shipped export and hands it over.
   *
   * Omitting it is not a neutral default, which is why it is worth
   * saying out loud. Every reader falls back to an empty dictionary, and
   * an empty dictionary resolves "Økologi" to the plain WORD "Økologi" —
   * so the Ø-mark the chain contractually expects on the page silently
   * becomes a text chip. That is exactly what the studio did until this
   * existed: the CLI passed a dictionary and the API did not, so the
   * same feed printed marks from the terminal and words from the editor.
   */
  labels?: LabelDictionary;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const app = new Hono<Scope>();
  const labels = options.labels ?? EMPTY_LABEL_DICTIONARY;
  const uploads = options.assetDir ? uploadStore(options.assetDir) : null;

  app.use('/api/*', cors({ origin: '*', allowHeaders: ['content-type', BRAND_HEADER] }));

  app.get('/api/health', (c) => c.json({ ok: true }));

  /** The chains this deployment serves. The only unscoped route. */
  app.get('/api/brands', (c) => c.json({ brands: listBrands() }));

  /*
   * Everything below is scoped to one chain.
   *
   * Resolved here, once, and stashed on the context. A route that wants
   * the brand takes it from the context; a route cannot accidentally
   * trust a brand id out of the body, because it never sees one.
   */
  app.use('/api/brand/*', async (c, next) => {
    const id = c.req.header(BRAND_HEADER) ?? '';
    const definition = findBrand(id);
    if (!definition) {
      return c.json(
        { error: 'ukendt kæde', detail: `Sæt ${BRAND_HEADER} til en af: ${listBrands().map((b) => b.id).join(', ')}` },
        403,
      );
    }
    c.set('brand', definition);
    await next();
  });

  /** This chain's identity, its layouts, and the formats it delivers. */
  app.get('/api/brand/profile', (c) => {
    const { brand, sources } = c.get('brand');
    return c.json({
      brand,
      // The mappings are functions and stay server-side; the editor
      // only needs to know which readers exist and where the samples
      // live.
      sources: sources.map((s) => ({
        id: s.id, name: s.name, format: s.format, path: s.path ?? null,
        sample: s.sample ?? false,
      })),
    });
  });

  app.get('/api/brand/catalogs', (c) =>
    c.json({ catalogs: store.list(c.get('brand').brand.id) }));

  app.get('/api/brand/catalogs/:id', (c) => {
    const document = store.get(c.get('brand').brand.id, c.req.param('id'));
    // 404, not 403: whether a catalogue exists under another chain is
    // itself information this session has no business having.
    if (!document) return c.json({ error: 'not found' }, 404);
    return c.json({ document });
  });

  app.get('/api/brand/catalogs/:id/versions', (c) =>
    c.json({ versions: store.versions(c.get('brand').brand.id, c.req.param('id')) }));

  app.put('/api/brand/catalogs/:id', async (c) => {
    const brandId = c.get('brand').brand.id;
    const id = c.req.param('id');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = CatalogDocument.safeParse(payload);
    if (!parsed.success) {
      // Reject at the boundary. A malformed document written here would
      // fail much later, in the renderer, where the cause is invisible.
      return c.json({ error: 'invalid document', issues: parsed.error.issues.slice(0, 10) }, 400);
    }
    if (parsed.data.id !== id) {
      return c.json({ error: `document id ${parsed.data.id} does not match path ${id}` }, 400);
    }

    try {
      return c.json({ document: store.save(brandId, parsed.data, c.req.query('label') ?? '') });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'save failed' }, 403);
    }
  });

  app.delete('/api/brand/catalogs/:id', (c) =>
    store.remove(c.get('brand').brand.id, c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not found' }, 404));

  /**
   * Build a catalogue from a feed.
   *
   * The whole pipeline runs server-side, so the Anthropic key stays in
   * the server's environment and never reaches the browser. The client
   * sends a feed and gets back a finished document.
   */
  const BuildRequest = z.object({
    feed: z.string().min(1).max(20_000_000),
    maxPages: z.number().int().positive().max(60).optional(),
    /** Publish exactly this many offers. See BuildOptions.offerCount. */
    offerCount: z.number().int().positive().max(400).optional(),
    /** Force one of the chain's readers instead of matching the file. */
    sourceId: z.string().max(40).optional(),
    brief: z.string().max(2000).optional(),
    skipCuration: z.boolean().optional(),
    seed: z.string().max(64).optional(),
  });

  app.get('/api/brand/curation/status', (c) =>
    c.json({ configured: Boolean(process.env['ANTHROPIC_API_KEY']) }));

  /*
   * Reports the image model as well as the key.
   *
   * Which model is about to be billed is the one fact the editor cannot
   * see from the studio and the first thing they ask when a drawing
   * fails, because on this API the failure is a billing setting on a
   * named model — so the name belongs on screen, not in a log.
   */
  app.get('/api/brand/decor/status', (c) =>
    c.json({
      configured: Boolean(process.env['GEMINI_API_KEY']),
      imageModel: DEFAULT_IMAGE_MODEL,
    }));

  const DecorRequest = z.object({
    document: CatalogDocument,
    brief: z.string().max(2000).optional(),
    /**
     * The editor's own words for the image model, added to every prompt
     * on top of the fixed craft. Capped well below `brief`: it is a
     * direction, and `imagePrompt` trims it to 300 characters anyway so
     * it cannot drown out the white-background contract the cut-out
     * step depends on.
     */
    style: z.string().max(500).optional(),
    /** Answer from the cache only — never call the image model. */
    offline: z.boolean().optional(),
  });

  /**
   * Paint mood artwork behind a document's offers.
   *
   * Takes the whole document and gives a whole document back, rather
   * than patching pages in place: decoration is a pass over a finished
   * catalogue, and the editor already knows how to swap one document for
   * another — that is what undo is built on.
   *
   * `assetDir` is required. Without a directory to write into, the
   * generated artwork would have nowhere to live and the page would name
   * a file nobody could serve, so this refuses rather than producing a
   * document full of broken references.
   */
  app.post('/api/brand/decor', async (c) => {
    const definition = c.get('brand');

    if (!options.assetDir) {
      return c.json(
        { error: 'serveren har ingen assetDir at gemme billeder i' },
        503,
      );
    }
    if (!process.env['GEMINI_API_KEY']) {
      return c.json(
        {
          error: 'ingen API-nøgle',
          detail: 'Sæt GEMINI_API_KEY i .env og genstart API-serveren.',
        },
        503,
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = DecorRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    /*
     * The document must belong to the chain the request is acting as.
     * Everything else here is scoped by the brand middleware; a document
     * arrives in the BODY, so it is the one thing that could carry
     * another tenant's id past it.
     */
    if (parsed.data.document.brandId !== definition.brand.id) {
      return c.json({ error: 'dokumentet tilhører en anden kæde' }, 403);
    }

    try {
      const result = await decorate(parsed.data.document, {
        assetRoot: options.assetDir,
        brand: definition.brand,
        ...(parsed.data.brief ? { brief: parsed.data.brief } : {}),
        ...(parsed.data.style ? { style: parsed.data.style } : {}),
        ...(parsed.data.offline ? { offline: true } : {}),
      });
      return c.json({
        document: result.document,
        drawn: result.drawn,
        skipped: result.skipped,
        cached: result.cached,
        // Never thrown by `decorate` — a page that could not be drawn is
        // reported so the editor can say which, and why.
        errors: result.errors,
        usage: result.usage ?? null,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'decor failed' }, 500);
    }
  });

  app.post('/api/brand/build', async (c) => {
    const definition = c.get('brand');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = BuildRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const wantsCuration = !parsed.data.skipCuration;
    if (wantsCuration && !process.env['ANTHROPIC_API_KEY']) {
      return c.json(
        { error: 'ingen API-nøgle', detail: 'Sæt ANTHROPIC_API_KEY i .env og genstart API-serveren.' },
        503,
      );
    }

    try {
      const result = await buildCatalogue(definition.brand.id, parsed.data.feed, {
        catalogId: `${definition.brand.id}-studio`,
        labels,
        ...(parsed.data.maxPages ? { maxPages: parsed.data.maxPages } : {}),
        ...(parsed.data.offerCount ? { offerCount: parsed.data.offerCount } : {}),
        ...(parsed.data.sourceId ? { sourceId: parsed.data.sourceId } : {}),
        ...(parsed.data.brief ? { brief: parsed.data.brief } : {}),
        ...(parsed.data.seed ? { seed: parsed.data.seed } : {}),
        skipCuration: !wantsCuration,
      });

      return c.json({
        document: result.document,
        curated: result.curated,
        source: result.source,
        curationError: result.curationError ?? null,
        offerCount: result.offerCount,
        dropped: result.dropped.length,
        issues: result.issues.slice(0, 20),
        substitutions: result.substitutions,
        usage: result.usage ?? null,
      });
    } catch (error) {
      // A feed that does not match the chain is a user error, not a bug.
      return c.json({ error: error instanceof Error ? error.message : 'build failed' }, 422);
    }
  });

  /**
   * The chain's own artwork, put on a page.
   *
   * Not everything on a leaflet is a packshot or a generated motif. A
   * chain has its own photographs — its grapes, its almonds, its bowl of
   * chips — shot for its own book, and a page that can only use what a
   * model invents is a page the chain's designer cannot work on.
   *
   * Base64 in JSON rather than multipart, for the same reasons as
   * `/reproduce`: it is one file, it is already in memory, and it keeps
   * this route the shape of every other route here. The 18 MB cap is a
   * generous press photograph plus base64's third.
   *
   * The reply is a URL, never the bytes back. A document references its
   * artwork and never embeds it — see `PageDecoration.imageUrl` — so a
   * catalogue stays small enough to save, diff and print.
   */
  const UploadRequest = z.object({
    file: z.string().min(1).max(24_000_000),
    /** Shown back to the editor; never used as a path. */
    name: z.string().max(200).optional(),
    /**
     * Flood-fill the white field out of it before storing.
     *
     * Only for a picture that was DRAWN to be cut — one composed to
     * `clusterPrompt`, which demands white reaching all four edges. A
     * photograph from a designer's folder must never go through it: the
     * fill would take the sky with it.
     */
    cut: z.boolean().optional(),
  });

  app.post('/api/brand/uploads', async (c) => {
    if (!uploads) {
      return c.json(
        { error: 'ingen billedmappe', detail: 'Serveren blev startet uden assetDir.' },
        503,
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }
    const parsed = UploadRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const bytes = Buffer.from(parsed.data.file, 'base64');
    if (bytes.length === 0) return c.json({ error: 'billedet kunne ikke afkodes' }, 400);

    /*
     * The type is read from the first bytes, not from the filename.
     *
     * The same rule as the reference upload, and for the same reason: a
     * `.png` holding a JPEG is exactly what a designer's folder
     * contains, and the extension decides how the file is later SERVED.
     * `mediaType` throws on anything that is not an image this renderer
     * can draw, which is the validation as well as the answer.
     */
    let extension: string;
    try {
      extension = mediaType(bytes).split('/')[1]!;
    } catch {
      return c.json({ error: 'filen er ikke et billede (PNG, JPEG, WebP eller GIF)' }, 415);
    }

    /*
     * Stored exactly as it arrived, unless the caller asks otherwise.
     *
     * This route used to flood-fill the background out of EVERY upload,
     * on the theory that a chain's packshots come off a white studio
     * sweep. In practice they do not arrive that way and do not need
     * to: a chain that prints a leaflet already keeps cut-out artwork,
     * and the fill was as likely to eat the sky out of a photograph as
     * to help. So it is opt-in now, and the opt-in is the only case
     * where the contract holds — a picture composed to `clusterPrompt`,
     * which DEMANDS a white field reaching all four edges. Asking for
     * the fill is the caller saying "this one was drawn to be cut".
     */
    if (parsed.data.cut) {
      try {
        const cut = await cutout(bytes, mediaType(bytes), { trim: true });
        /*
         * `kept` is the honest half. A flood fill that finds nothing
         * returns the picture essentially unchanged — which is what a
         * model that drew a room instead of a white field produces —
         * and the editor has to be told, because a white rectangle on
         * SuperBrugsen's yellow looks like a rendering bug rather than
         * like a prompt that was ignored.
         */
        const { ref } = uploads.put(cut.bytes, 'png');
        return c.json({
          url: ref,
          bytes: cut.bytes.length,
          cut: { kept: cut.kept, threshold: cut.threshold },
        });
      } catch (error) {
        return c.json({
          error: `baggrunden kunne ikke skæres fra: ${error instanceof Error ? error.message : 'ukendt fejl'}`,
        }, 500);
      }
    }

    const { ref } = uploads.put(bytes, extension);
    return c.json({ url: ref, bytes: bytes.length });
  });

  /**
   * Rebuild a published page with this week's products.
   *
   * The three stages of `@incitio/match` run here rather than in the
   * browser, for the same reason curation does: the Anthropic key stays
   * in the server's environment, and rasterising a PDF page needs a
   * Chromium the browser cannot launch. The client sends a picture and a
   * feed and gets back a finished document.
   *
   * The reference arrives base64-encoded in JSON rather than as
   * multipart. It is one file per request, it is already being read into
   * memory to be sent to the model, and a JSON body keeps this route the
   * same shape as every other route in this file. The 24 MB cap is the
   * 18 MB the API accepts for an image, plus base64's third.
   */
  const FeedRequest = z.object({
    feed: z.string().max(20_000_000),
    /** The uploaded file's name, which helps tell a CSV from a JSON. */
    filename: z.string().max(200).optional(),
    sourceId: z.string().max(40).optional(),
  });

  /**
   * What is actually in the file somebody just uploaded.
   *
   * The same reader the build and the rebuild use, run for its own sake:
   * an upload used to be a string the studio held until something was
   * generated from it, so the first time anyone saw whether the file had
   * parsed — or which of the chain's formats it had been read as, or
   * that half its products have no photograph — was several minutes and
   * one model call later.
   *
   * Free, and no model is involved. The offers come back whole rather
   * than summarised: the editor's library shows a picture and a name,
   * and everything else it shows is already in this record.
   */
  app.post('/api/brand/feed', async (c) => {
    const definition = c.get('brand');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = FeedRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    if (!parsed.data.feed.trim()) return c.json({ error: 'filen er tom' }, 400);

    /*
     * Matched against THIS chain's readers, never against every chain's
     * — see "Kæder er adskilte" in the README. A Netto file uploaded to
     * a SuperBrugsen session is rejected with what was missing, not
     * quietly read by whichever mapping happened to fit.
     */
    let source;
    let reason: string;
    if (parsed.data.sourceId) {
      const named = findSource(definition, parsed.data.sourceId);
      if (!named) {
        return c.json({
          error: `${definition.brand.name} har ingen kilde "${parsed.data.sourceId}"`,
          detail: `Kendte: ${definition.sources.map((s) => s.id).join(', ')}`,
        }, 400);
      }
      source = named;
      reason = `valgt manuelt: ${named.name}`;
    } else {
      const match = resolveSource(definition, parsed.data.feed, parsed.data.filename ?? '');
      if (!match.source) return c.json({ error: match.reason }, 422);
      source = match.source;
      reason = match.reason;
    }

    try {
      const { feed } = source.format === 'csv'
        ? ingestCsv(parsed.data.feed, source.mapping, labels)
        : ingestJson(parsed.data.feed, source.mapping, labels);

      return c.json({
        source: { id: source.id, name: source.name, reason },
        offers: feed.offers,
        // Said here rather than counted in the browser, because it is the
        // number that decides what can go on a page: an offer without a
        // photograph cannot stand in for a product in print.
        withImage: feed.offers.filter((offer) => offer.imageUrl).length,
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'feedet kunne ikke læses',
      }, 422);
    }
  });

  const ArrangeRequest = z.object({
    /** The products that are to share one cell. Two or more. */
    offers: z.array(Offer).min(1).max(8),
    /** What the cell is, in the only terms that change the answer. */
    cell: z.object({
      role: z.enum(['hero', 'feature', 'standard', 'compact']),
      aspect: z.number().positive().max(20),
      width: z.number().positive().max(1),
    }),
    /** The editor's own steer, when they gave one. */
    note: z.string().max(500).optional(),
  });

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
    if (!process.env['GEMINI_API_KEY']) {
      return c.json({
        error: 'ingen nøgle til billedmodellen',
        detail: 'Sæt GEMINI_API_KEY i .env og genstart API-serveren. '
          + 'Billedgenerering kræver desuden fakturering på Google-projektet.',
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
    const fetched = await fetchImages(offers.map((offer) => offer.imageUrl));
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
      const cut = await cutout(drawn.bytes, drawn.mimeType, { trim: true });
      const stored = uploadStore(options.assetDir).put(cut.bytes, 'png');

      return c.json({
        url: stored.ref,
        bytes: cut.bytes.length,
        prompt: drawn.prompt,
        model: drawn.model || DEFAULT_IMAGE_MODEL,
        cut: { kept: cut.kept, threshold: cut.threshold },
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
   * Everything needed to run the composition BY HAND.
   *
   * The image model is billing-gated on Google's side, and waiting for
   * a billing account is not a reason to be unable to see whether the
   * prompt works. This hands back the two things a person needs to do
   * it themselves in Gemini's own app: the prompt exactly as the server
   * would send it, and the cutouts as files, numbered in the order the
   * prompt names them.
   *
   * The pictures are re-served from this server rather than linked to
   * the chain's: a cross-origin link cannot carry a filename, and the
   * filename is the whole point — the prompt says "image 1: Klovborg
   * skæreost" and the file has to say so too, or the upload order is
   * guesswork and every label lands on the wrong product.
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
    const fetched = await fetchImages(offers.map((offer) => offer.imageUrl));
    const missing = offers.filter((_, index) => fetched[index] === null);
    if (missing.length > 0) {
      return c.json({
        error: 'billedet kunne ikke hentes for '
          + missing.map((offer) => offer.name).join(', '),
      }, 422);
    }

    const store = uploadStore(options.assetDir);
    const files = offers.map((offer, index) => {
      const image = fetched[index]!;
      const stored = store.put(image.bytes, image.mimeType.split('/')[1] ?? 'png');
      return {
        index: index + 1,
        // What the file should be called when it is saved. Numbered
        // first so a folder sorts into the prompt's own order.
        name: `${index + 1}-${offer.name.replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 50)}`
          + `.${image.mimeType.split('/')[1] ?? 'png'}`,
        url: stored.ref,
        bytes: image.bytes.length,
      };
    });

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

  const ClusterLayoutRequest = z.object({
    /** The composed picture, base64. */
    file: z.string().min(1).max(24_000_000),
    /** The products, in the order the composition's prompt numbered them. */
    offers: z.array(Offer).min(2).max(8),
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

  const PublicationRequest = z.object({
    url: z.string().min(1).max(4000),
    /** Which pages to take, 1-based. All of them when absent. */
    pages: z.array(z.number().int().positive().max(400)).max(400).optional(),
    /** The grid without the products on it. They still travel, on the bench. */
    withOffers: z.boolean().optional(),
    name: z.string().max(200).optional(),
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
  app.post('/api/brand/publication', async (c) => {
    const definition = c.get('brand');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = PublicationRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    try {
      const run = await importPublication(parsed.data.url, {
        brandId: definition.brand.id,
        catalogId: `${definition.brand.id}-${Date.now().toString(36)}`,
        name: parsed.data.name || 'Hentet udgivelse',
        ...(parsed.data.pages?.length ? { pages: parsed.data.pages } : {}),
        ...(parsed.data.withOffers === false ? { withOffers: false } : {}),
      });

      return c.json({
        document: run.document,
        readings: run.readings,
        publication: { id: run.publication.id, pages: run.publication.pages.length },
      });
    } catch (error) {
      // A link that cannot be read is the editor's problem to fix — a
      // wrong address, an expired signature — and says which.
      if (error instanceof PublicationError) return c.json({ error: error.message }, 422);
      return c.json({
        error: error instanceof Error ? error.message : 'udgivelsen kunne ikke hentes',
      }, 500);
    }
  });

  const LayoutRequest = z.object({
    feed: z.string().max(20_000_000).default(''),
    sourceId: z.string().max(40).optional(),
    /** How many product cells to ask the image model for. */
    cells: z.number().int().min(1).max(12).optional(),
    /** The editor's own words, added to the standing layout prompt. */
    note: z.string().max(500).optional(),
    /** A steer for the casting step — the same one `reproduce` takes. */
    brief: z.string().max(2000).optional(),
    /** The sheet colour to draw on. Defaults to the chain's own. */
    ground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    exclude: z.array(z.string().max(200)).max(2000).optional(),
    poolSize: z.number().int().min(4).max(200).optional(),
  });

  /**
   * A page whose layout was DRAWN rather than handed in.
   *
   * Two models, and the split is the point: the image model decides what
   * shape the page is, and the casting step decides which product sits
   * in which cell. The drawing never reaches the sheet — it is read and
   * discarded, and what prints is the chain's own tiles in the cells it
   * turned out to have. It is returned only so the editor can see what
   * was read, the same way a scanned reference is.
   *
   * Needs both keys, and says which one is missing: the drawing is
   * Gemini's and the casting is Claude's, and a single "no API key"
   * would send someone to the wrong line of `.env`.
   */
  app.post('/api/brand/layout', async (c) => {
    const definition = c.get('brand');

    if (!process.env['GEMINI_API_KEY']) {
      return c.json({
        error: 'ingen nøgle til billedmodellen',
        detail: 'Sæt GEMINI_API_KEY i .env og genstart API-serveren. '
          + 'Billedgenerering kræver desuden fakturering på Google-projektet.',
      }, 503);
    }
    if (!process.env['ANTHROPIC_API_KEY']) {
      return c.json({
        error: 'ingen nøgle til modellen der læser layoutet',
        detail: 'Sæt ANTHROPIC_API_KEY i .env og genstart API-serveren.',
      }, 503);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = LayoutRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    try {
      const result = await imaginePage({
        brandId: definition.brand.id,
        feedText: parsed.data.feed,
        catalogId: `${definition.brand.id}-layout`,
        labels,
        layout: {
          ...(parsed.data.cells ? { cells: parsed.data.cells } : {}),
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          ground: parsed.data.ground ?? definition.brand.groundTints?.[0] ?? '',
        },
        ...(parsed.data.brief ? { note: parsed.data.brief } : {}),
        ...(parsed.data.sourceId ? { sourceId: parsed.data.sourceId } : {}),
        ...(parsed.data.exclude?.length ? { exclude: parsed.data.exclude } : {}),
        ...(parsed.data.poolSize ? { poolSize: parsed.data.poolSize } : {}),
        referenceName: 'genereret layout',
      });

      return c.json({
        document: result.document,
        brand: result.brand,
        template: result.template,
        ground: result.ground,
        casting: result.casting,
        grid: result.grid,
        source: result.source,
        // The drawing, for the side-by-side. It is NOT on the page and
        // never will be — see `imaginePage`.
        reference: `data:${result.reference.type};base64,`
          + `${result.reference.image.toString('base64')}`,
        prompt: result.prompt,
        imageModel: result.imageModel,
        drawnInMs: result.drawnInMs,
        offersInFeed: result.offersInFeed,
        poolSize: result.poolSize,
        rejected: result.rejected,
        usage: result.usage,
        elapsedMs: result.elapsedMs,
      });
    } catch (error) {
      if (error instanceof MatchError) return c.json({ error: error.message }, 422);
      if (error instanceof GeminiError) return c.json({ error: error.message }, 422);
      return c.json({ error: error instanceof Error ? error.message : 'layout failed' }, 500);
    }
  });

  const ReproduceRequest = z.object({
    /** The reference page, base64. An image, or a PDF to take a page of. */
    file: z.string().min(1).max(24_000_000),
    /** Which page of a PDF. Ignored for an image. */
    pageNumber: z.number().int().positive().max(400).optional(),
    feed: z.string().max(20_000_000).default(''),
    sourceId: z.string().max(40).optional(),
    note: z.string().max(2000).optional(),
    /**
     * Offers already printed by earlier requests in the same run.
     *
     * Several references are rebuilt one request per page — see
     * `matchPages` in `@incitio/match` for why the loop is not in here
     * — so the caller is the only one who knows what page three used.
     * Passing it forward is what keeps one catalogue from printing the
     * same product on four pages.
     */
    exclude: z.array(z.string().max(200)).max(2000).optional(),
    poolSize: z.number().int().min(4).max(200).optional(),
    /** Shown back to the editor; never used as a path. */
    referenceName: z.string().max(200).optional(),
  });

  app.post('/api/brand/reproduce', async (c) => {
    const definition = c.get('brand');

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = ReproduceRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    if (!process.env['ANTHROPIC_API_KEY']) {
      return c.json(
        { error: 'ingen API-nøgle', detail: 'Sæt ANTHROPIC_API_KEY i .env og genstart API-serveren.' },
        503,
      );
    }

    let file: Buffer;
    try {
      // `base64` decoding never throws — it drops what it cannot read —
      // so an empty result is the only signal that the upload was not
      // base64 at all.
      file = Buffer.from(parsed.data.file, 'base64');
      if (file.length === 0) throw new Error('tom fil');
    } catch {
      return c.json({ error: 'referencen kunne ikke afkodes' }, 400);
    }

    try {
      const result = await matchPage(definition.brand.id, {
        file,
        feedText: parsed.data.feed,
        catalogId: `${definition.brand.id}-reproduce`,
        labels,
        ...(parsed.data.pageNumber ? { pageNumber: parsed.data.pageNumber } : {}),
        ...(parsed.data.sourceId ? { sourceId: parsed.data.sourceId } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(parsed.data.exclude?.length ? { exclude: parsed.data.exclude } : {}),
        ...(parsed.data.poolSize ? { poolSize: parsed.data.poolSize } : {}),
        ...(parsed.data.referenceName ? { referenceName: parsed.data.referenceName } : {}),
      });

      return c.json({
        document: result.document,
        // The chain carrying the one layout this page needs. The editor
        // renders with it; the layout itself also travels inside the
        // document, which is what makes it survive a save and a print.
        brand: result.brand,
        template: result.template,
        ground: result.ground,
        casting: result.casting,
        // Whether the grid was measured out of the PDF or read off the
        // picture by the model. Two different levels of trust, and the
        // editor is the one who should be told which it got.
        grid: result.grid,
        source: result.source,
        // What the model was shown, so the editor can put the two pages
        // side by side. PNG for a PDF page, the original otherwise.
        reference: `data:${result.reference.type};base64,${result.reference.image.toString('base64')}`,
        offersInFeed: result.offersInFeed,
        poolSize: result.poolSize,
        rejected: result.rejected,
        usage: result.usage,
        elapsedMs: result.elapsedMs,
      });
    } catch (error) {
      // A page the model could not read, or a feed that does not match
      // the chain, is a user error and says so. Anything else is a bug
      // and should not be dressed up as one.
      if (error instanceof MatchError) return c.json({ error: error.message }, 422);
      return c.json({ error: error instanceof Error ? error.message : 'reproduce failed' }, 500);
    }
  });

  /** Print a stored catalogue. Chromium renders the same components. */
  app.get('/api/brand/catalogs/:id/pdf', async (c) => {
    const definition = c.get('brand');
    const document = store.get(definition.brand.id, c.req.param('id'));
    if (!document) return c.json({ error: 'not found' }, 404);

    const pdf = await renderCataloguePdf(document, definition.brand, {
      ...(options.assetDir ? { assetDir: options.assetDir } : {}),
    });
    return c.body(new Uint8Array(pdf), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${document.id}.pdf"`,
    });
  });

  return app;
}
