import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CatalogDocument, Offer } from '@incitio/schema';
import { planCatalog } from '@incitio/planner';
import { Store } from './db.js';

export { Store } from './db.js';

export function createApp(store: Store) {
  const app = new Hono();

  // Internal tool on a developer machine: the studio dev server and the
  // API are different origins. Tenancy and auth arrive with the product,
  // not before it.
  app.use('/api/*', cors());

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/catalogs', (c) => c.json({ catalogs: store.list() }));

  app.get('/api/catalogs/:id', (c) => {
    const document = store.get(c.req.param('id'));
    if (!document) return c.json({ error: 'not found' }, 404);
    return c.json({ document });
  });

  app.get('/api/catalogs/:id/versions', (c) =>
    c.json({ versions: store.versions(c.req.param('id')) }),
  );

  app.put('/api/catalogs/:id', async (c) => {
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
      return c.json(
        { error: 'invalid document', issues: parsed.error.issues.slice(0, 10) },
        400,
      );
    }
    if (parsed.data.id !== id) {
      return c.json({ error: `document id ${parsed.data.id} does not match path ${id}` }, 400);
    }

    const label = c.req.query('label') ?? '';
    return c.json({ document: store.save(parsed.data, label) });
  });

  app.delete('/api/catalogs/:id', (c) =>
    store.remove(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not found' }, 404),
  );

  /**
   * Editorial planning, server-side.
   *
   * The Anthropic key lives in the server's environment and never reaches
   * the browser. The studio sends offers and gets back page assignments —
   * ids and titles, never geometry.
   */
  const PlanRequest = z.object({
    offers: z.array(Offer).min(1).max(600),
    maxPerPage: z.number().int().positive().max(24).optional(),
    language: z.string().max(40).optional(),
    brief: z.string().max(2000).optional(),
  });

  app.get('/api/plan/status', (c) =>
    c.json({ configured: Boolean(process.env['ANTHROPIC_API_KEY']) }),
  );

  app.post('/api/plan', async (c) => {
    if (!process.env['ANTHROPIC_API_KEY']) {
      return c.json(
        { error: 'no API key', detail: 'Set ANTHROPIC_API_KEY in .env and restart the API.' },
        503,
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }

    const parsed = PlanRequest.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    }

    const result = await planCatalog(parsed.data.offers, {
      ...(parsed.data.maxPerPage ? { maxPerPage: parsed.data.maxPerPage } : {}),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.brief ? { brief: parsed.data.brief } : {}),
    });

    if (result.fellBack) {
      return c.json(
        { error: 'planner failed', detail: result.error ?? 'The model call returned no usable plan.' },
        502,
      );
    }

    // Only ids cross the wire: the client already holds the offers, and
    // echoing them back would double the payload for nothing.
    return c.json({
      groups: result.groups.map((group) => ({
        title: group.title,
        subtitle: group.subtitle,
        offerIds: group.offers.map((o) => o.id),
      })),
      reasoning: result.reasoning,
      usage: result.usage ?? null,
    });
  });

  app.get('/api/profiles', (c) => {
    const ids = (c.req.query('offerIds') ?? '').split(',').filter(Boolean);
    return c.json({ profiles: [...store.profilesFor(ids).values()] });
  });

  return app;
}
