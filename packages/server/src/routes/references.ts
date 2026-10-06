import { Hono } from 'hono';
import { z } from 'zod';
import { decodePixels, imaginePage, matchPage, MatchError, mediaType } from '@incitio/match';
import { GeminiError } from '@incitio/decor';
import { findPageCells, importPublication, PublicationError } from '@incitio/publication';
import { imageKey, type Scope } from '../http.js';
import type { RouteContext } from '../index.js';

/** Udgivelser og referencesider: importér, tegn layout, genskab. */
export function referencesRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { store, labels, uploadsFor, PublicationRequest, browserForPaged } = ctx;
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
      const uploads = uploadsFor(definition.brand.id);
      const run = await importPublication(parsed.data.url, {
        brandId: definition.brand.id,
        catalogId: `${definition.brand.id}-${Date.now().toString(36)}`,
        name: parsed.data.name || 'Hentet udgivelse',
        ...(parsed.data.pages?.length ? { pages: parsed.data.pages } : {}),
        ...(parsed.data.withOffers === false ? { withOffers: false } : {}),
        // A picture-only publication's pages are kept as the chain's own uploads,
        ...(uploads ? { store: (bytes: Buffer, extension: string) => uploads.put(bytes, extension).ref } : {}),
        // and their cells read off the pixels — free, and no model.
        analyse: async (bytes: Buffer) => {
          const browser = await browserForPaged();
          return findPageCells(await decodePixels(browser, bytes, mediaType(bytes)));
        },
      });

      return c.json({
        document: run.document,
        readings: run.readings,
        publication: {
          id: run.publication.id,
          pages: run.publication.pages.length,
          // Pictures, not incito — and how many products the catalogue named.
          paged: run.paged !== null,
          title: run.paged?.title ?? null,
          known: run.paged?.known ?? 0,
        },
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

    const apiKey = imageKey(c);
    if (!apiKey) {
      return c.json({
        error: 'ingen nøgle til billedmodellen',
        detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env'
          + ' og genstart API-serveren. Billedgenerering kræver desuden fakturering'
          + ' på Google-projektet.',
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
        // The drawing half. The casting half is Claude's and reads its
        // own key from the environment.
        gemini: { apiKey },
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
}
