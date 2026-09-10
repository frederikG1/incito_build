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
