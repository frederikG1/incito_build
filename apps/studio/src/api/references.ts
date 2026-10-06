/** Reference pages and publications: reproduce, import, layout. */
import { Brand, CatalogDocument } from '@incitio/schema';
import { BASE, headers, fail } from './http.js';

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
  /**
   * Where the page's grid came from.
   *
   * `pdf` means it was measured out of the file itself and handed to
   * the model; `model` means the model counted the columns off the
   * picture. The first is a fact and the second is a reading, and the
   * strip beside the rebuilt page says which one this was.
   */
  grid: { source: 'pdf' | 'model'; columns: number; rows: number; fit: number | null };
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

/* ------------------------------------------------ hent en udgivet avis */

export interface PageReading {
  number: number;
  offers: number;
  columns: number;
  rows: number;
  fit: number;
  skipped: string | null;
}

export interface PublicationReply {
  document: CatalogDocument;
  readings: PageReading[];
  publication: { id: string; pages: number; paged?: boolean; title?: string | null; known?: number };
}

/**
 * Rebuild a published leaflet from its own link.
 *
 * No model, no cost, and the same answer every time: a published page
 * states its own grid, so this reads it rather than asking anyone. The
 * fetch happens on the server — a publication is served from another
 * origin, and the browser may not read it.
 */
export async function importPublication(
  brandId: string,
  request: { url: string; pages?: number[]; withOffers?: boolean; name?: string },
): Promise<PublicationReply> {
  const response = await fetch(`${BASE}/brand/publication`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as PublicationReply;
  return { ...body, document: CatalogDocument.parse(body.document) };
}

/* ------------------------------------------------- et tegnet layout */

export interface LayoutRequest {
  feed: string;
  /** How many product cells to ask the image model for. */
  cells?: number;
  /** The editor's own words for the image model. */
  note?: string;
  /** A steer for the casting step — "kød skal føre siden". */
  brief?: string;
  exclude?: string[];
}

export interface LayoutReply extends ReproduceReply {
  /** Exactly what the image model was asked for. */
  prompt: string;
  imageModel: string;
  drawnInMs: number;
}

/**
 * A page whose layout was drawn rather than handed in.
 *
 * Two models: one draws the shape of the page, the other reads that
 * drawing and decides which product sits in which cell. The drawing is
 * returned for the side-by-side and is never put on the sheet — what
 * prints is the chain's own tiles in the cells the drawing turned out
 * to have.
 */
export async function generateLayout(
  brandId: string,
  request: LayoutRequest,
): Promise<LayoutReply> {
  const response = await fetch(`${BASE}/brand/layout`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as LayoutReply;
  return {
    ...body,
    document: CatalogDocument.parse(body.document),
    brand: Brand.parse(body.brand),
  };
}
