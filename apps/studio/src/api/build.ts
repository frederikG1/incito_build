/** Building a week: the build itself, its decoration, uploads and the feed. */
import type { FeedHealth } from '@incitio/brands';
import { CatalogDocument, CatalogWeek, Offer } from '@incitio/schema';
import { BASE, headers, fail } from './http.js';

export interface DecorResult {
  document: CatalogDocument;
  drawn: number;
  skipped: number;
  cached: number;
  errors: { pageId: string; message: string }[];
  subjects?: { pageId: string; subject: string }[];
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
  /** Only these pages; omitted means every page. */
  pageIds?: string[];
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
      ...(direction.pageIds ? { pageIds: direction.pageIds } : {}),
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
  /** Offers the feed carried that do not run in the chosen week. */
  outsideWeek: number;
  /** How many DO run in it. Zero means the feed is another week's. */
  inWeek: number | null;
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
  /** Offers already in the avis; the build leaves them out. */
  exclude?: string[];
  /** The week the paper is for. Cuts the feed and names the document. */
  week?: CatalogWeek;
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
/** One picture in the chain's own library. */
export interface LibraryImage {
  ref: string;
  name: string;
  createdAt: string;
}

/** This chain's uploaded pictures, newest first. */
export async function fetchUploads(brandId: string): Promise<LibraryImage[]> {
  const response = await fetch(`${BASE}/brand/uploads`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { uploads: LibraryImage[] }).uploads;
}

/** Take one out of the library. The file stays; the offer of it goes. */
export async function forgetUpload(brandId: string, ref: string): Promise<void> {
  const response = await fetch(
    `${BASE}/brand/uploads?ref=${encodeURIComponent(ref)}`,
    { method: 'DELETE', headers: headers(brandId) },
  );
  if (!response.ok) await fail(response);
}

export interface UploadedImage {
  url: string;
  /**
   * How the flood fill went, when one was asked for.
   *
   * `kept` is the share of the picture that survived. Near 1 means
   * nothing was cut — which is exactly what an image drawn on a room
   * instead of a white field looks like, and the difference between
   * "the background is gone" and "there was nothing this could remove"
   * is invisible from outside.
   */
  cut?: { kept: number; threshold: number };
}

export async function uploadImage(
  brandId: string,
  base64: string,
  name?: string,
  /** Knock the white field out first. Only for a picture drawn to be cut. */
  cut = false,
): Promise<UploadedImage> {
  const response = await fetch(`${BASE}/brand/uploads`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ file: base64, ...(name ? { name } : {}), ...(cut ? { cut } : {}) }),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as UploadedImage;
}

/* ------------------------------------------------------ hvad er i feedet */

export interface FeedReading {
  source: { id: string; name: string; reason: string };
  offers: Offer[];
  /** How many of them could stand in for a product in print. */
  withImage: number;
  /** The file judged as Feedtjek judges it — see `feedHealth`. */
  health?: FeedHealth;
}

/**
 * Read an uploaded feed without building anything from it.
 *
 * Free, instant and modelless: the server runs the chain's own reader
 * and hands back the products. Until this existed an upload was a
 * string the studio held on to, and the first time anyone learned
 * whether it had parsed was after a rebuild had been paid for.
 */
export async function readFeed(
  brandId: string,
  feed: string,
  filename?: string,
): Promise<FeedReading> {
  const response = await fetch(`${BASE}/brand/feed`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ feed, ...(filename ? { filename } : {}) }),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as FeedReading;
  return { ...body, offers: body.offers.map((offer) => Offer.parse(offer)) };
}
