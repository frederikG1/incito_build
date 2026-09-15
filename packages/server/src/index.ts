import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CatalogDocument } from '@incitio/schema';
import { findBrand, listBrands, type BrandDefinition } from '@incitio/brands';
import { buildCatalogue } from '@incitio/pipeline';
import { EMPTY_LABEL_DICTIONARY, type LabelDictionary } from '@incitio/ingest';
import { matchPage, MatchError, mediaType } from '@incitio/match';
import { uploadStore } from './uploads.js';
import { renderCataloguePdf } from '@incitio/pdf';
import { decorate, DEFAULT_IMAGE_MODEL } from '@incitio/decor';
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
     * Stored exactly as it arrived.
     *
     * This route used to flood-fill the background out of every upload,
     * on the theory that a chain's packshots come off a white studio
     * sweep. In practice they do not arrive that way and do not need
     * to: a chain that prints a leaflet already keeps cut-out artwork,
     * and the fill was as likely to eat the sky out of a photograph as
     * to help. Removing it also removes the question the editor could
     * not answer — whether the picture on screen is the file they
     * chose. It is.
     *
     * The generated artwork's own cut-out stays where it is, in
     * `@incitio/decor`: that one keys out a white field the prompt
     * DEMANDS, which is a contract this route never had.
     */
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
