import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CatalogDocument } from '@incitio/schema';
import { findBrand, listBrands, type BrandDefinition } from '@incitio/brands';
import { buildCatalogue } from '@incitio/pipeline';
import { renderCataloguePdf } from '@incitio/pdf';
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
}

export function createApp(store: Store, options: AppOptions = {}) {
  const app = new Hono<Scope>();

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
