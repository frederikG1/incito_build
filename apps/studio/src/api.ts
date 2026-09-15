import { Brand, CatalogDocument } from '@incitio/schema';

const BASE = '/api';

/**
 * Which chain this session is acting as.
 *
 * Sent on every scoped request as a header. Today it is a picker in the
 * toolbar; when real sign-in arrives, this module is the only place that
 * changes — the rest of the studio already assumes it can only ever see
 * one chain's catalogues, layouts and feed.
 */
export const BRAND_HEADER = 'x-incitio-brand';

function headers(brandId: string, extra: Record<string, string> = {}): HeadersInit {
  return { [BRAND_HEADER]: brandId, ...extra };
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
  throw new Error(body.detail ?? body.error ?? `${response.status} ${response.statusText}`);
}

export interface BrandSummary { id: string; name: string }

export async function fetchBrands(): Promise<BrandSummary[]> {
  const response = await fetch(`${BASE}/brands`);
  if (!response.ok) await fail(response);
  return ((await response.json()) as { brands: BrandSummary[] }).brands;
}

export interface BrandSource {
  id: string;
  name: string;
  format: 'csv' | 'json';
  /** A sample shipped with the repo, or null. */
  path: string | null;
}

export interface BrandProfile {
  brand: Brand;
  /** Every format this chain delivers. The first is the default. */
  sources: BrandSource[];
}

export async function fetchBrandProfile(brandId: string): Promise<BrandProfile> {
  const response = await fetch(`${BASE}/brand/profile`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { brand: unknown; sources: BrandSource[] };
  return { brand: Brand.parse(body.brand), sources: body.sources };
}

export async function fetchCurationStatus(brandId: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/brand/curation/status`, { headers: headers(brandId) });
    if (!response.ok) return false;
    return Boolean(((await response.json()) as { configured?: boolean }).configured);
  } catch {
    return false;
  }
}

export interface DecorStatus {
  /** Whether the server holds a GEMINI_API_KEY — mood artwork needs one. */
  configured: boolean;
  /** The model that will be billed, so the studio can name it on screen. */
  imageModel: string;
}

export async function fetchDecorStatus(brandId: string): Promise<DecorStatus> {
  try {
    const response = await fetch(`${BASE}/brand/decor/status`, { headers: headers(brandId) });
    if (!response.ok) return { configured: false, imageModel: '' };
    const body = (await response.json()) as Partial<DecorStatus>;
    return { configured: Boolean(body.configured), imageModel: body.imageModel ?? '' };
  } catch {
    return { configured: false, imageModel: '' };
  }
}

export interface DecorResult {
  document: CatalogDocument;
  drawn: number;
  skipped: number;
  cached: number;
  errors: { pageId: string; message: string }[];
}

/**
 * Two directions, deliberately not one field.
 *
 * They go to different models and answering "what" with "how" is how a
 * single field misbehaves: "akvarel" in `brief` makes the text model
 * pick watercolour-ish SUBJECTS and still hands the image model the
 * house photography prompt.
 */
export interface DecorDirection {
  /** Steers WHICH motif each page gets. Reaches the text model only. */
  brief?: string;
  /** Added to every image prompt. Reaches the image model only. */
  style?: string;
}

/**
 * Paint mood artwork behind the offers.
 *
 * Returns a whole document, which the editor swaps in as one undoable
 * change — the same shape every other generating call here has.
 */
export async function decorateDocument(
  brandId: string,
  document: CatalogDocument,
  direction: DecorDirection = {},
): Promise<DecorResult> {
  const brief = direction.brief?.trim();
  const style = direction.style?.trim();
  const response = await fetch(`${BASE}/brand/decor`, {
    method: 'POST',
    headers: { ...headers(brandId), 'content-type': 'application/json' },
    body: JSON.stringify({
      document,
      ...(brief ? { brief } : {}),
      ...(style ? { style } : {}),
    }),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as Omit<DecorResult, 'document'> & { document: unknown };
  return { ...body, document: CatalogDocument.parse(body.document) };
}

export interface BuildReply {
  document: CatalogDocument;
  /** Which reader ran, and what it matched on. */
  source: { id: string; name: string; reason: string };
  curated: boolean;
  curationError: string | null;
  offerCount: number;
  dropped: number;
  substitutions: { pageId: string; asked: string; used: string; reason: string }[];
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface BuildRequest {
  feed: string;
  maxPages?: number;
  offerCount?: number;
  brief?: string;
  skipCuration?: boolean;
  seed?: string;
}

/**
 * Build a catalogue server-side.
 *
 * The feed goes up and a finished document comes back. Curation runs on
 * the server so the Anthropic key never reaches the browser — this
 * request carries offers, not credentials.
 */
export async function buildCatalogue(brandId: string, request: BuildRequest): Promise<BuildReply> {
  const response = await fetch(`${BASE}/brand/build`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as BuildReply;
  return { ...body, document: CatalogDocument.parse(body.document) };
}

export interface CatalogSummary {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * This chain's saved catalogues, newest first.
 *
 * The one call that makes a paid run reusable. Everything the model
 * produced is already on disk in SQLite — a rebuilt page cost real money
 * and is an ordinary document afterwards — and without a way to list
 * them the only route back to yesterday's work was to pay for it again.
 */
export async function fetchCatalogues(brandId: string): Promise<CatalogSummary[]> {
  const response = await fetch(`${BASE}/brand/catalogs`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { catalogs: CatalogSummary[] }).catalogs;
}

export async function saveCatalogue(
  brandId: string,
  document: CatalogDocument,
  label = '',
): Promise<void> {
  const query = label ? `?label=${encodeURIComponent(label)}` : '';
  const response = await fetch(
    `${BASE}/brand/catalogs/${encodeURIComponent(document.id)}${query}`,
    {
      method: 'PUT',
      headers: headers(brandId, { 'content-type': 'application/json' }),
      body: JSON.stringify(document),
    },
  );
  if (!response.ok) await fail(response);
}

export async function fetchCatalogue(
  brandId: string,
  id: string,
): Promise<CatalogDocument | null> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}`, {
    headers: headers(brandId),
  });
  if (response.status === 404) return null;
  if (!response.ok) await fail(response);
  const body = (await response.json()) as { document: unknown };
  const parsed = CatalogDocument.safeParse(body.document);
  // A stored document that no longer matches the schema is treated as
  // absent rather than crashing the editor; the caller rebuilds.
  return parsed.success ? parsed.data : null;
}

