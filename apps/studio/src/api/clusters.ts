/** Several products in one tile: arrange, compose, split, backdrops. */
import { Offer } from '@incitio/schema';
import { BASE, headers, fail } from './http.js';

/** The background picture for one page — see `backdropPrompt`. */
export async function drawBackdrop(
  brandId: string,
  brief: {
    aspect: string; colour: string;
    regions: { x0: number; x1: number; y0: number; y1: number }[];
    text: string[]; offer: string; products: string[]; style?: string;
    ratio?: number;
    spots?: { x0: number; x1: number; y0: number; y1: number }[];
    /** One motif alone, for a place the studio chose. */
    isolated?: boolean;
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
