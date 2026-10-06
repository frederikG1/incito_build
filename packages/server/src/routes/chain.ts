import { Hono } from 'hono';
import { z } from 'zod';
import { OfferDesigns, OfferRules, Themes } from '@incitio/schema';
import { feedHealth } from '@incitio/brands';
import { Section } from '../db.js';
import { type Scope } from '../http.js';
import type { RouteContext } from '../index.js';

/** Kædens egne indstillinger: feedtjek, profil, sektioner, varedesigns, temaer og regler. */
export function chainRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { store, labels } = ctx;
  /*
   * A feed file judged before anything is built from it — see
   * `feedHealth`. The raw file as the body, its name in `?name=` (the
   * extension decides CSV/XML/JSON). Nothing is stored: this is the
   * look a person takes the morning the chain's file lands.
   */
  app.post('/api/brand/feed-health', async (c) => {
    const text = await c.req.text();
    if (!text.trim()) return c.json({ error: 'tom fil' }, 422);
    if (text.length > 50_000_000) return c.json({ error: 'filen er for stor' }, 413);
    return c.json(feedHealth(c.get('brand'), text, c.req.query('name') ?? 'feed', labels));
  });

  /** This chain's identity, its layouts, and the formats it delivers. */
  app.get('/api/brand/profile', (c) => {
    const { brand, sources } = c.get('brand');
    return c.json({
      brand,
      /*
       * A publication to test with, when the machine has one.
       *
       * From the environment rather than from the code, because the
       * link IS the access: a preview carries its signature in `?s=`,
       * and a signature committed to a repository is a publication
       * shared with everyone who clones it. `.env` is gitignored, and
       * this is the same bargain the keys make.
       *
       * It only prefills a field. Anyone can type another link over
       * it, and a deployment without the variable simply gets an
       * empty box, exactly as before.
       */
      testPublication: process.env['INCITIO_TEST_PUBLICATION'] ?? '',
      // The mappings are functions and stay server-side; the editor
      // only needs to know which readers exist and where the samples
      // live.
      sources: sources.map((s) => ({
        id: s.id, name: s.name, format: s.format, path: s.path ?? null,
        sample: s.sample ?? false,
      })),
    });
  });

  /*
   * The chain's section designs. Same scoping as catalogues: the brand
   * comes from the middleware, never from the body.
   */
  app.get('/api/brand/sections', (c) =>
    c.json({ sections: store.sections(c.get('brand').brand.id) }));

  app.post('/api/brand/sections', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }
    const parsed = Section.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'invalid section', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    try {
      return c.json({ section: store.saveSection(c.get('brand').brand.id, parsed.data) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'kunne ikke gemme' }, 403);
    }
  });

  /** The chain's offer designs — see `OfferDesign`. Saved whole, with the tag pages use by default. */
  app.get('/api/brand/offer-designs', (c) => c.json({
    designs: c.get('brand').brand.offerDesigns, tag: c.get('brand').brand.designTag,
  }));

  const DesignsRequest = z.object({ designs: OfferDesigns, tag: z.string().max(120).nullable().default(null) });
  app.put('/api/brand/offer-designs', async (c) => {
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ error: 'body is not valid JSON' }, 400); }
    const parsed = DesignsRequest.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid designs', issues: parsed.error.issues.slice(0, 5) }, 400);
    return c.json(store.saveOfferDesigns(c.get('brand').brand.id, parsed.data.designs, parsed.data.tag));
  });

  /** The chain's offer rules — see `OfferRule`. Saved whole: their order is their precedence. */
  // The chain's themes, read and written whole — the list is the setting.
  app.get('/api/brand/themes', (c) => c.json({ themes: store.themes(c.get('brand').brand.id) }));
  app.put('/api/brand/themes', async (c) => {
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ error: 'body is not valid JSON' }, 400); }
    const parsed = Themes.safeParse((payload as { themes?: unknown } | null)?.themes);
    if (!parsed.success) return c.json({ error: 'invalid themes', issues: parsed.error.issues.slice(0, 5) }, 400);
    return c.json({ themes: store.saveThemes(c.get('brand').brand.id, parsed.data) });
  });

  app.get('/api/brand/offer-rules', (c) => c.json({ rules: c.get('brand').brand.offerRules }));

  app.put('/api/brand/offer-rules', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'body is not valid JSON' }, 400);
    }
    const parsed = OfferRules.safeParse((payload as { rules?: unknown } | null)?.rules);
    if (!parsed.success) {
      return c.json({ error: 'invalid rules', issues: parsed.error.issues.slice(0, 5) }, 400);
    }
    return c.json({ rules: store.saveOfferRules(c.get('brand').brand.id, parsed.data) });
  });

  app.delete('/api/brand/sections/:id', (c) =>
    (store.removeSection(c.get('brand').brand.id, c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not found' }, 404)));
}
