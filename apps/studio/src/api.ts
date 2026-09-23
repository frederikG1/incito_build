import { Brand, CatalogDocument, CatalogWeek, Offer } from '@incitio/schema';

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

/**
 * Where the editor's own key for the image model is carried.
 *
 * The alternative is `GEMINI_API_KEY` in the server's `.env`, and it
 * stays the default. This is for the ordinary case where the person
 * with the key is not the person who started the server: they paste it
 * into the studio, it lives in THEIR browser, and it rides along on
 * the requests that draw. It is never written to the repo, never sent
 * anywhere but this project's own API, and the server uses it for the
 * one call and forgets it.
 */
export const KEY_HEADER = 'x-gemini-key';

/** Survives a reload, and only in this browser. */
const KEY_STORE = 'incitio.geminiKey';

let imageKey = read();

function read(): string {
  try {
    return window.localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    // Private browsing. The key still works for this session.
    return '';
  }
}

/** Whether a key is in hand. Never the key itself — nothing needs it. */
export function hasImageKey(): boolean {
  return imageKey.trim().length > 0;
}

/** The last four characters, for showing that the right one is in. */
export function imageKeyTail(): string {
  const value = imageKey.trim();
  return value.length > 4 ? value.slice(-4) : '';
}

/** Keep it, or forget it when given an empty string. */
export function setImageKey(value: string): void {
  imageKey = value.trim();
  try {
    if (imageKey) window.localStorage.setItem(KEY_STORE, imageKey);
    else window.localStorage.removeItem(KEY_STORE);
  } catch { /* private browsing; it holds for this session */ }
}

function headers(brandId: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    [BRAND_HEADER]: brandId,
    // Only when there is one: an empty header would override nothing
    // and confuse a proxy.
    ...(imageKey ? { [KEY_HEADER]: imageKey } : {}),
    ...extra,
  };
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    issues?: { path?: (string | number)[]; message?: string }[];
  };
  /*
   * A rejected body says WHICH field was wrong.
   *
   * "invalid request" on its own cost an afternoon: a route capped its
   * product list at eight, the studio started sending a whole page's
   * worth, and the only thing on screen was the file name and those
   * two words. The server already sends `issues`; not showing them was
   * the whole of the mystery.
   */
  const issue = body.issues?.[0];
  const said = body.detail ?? body.error ?? `${response.status} ${response.statusText}`;
  throw new Error(issue?.message
    ? `${said} (${[...(issue.path ?? [])].join('.') || 'body'}: ${issue.message})`
    : said);
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
  /** Whether this is the sample the editor should open with. */
  sample: boolean;
}

export interface BrandProfile {
  brand: Brand;
  /** A publication link to test with, from the server's own `.env`. */
  testPublication?: string;
  /** Every format this chain delivers. The first is the default. */
  sources: BrandSource[];
}