/**
 * The PDF, fetched as a blob rather than linked.
 *
 * A plain `<a href>` would drop the brand header, and the endpoint would
 * reject it — the same isolation that protects the data also means every
 * request has to be made by code that knows who it is.
 */
export async function fetchCataloguePdf(brandId: string, id: string): Promise<Blob> {
  const response = await fetch(`${BASE}/brand/catalogs/${encodeURIComponent(id)}/pdf`, {
    headers: headers(brandId),
  });
  if (!response.ok) await fail(response);
  return response.blob();
}

/** This chain's own feed, from the static root. */
export async function fetchFeed(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`kunne ikke hente feedet (${response.status})`);
  return response.text();
}

/* --------------------------------------------------- genskab en side */

export interface ReproduceRequest {
  /** The reference page, base64 — an image, or a PDF to take a page of. */
  file: string;
  /** Which page of a PDF. Ignored for an image. */
  pageNumber?: number;
  /** This week's feed, as the chain publishes it. */
  feed: string;
  note?: string;
  referenceName?: string;
  /**
   * Offers the earlier pages of this run already printed.
   *
   * A run of several references is one request per page, so that the
   * studio can show which page it is on and keep the pages that already
   * came back. Nothing on the server remembers the run — this list is
   * how page four knows what page one took.
   */
  exclude?: string[];
}

export interface ReproduceReply {
  document: CatalogDocument;
  /**
   * The chain carrying the one layout this page needs.
   *
   * A page rebuilt from a reference sits on a grid nobody drew for the
   * chain, so it is not in the brand the profile endpoint returned. The
   * editor renders with this one instead; the layout also travels inside
   * `document.templates`, which is what makes it survive a save and a
   * print.
   */
  brand: Brand;
  template: { id: string; name: string; areas: string[] };
  /** The field, measured in the reference's margins. Not guessed. */
  ground: string;
  /** What went where, and why. Shown beside the rebuilt page. */
  casting: { slotId: string; offerId: string; role: string; why: string }[];
  source: { id: string; name: string; reason: string };
  /** What the model was shown, as a data URL, for comparing side by side. */
  reference: string;
  offersInFeed: number;
  poolSize: number;
  rejected: number;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

/**
 * Rebuild a published page with this week's products.
 *
 * Everything runs server-side: the key stays there, and rasterising a
 * page of a PDF needs a Chromium the browser cannot launch. This request
 * carries a picture and a feed, and nothing else.
 */
export async function reproducePage(
  brandId: string,
  request: ReproduceRequest,
): Promise<ReproduceReply> {
  const response = await fetch(`${BASE}/brand/reproduce`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as ReproduceReply;
  return {
    ...body,
    document: CatalogDocument.parse(body.document),
    brand: Brand.parse(body.brand),
  };
}

/* ------------------------------------------------- kædens egne billeder */

/**
 * Put one of the chain's own photographs on the server.
 *
 * Returns the URL it now lives at, which is what goes into a page's
 * `decorations`. A document references artwork and never carries it —
 * see `PageDecoration.imageUrl` — so this is the only step that moves
 * bytes, and it happens once per picture however many pages use it.
 *
 * The file is stored exactly as it was handed in. The server used to
 * flood-fill the background out first; it does not any more, because a
 * chain that prints a leaflet already keeps cut-out artwork and the
 * fill was as likely to eat a photograph's sky as to help.
 */
export interface UploadedImage {
  url: string;
}

export async function uploadImage(
  brandId: string,
  base64: string,
  name?: string,
): Promise<UploadedImage> {
  const response = await fetch(`${BASE}/brand/uploads`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ file: base64, ...(name ? { name } : {}) }),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as UploadedImage;
}
