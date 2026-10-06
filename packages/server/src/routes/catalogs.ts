import { Hono } from 'hono';
import { z } from 'zod';
import { CatalogDocument } from '@incitio/schema';
import { applyOps, EditError, findVariant, instruct, outline, outlineText, resolveVariant, variantSummary } from '@incitio/edit';
import { SaveConflict } from '../db.js';
import { keepWorkflow } from '@incitio/workflow';
import { Refused, refusal, workflowRoutes } from '../workflow.js';
import { type Scope } from '../http.js';
import type { RouteContext } from '../index.js';

/** Aviserne: læs, gem, versioner, udgaver, ops og slet. */
export function catalogsRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { store, options, prices, commit, edition } = ctx;
  app.get('/api/brand/catalogs', (c) =>
    c.json({ catalogs: store.list(c.get('brand').brand.id) }));

  app.get('/api/brand/catalogs/:id', (c) => {
    const document = store.get(c.get('brand').brand.id, c.req.param('id'));
    // 404, not 403: whether a catalogue exists under another chain is
    // itself information this session has no business having.
    if (!document) return c.json({ error: 'not found' }, 404);
    return c.json({ document });
  });

  /*
   * An avis's front page and what stands on it, for the front page's
   * covers: a page, its offers and its layout — enough to draw it with
   * the renderer, a hundredth of the document.
   */
  app.get('/api/brand/catalogs/:id/cover', (c) => {
    const document = store.get(c.get('brand').brand.id, c.req.param('id'));
    if (!document) return c.json({ error: 'not found' }, 404);
    const page = document.pages[0] ?? null;
    if (!page) return c.json({ page: null, offers: [], templates: [] });
    const on = new Set(page.placements.map((p) => p.offerId));
    return c.json({
      page,
      offers: document.offers.filter((o) => on.has(o.id)),
      templates: document.templates.filter((t) => t.id === page.templateId),
    });
  });

  /*
   * The name and the status, from the front page: two fields, so
   * renaming last week's avis does not mean opening it. Saved as a
   * version like any other change.
   */
  const MetaRequest = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['kladde', 'klar', 'udgivet', 'skjult']).optional(),
  });
  app.patch('/api/brand/catalogs/:id', async (c) => {
    const { brand } = c.get('brand');
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ error: 'body is not valid JSON' }, 400); }
    const parsed = MetaRequest.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    const patch = parsed.data;
    try {
      const { document } = commit(brand, c.req.param('id'), undefined, (stored) => {
        if (patch.status && patch.status !== stored.status && (patch.status === 'udgivet' || stored.status === 'udgivet')) {
          throw new Refused(422, { error: 'udgivelse går gennem /publish og /unpublish' });
        }
        const label = patch.name ? 'omdøbt' : `status ${patch.status ?? ''}`.trim();
        return { document: { ...stored, ...patch }, label };
      });
      return c.json({ document });
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get('/api/brand/catalogs/:id/versions', (c) =>
    c.json({ versions: store.versions(c.get('brand').brand.id, c.req.param('id')) }));

  app.get('/api/brand/catalogs/:id/versions/:version', (c) => {
    const document = store.version(c.get('brand').brand.id, c.req.param('id'), Number(c.req.param('version')));
    return document ? c.json({ document }) : c.json({ error: 'not found' }, 404);
  });

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

    /*
     * A whole document replaces what is stored, so it must say which
     * stored document it replaces (`expected`) — or say out loud that it
     * means to overwrite (`force=1`, the studio's "keep mine"). Without
     * either, a stale tab would silently undo a colleague's hour.
     */
    const brand = c.get('brand').brand;
    const label = c.req.query('label') ?? '';
    const expected = c.req.query('expected');
    const force = c.req.query('force') === '1';
    try {
      if (!store.get(brandId, id)) {
        // New: it starts unsigned, unsold, unpublished — whatever it says.
        const { document, kept } = keepWorkflow(null, parsed.data);
        return c.json({ document: store.save(brandId, document, label), kept });
      }
      if (!expected && !force) {
        return c.json({ error: 'expected is required: the updatedAt of the version this save replaces (or force=1)' }, 428);
      }
      const done = commit(brand, id, force ? undefined : expected, () => ({ document: parsed.data, label }));
      return c.json(done);
    } catch (error) {
      if (error instanceof Refused) return refusal(c, error);
      if (error instanceof SaveConflict) return c.json({ error: error.message, updatedAt: error.updatedAt }, 409);
      return c.json({ error: error instanceof Error ? error.message : 'save failed' }, 403);
    }
  });


  app.get('/api/brand/catalogs/:id/variants', (c) => {
    const { brand } = c.get('brand');
    const document = store.get(brand.id, c.req.param('id'));
    if (!document) return c.json({ error: 'not found' }, 404);
    return c.json({
      variants: (document.variants ?? []).map((variant) => ({
        id: variant.id, name: variant.name, stores: variant.stores, ops: variant.ops.length,
        ...variantSummary(document, variant, brand),
      })),
    });
  });

  app.get('/api/brand/catalogs/:id/outline', (c) => {
    const { brand } = c.get('brand');
    const seen = edition(brand, c.req.param('id'), c.req.query('variant'));
    if ('error' in seen) return c.json({ error: seen.error }, 404);
    const o = outline(seen.document, brand);
    return c.req.query('format') === 'text' ? c.text(outlineText(o)) : c.json({ outline: o });
  });

  const OpsRequest = z.object({
    ops: z.array(z.unknown()).min(1).max(200),
    /** Refuse when the stored document has moved on since it was read. */
    updatedAt: z.string().optional(),
    label: z.string().max(80).optional(),
  });

  /*
   * `?variant=holbaek` edits one edition: the ops are tried on that
   * edition as it resolves now, and on success appended to its list —
   * the base is not touched. Without it they edit the base, and so every
   * edition at once.
   */
  app.post('/api/brand/catalogs/:id/ops', async (c) => {
    const { brand } = c.get('brand');
    const variantId = c.req.query('variant');
    // The body first: nothing is awaited between reading the stored catalogue and saving it.
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ error: 'body is not valid JSON' }, 400); }
    const parsed = OpsRequest.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    let applied: string[] = [];
    try {
      // Ops are deltas: without `updatedAt` they apply to the catalogue as it is now, and lose nothing.
      const { document } = commit(brand, c.req.param('id'), parsed.data.updatedAt, (stored) => {
        if (variantId) {
          if (!findVariant(stored, variantId)) throw new Refused(404, { error: `no variant "${variantId}"` });
          const shown = resolveVariant(stored, variantId, brand).document;
          applied = applyOps(shown, parsed.data.ops, brand).applied;
          const variants = (stored.variants ?? []).map((v) => (v.id === variantId
            ? { ...v, ops: [...v.ops, ...(parsed.data.ops as typeof v.ops)] }
            : v));
          return { document: { ...stored, variants }, label: parsed.data.label ?? `ops ${variantId}` };
        }
        const edited = applyOps(stored, parsed.data.ops, brand);
        applied = edited.applied;
        return { document: edited.document, label: parsed.data.label ?? 'ops' };
      });
      return c.json({ document, applied });
    } catch (error) {
      if (error instanceof EditError) return c.json({ error: error.message, index: error.index }, 422);
      return refusal(c, error);
    }
  });

  workflowRoutes(app, store, commit, prices, options.measure);

  /*
   * A sentence to ops. The document comes in the body, not from the
   * store: the studio asks about the page on screen, saved or not. It
   * returns a PROPOSAL — nothing is applied or saved here.
   */
  const InstructRequest = z.object({
    document: CatalogDocument,
    instruction: z.string().min(1).max(1000),
    selection: z.object({
      offerId: z.string().nullable().optional(),
      pageId: z.string().nullable().optional(),
    }).optional(),
  });

  app.post('/api/brand/instruct', async (c) => {
    const { brand } = c.get('brand');
    if (!process.env['ANTHROPIC_API_KEY']) return c.json({ error: 'ANTHROPIC_API_KEY mangler i .env' }, 503);
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ error: 'body is not valid JSON' }, 400); }
    const parsed = InstructRequest.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
    if (parsed.data.document.brandId !== brand.id) return c.json({ error: 'not found' }, 404);
    try {
      const result = await instruct(parsed.data.document, brand, parsed.data.instruction, {
        ...(parsed.data.selection ? { selection: parsed.data.selection } : {}),
      });
      // Tried here so the proposal that reaches the page is one that applies.
      let applied: string[] = [];
      let error: string | null = null;
      try {
        applied = applyOps(parsed.data.document, result.ops, brand).applied;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      return c.json({ ...result, applied, error });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'instruct failed' }, 502);
    }
  });

  app.delete('/api/brand/catalogs/:id', (c) =>
    store.remove(c.get('brand').brand.id, c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not found' }, 404));

}
