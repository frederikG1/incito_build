import { Hono } from 'hono';
import { z } from 'zod';
import { CatalogDocument } from '@incitio/schema';
import { findSource, resolveSource } from '@incitio/brands';
import { buildCatalogue } from '@incitio/pipeline';
import { ingestFeed } from '@incitio/ingest';
import { mediaType } from '@incitio/match';
import { cutout, decorate, DEFAULT_IMAGE_MODEL } from '@incitio/decor';
import { imageKey, type Scope, feedDealer, cutOptions } from '../http.js';
import type { RouteContext } from '../index.js';

/** At bygge en uge: status, stemningsbilleder, bygning, uploads og feed. */
export function buildRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { store, options, labels, uploadsFor, BuildRequest } = ctx;
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
    /** Only these pages; omitted means every page. */
    pageIds: z.array(z.string()).max(200).optional(),
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
    const apiKey = imageKey(c);
    if (!apiKey) {
      return c.json(
        {
          error: 'ingen API-nøgle',
          detail: 'Indsæt en Gemini-nøgle i studioet, eller sæt GEMINI_API_KEY i .env'
            + ' og genstart API-serveren.',
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
        apiKey,
        ...(parsed.data.brief ? { brief: parsed.data.brief } : {}),
        ...(parsed.data.style ? { style: parsed.data.style } : {}),
        ...(parsed.data.offline ? { offline: true } : {}),
        ...(parsed.data.pageIds ? { pageIds: parsed.data.pageIds } : {}),
      });
      return c.json({
        document: result.document,
        drawn: result.drawn,
        subjects: result.subjects,
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
        ...(parsed.data.exclude?.length ? { exclude: parsed.data.exclude } : {}),
        ...(parsed.data.week ? { week: parsed.data.week } : {}),
        skipCuration: !wantsCuration,
        ...(definition.brand.offerDesigns.length > 0
          ? { designs: { designs: definition.brand.offerDesigns, tag: definition.brand.designTag } } : {}),
      });

      return c.json({
        document: result.document,
        curated: result.curated,
        source: result.source,
        curationError: result.curationError ?? null,
        offerCount: result.offerCount,
        outsideWeek: result.outsideWeek,
        inWeek: result.inWeek,
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
    const brandId = c.get('brand').brand.id;
    const uploads = uploadsFor(brandId);
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
        const cut = await cutout(bytes, mediaType(bytes), await cutOptions());
        /*
         * `kept` is the honest half. A flood fill that finds nothing
         * returns the picture essentially unchanged — which is what a
         * model that drew a room instead of a white field produces —
         * and the editor has to be told, because a white rectangle on
         * SuperBrugsen's yellow looks like a rendering bug rather than
         * like a prompt that was ignored.
         */
        const { ref } = uploads.put(cut.bytes, 'png');
        store.rememberUpload(brandId, ref, parsed.data.name?.trim() || 'uden navn');
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
    /*
     * Written down, not just written to disk.
     *
     * The bytes were always stored; nothing recorded that they had
     * been. A picture could therefore only be reached through a
     * document that already pointed at it — upload a background, press
     * undo, and it was unreachable for good. The row is what makes the
     * chain's own library a place rather than a side effect.
     */
    store.rememberUpload(brandId, ref, parsed.data.name?.trim() || 'uden navn');
    return c.json({ url: ref, bytes: bytes.length });
  });

  /** This chain's own pictures. Never another chain's — see `uploads`. */
  app.get('/api/brand/uploads', (c) =>
    c.json({ uploads: store.uploads(c.get('brand').brand.id) }));

  /*
   * Take one out of the library.
   *
   * The row goes and the file stays: a catalogue saved last week may
   * still be printing it, and a library says what is on offer rather
   * than what exists.
   */
  app.delete('/api/brand/uploads', (c) => {
    const ref = c.req.query('ref') ?? '';
    return store.forgetUpload(c.get('brand').brand.id, ref)
      ? c.json({ ok: true })
      : c.json({ error: 'not found' }, 404);
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

    /*
     * Tjek's own formats are every chain's (see `withTjekFormats`), so the
     * format no longer says whose file it is. The file itself often does:
     * the offers API names its dealer on every row. A file that names
     * another chain is refused, as a foreign format used to be.
     */
    const owner = feedDealer(parsed.data.feed);
    const mine = definition.brand.name.split(/[\s—-]+/)[0]!.toLowerCase();
    if (owner && !owner.toLowerCase().includes(mine) && !mine.includes(owner.toLowerCase())) {
      return c.json({ error: `filen er ${owner}s — du arbejder i ${definition.brand.name}` }, 422);
    }

    try {
      const { feed } = ingestFeed(parsed.data.feed, source.mapping, labels);

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

}
