import { Hono } from 'hono';
import { renderCataloguePdf } from '@incitio/pdf';
import { CACHED, cachedImage } from '@incitio/decor';
import { type Scope } from '../http.js';
import type { RouteContext } from '../index.js';

/** Avisen som PDF. */
export function pdfRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { options, edition } = ctx;
  /** Print a stored catalogue. Chromium renders the same components. */
  app.get('/api/brand/catalogs/:id/pdf', async (c) => {
    const definition = c.get('brand');
    // `?variant=holbaek` prints that store's edition, worked out from the base as it stands.
    const seen = edition(definition.brand, c.req.param('id'), c.req.query('variant'));
    if ('error' in seen) return c.json({ error: seen.error }, 404);
    const document = seen.document;
    const suffix = c.req.query('variant') ? `-${c.req.query('variant')}` : '';

    /*
     * `?tryk=1` is the file that goes to the printer: 3 mm bleed, crop
     * marks, and a slug line saying which avis and when. Without it the
     * PDF is a proof, trimmed to the page, for reading on a screen.
     */
    const forPrint = c.req.query('tryk') === '1';
    const stamp = new Date().toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
    const pdf = await renderCataloguePdf(document, definition.brand, {
      ...(options.assetDir ? { assetDir: options.assetDir } : {}),
      ...(forPrint ? { marks: { bleedMm: 3, slug: `${document.name} · tryk ${stamp}` } } : {}),
      images: { matches: CACHED, get: cachedImage },
    });
    return c.body(new Uint8Array(pdf), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${document.id}${suffix}${forPrint ? '-tryk' : ''}.pdf"`,
    });
  });
}