export async function fetchBrandProfile(brandId: string): Promise<BrandProfile> {
  const response = await fetch(`${BASE}/brand/profile`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as {
    brand: unknown;
    sources: BrandSource[];
    testPublication?: string;
  };
  return {
    brand: Brand.parse(body.brand),
    sources: body.sources,
    // The machine's own test avis, when its `.env` names one.
    ...(body.testPublication ? { testPublication: body.testPublication } : {}),
  };
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
  publication: { id: string; pages: number };
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

/** The background picture for one page — see `backdropPrompt`. */
export async function drawBackdrop(
  brandId: string,
  brief: {
    aspect: string; colour: string;
    regions: { x0: number; x1: number; y0: number; y1: number }[];
    text: string[]; offer: string; products: string[]; style?: string;
    ratio?: number;
    spots?: { x0: number; x1: number; y0: number; y1: number }[];
  },
): Promise<{ motifs: DrawnMotif[]; prompt: string }> {
  const response = await fetch(`${BASE}/brand/backdrop`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(brief),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as { motifs: DrawnMotif[]; prompt: string };
}

/** One cut-out motif and the free spot it was drawn for, in page percent. */
export interface DrawnMotif {
  url: string;
  spot: { x0: number; x1: number; y0: number; y1: number };
  width: number;
  height: number;
}

/** One packshot of several variants, cut into one picture per variant. */
export async function splitVariants(
  brandId: string,
  imageUrl: string,
): Promise<{ products: { name: string; ref: string }[] }> {
  const response = await fetch(`${BASE}/brand/split`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as { products: { name: string; ref: string }[] };
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

/* -------------------------------------------- hvordan varerne står sammen */

export interface ArrangeReply {
  /** The products left to right as printed — a permutation of what went in. */
  order: string[];
  arrangement: 'row' | 'stagger' | 'grid' | 'fan';
  /** What the page calls the assembled offer. Empty when nobody wrote one. */
  heading: string;
  /** The fine print under it. Empty when nobody wrote one. */
  support: string;
  /** The model's own reason. Shown in the editor, never printed. */
  why: string;
  /** Which model answered, or null when the stylesheet's own rule did. */
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Ask how a handful of products should sit in one cell.
 *
 * The model is shown the packshots, because the answer is a fact about
 * what the products look like — six upright bottles fan and six flat
 * trays do not — and nothing in the feed says so. What comes back is an
 * ordering, one of four arrangement names and two lines of Danish.
 *
 * Never throws for want of a model: the server answers with the
 * stylesheet's own choice and `model: null` when there is no key or the
 * call fails, so a drop always lands.
 */
export async function arrangeGroup(
  brandId: string,
  request: {
    offers: Offer[];
    cell: { role: string; aspect: number; width: number };
    note?: string;
  },
): Promise<ArrangeReply> {
  const response = await fetch(`${BASE}/brand/arrange`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as ArrangeReply;
}

/* ------------------------------------- varerne som ét fotografi */

export interface ClusterReply {
  /** Where the composed photograph now lives, root-relative. */
  url: string;
  bytes: number;
  /** Exactly what the image model was asked for. */
  prompt: string;
  model: string;
  /**
   * The cutouts re-served from the server, when `copies` was asked
   * for — the same list `/prepare` returns, and the reason standing a
   * cluster up is now one request instead of two.
   */
  files?: { index: number; name: string; url: string; bytes: number }[];
}

/**
 * Compose several products into ONE leaflet photograph.
 *
 * The other way to fill a cell. `fillSlot` on its own lays the cutouts
 * side by side and every one of them stays movable; this asks the image
 * model for a photograph of them standing together — shared floor, one
 * hero in front, the rest overlapping — which is what a printed page
 * has and what no stylesheet produces. What it costs is that the
 * products in the result can no longer be moved one by one.
 *
 * Throws rather than falling back: the editor already had a working
 * tile and pressed this on purpose.
 */
export async function composeCluster(
  brandId: string,
  request: {
    offers: Offer[]; aspect?: number; note?: string; copies?: boolean; model?: string;
  },
): Promise<ClusterReply> {
  const response = await fetch(`${BASE}/brand/cluster`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as ClusterReply;
}

export interface PrepareReply {
  /** The prompt exactly as the server would have sent it. */
  prompt: string;
  /** The cutouts, numbered in the order the prompt names them. */
  files: { index: number; name: string; url: string; bytes: number }[];
}

/**
 * Everything needed to run the composition by hand.
 *
 * The image model is billing-gated on Google's side, and waiting for a
 * billing account is not a reason to be unable to see whether the
 * prompt works. This returns the prompt and the cutouts as files —
 * numbered in the prompt's own order, re-served from this server so
 * they can be saved with those names.
 */
export async function prepareCluster(
  brandId: string,
  request: { offers: Offer[]; aspect?: number; note?: string },
): Promise<PrepareReply> {
  const response = await fetch(`${BASE}/brand/cluster/prepare`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as PrepareReply;
}

export interface LayoutReading {
  products: {
    index: number;
    cx: number;
    cy: number;
    width: number;
    /** The product's lowest edge, 0–1 down the picture — see `PlacedProduct`. */
    bottom: number;
    rotate: number;
    /** A step forward or back among the products — the placing call only. */
    depth?: number;
  }[];
  /** Products the model could not find. Left where they were. */
  missing: number[];
  /** Whether the group stands on a floor or lies flat — the placing call only. */
  view?: 'side' | 'top';
  /** The model that was asked for, when a busy queue handed it on. */
  insteadOf?: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Measure a composed picture, so the same composition can be rebuilt
 * from the ORIGINAL cutouts.
 *
 * The picture is never printed. An image model redraws pixels, and what
 * it redraws worst is small type — a brand name, a percentage, the
 * print on a lid. So its geometry is taken and its pixels are thrown
 * away, and the chain's own artwork ends up standing where the
 * composition put it.
 */
/**
 * The arrangement as numbers, with no picture drawn.
 *
 * The other way to the same answer — see `composeCluster`, which pays
 * an image model to photograph the products and a second model to
 * measure the photograph. This asks one vision model to look at the
 * cutouts and say where each should stand: one call, no image model,
 * no billing account behind it.
 */
export async function placeCluster(
  brandId: string,
  request: {
    offers: Offer[];
    aspect?: number;
    /** The cell in pixels, as the page draws it — see the route. */
    canvas?: { width: number; height: number };
    /** Each cutout's own proportions, in the offers' order. */
    aspects?: number[];
    offerName?: string;
    note?: string;
    model?: string;
    /** Refuse an answer from any other model — no reserve queue. */
    strict?: boolean;
    /** The editor's own version of the standing prompt. */
    system?: string;
  },
): Promise<LayoutReading & { elapsedMs: number }> {
  const response = await fetch(`${BASE}/brand/cluster/place`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as LayoutReading & { elapsedMs: number };
}

export async function readClusterLayout(
  brandId: string,
  request: { file: string; offers: Offer[] },
): Promise<LayoutReading> {
  const response = await fetch(`${BASE}/brand/cluster/layout`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as LayoutReading;
}
