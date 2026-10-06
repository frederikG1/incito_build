import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { CatalogWeek, Offer, type Brand } from '@incitio/schema';
import { findVariant, resolveVariant } from '@incitio/edit';
import { EMPTY_LABEL_DICTIONARY } from '@incitio/ingest';
import { mediaType } from '@incitio/match';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { uploadStore } from './uploads.js';
import { readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fetchImages } from '@incitio/decor';
import { Store } from './db.js';
import { standInPrices } from '@incitio/workflow';
import { makeCommit } from './workflow.js';
import { LoginThrottle } from './auth.js';
import { assertProductionReady } from './production.js';
import { BRAND_HEADER, KEY_HEADER, type Scope, type AppOptions } from './http.js';
import { accessRoutes } from './routes/access.js';
import { chainRoutes } from './routes/chain.js';
import { catalogsRoutes } from './routes/catalogs.js';
import { buildRoutes } from './routes/build.js';
import { clustersRoutes } from './routes/clusters.js';
import { referencesRoutes } from './routes/references.js';
import { pdfRoutes } from './routes/pdf.js';

export { Store } from './db.js';
export { Accounts, ACCOUNT_ROLES, maySign, rolesOf, type AuthMode, type User } from './auth.js';
export { assertProductionReady, isProduction, ProductionRefused, productionRefusals } from './production.js';
export { migrate, SCHEMA_VERSION } from './migrations.js';
export { readDefaultDesigns } from './defaults.js';
export { BRAND_HEADER, KEY_HEADER, chainBrand } from './http.js';
export type { AppOptions } from './http.js';


export function createApp(store: Store, options: AppOptions = {}) {
  const app = new Hono<Scope>();
  const ctx = routeContext(store, options);
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization', BRAND_HEADER, KEY_HEADER] }));
  accessRoutes(app, ctx);
  chainRoutes(app, ctx);
  catalogsRoutes(app, ctx);
  buildRoutes(app, ctx);
  clustersRoutes(app, ctx);
  referencesRoutes(app, ctx);
  pdfRoutes(app, ctx);
  return app;
}

/** What every route group shares: the store, the options, and what `createApp` made of them. */
function routeContext(store: Store, options: AppOptions) {
  const labels = options.labels ?? EMPTY_LABEL_DICTIONARY;
  const prices = options.prices ?? standInPrices;
  const auth = options.auth ?? 'off';
  if (options.production) assertProductionReady({ prices, auth });
  const commit = makeCommit(store, prices);
  const throttle = new LoginThrottle();
  /*
   * A store per chain, made where the chain is known.
   *
   * It used to be one store built at boot, which is what made the
   * upload tree flat — see `uploadStore`. The brand is only resolved
   * inside a request, so the store has to be too.
   */
  /*
   * Pictures for the models, wherever they live. A product off the feed
   * is a URL; a cutout the studio made (`/uploads/…`, `/decor/…`) is a
   * file under the asset root, and fetching it over HTTP would ask the
   * dev server for a file this process can simply read.
   */
  const imagesFor = async (urls: (string | null)[]) => Promise.all(urls.map(async (url) => {
    if (url && url.startsWith('/') && options.assetDir) {
      const root = normalize(options.assetDir);
      const file = normalize(join(root, url.split('?')[0]!));
      if (!file.startsWith(root + sep)) return null;
      try {
        const bytes = readFileSync(file);
        return { bytes, mimeType: mediaType(bytes) };
      } catch {
        return null;
      }
    }
    return (await fetchImages([url]))[0] ?? null;
  }));

  const uploadsFor = (brandId: string) =>
    (options.assetDir ? uploadStore(options.assetDir, brandId) : null);



  /*
   * Editing without the studio.
   *
   * An agent, a script or another service edits a stored catalogue the
   * way the studio does: by sending `EditOp`s. `/outline` is what to
   * read first — every slot, the offer in it and the ids the ops take —
   * and `/ops` applies a list all or nothing and saves it as a version,
   * so an agent's edit can be diffed and rolled back like anyone's.
   */
  /** The stored catalogue, or one of its editions when `?variant=` names one. */
  const edition = (brand: Brand, id: string, variantId: string | undefined) => {
    const document = store.get(brand.id, id);
    if (!document) return { error: 'not found' as const };
    if (!variantId) return { document, conflicts: [] as string[] };
    if (!findVariant(document, variantId)) return { error: `no variant "${variantId}"` as const };
    const resolved = resolveVariant(document, variantId, brand);
    return { document: resolved.document, conflicts: resolved.conflicts };
  };

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
    /** Offers already in the avis — see `BuildOptions.exclude`. */
    exclude: z.array(z.string().max(200)).max(5000).optional(),
    /** The week the paper is for — see `BuildOptions.week`. */
    week: CatalogWeek.optional(),
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

  const PublicationRequest = z.object({
    url: z.string().min(1).max(4000),
    /** Which pages to take, 1-based. All of them when absent. */
    pages: z.array(z.number().int().positive().max(400)).max(400).optional(),
    /** The grid without the products on it. They still travel, on the bench. */
    withOffers: z.boolean().optional(),
    name: z.string().max(200).optional(),
  });

  const browserForPaged = () => {
    pagedBrowser ??= chromium.launch().catch((error) => { pagedBrowser = null; throw error; });
    return pagedBrowser;
  };

  // One browser for reading page pictures, started the first time one comes in.
  let pagedBrowser: Promise<Browser> | null = null;
  return { store, options, labels, prices, auth, commit, throttle, imagesFor, uploadsFor, edition, BuildRequest, ArrangeRequest, PublicationRequest, browserForPaged };
}

export type RouteContext = ReturnType<typeof routeContext>;
