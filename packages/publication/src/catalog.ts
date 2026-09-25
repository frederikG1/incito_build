/**
 * A published catalogue on Tjek, read through Tjek's own public API.
 *
 * A picture-only avis that has gone live on Tjek (etilbudsavis.dk and
 * the apps) carries everything a published incito carries, just stored
 * beside the pictures instead of in a tree: every offer's name, fine
 * print and price, which page it is on, and its box on that page — the
 * same box the apps make tappable. So a live Netto or REMA avis comes in
 * with every product in its cell, exactly as a SuperBrugsen incito does,
 * with no model and no guessing.
 *
 * Only public endpoints, the same ones the apps call without a key.
 */
import { PublicationError } from './fetch.js';
import type { PagedImage, PagedProduct } from './paged.js';

const API = 'https://squid-api.tjek.com/v2';

/** A catalogue's pages, and the products standing on each, with their boxes. */
export interface CatalogSource {
  id: string;
  title: string;
  pages: PagedImage[];
  /** Page number → products, boxes as shares of the page (x1r…y2r). */
  products: Map<number, { product: PagedProduct; box: { x0: number; y0: number; x1: number; y1: number } }[]>;
}

/** Ids a link might name a catalogue by: eight characters of Tjek's alphabet. */
export function catalogIds(raw: string): string[] {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return []; }
  const ids = url.pathname.split('/').filter((part) => /^[A-Za-z0-9_-]{8}$/.test(part));
  const query = url.searchParams.get('catalog_id') ?? url.searchParams.get('id');
  return [...new Set([...ids, ...(query ? [query] : [])])];
}

/** The crop an offer's picture is cut with — its box on the page. */
export function cropOf(imageUrl: string | undefined): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl);
    const read = (key: string) => Number(url.searchParams.get(key));
    const box = { x0: read('x1r'), y0: read('y1r'), x1: read('x2r'), y1: read('y2r') };
    if (![box.x0, box.y0, box.x1, box.y1].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
    if (box.x1 <= box.x0 || box.y1 <= box.y0) return null;
    return box;
  } catch {
    return null;
  }
}

async function json(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new PublicationError(`Tjek svarede ${response.status} på ${path}`);
  return response.json();
}

interface TjekOffer {
  id: string;
  heading?: string;
  description?: string;
  catalog_page?: number;
  pricing?: { price?: number | null };
  images?: { thumb?: string; view?: string; zoom?: string };
}

/** The catalogue a link names, or null when it names none Tjek knows. */
export async function fetchCatalog(raw: string): Promise<CatalogSource | null> {
  for (const id of catalogIds(raw)) {
    let meta: { id?: string; label?: string; branding?: { name?: string } };
    try {
      meta = await json(`/catalogs/${id}`) as typeof meta;
    } catch {
      continue;
    }
    if (!meta?.id) continue;
    const pages = (await json(`/catalogs/${id}/pages`) as { zoom?: string; view?: string }[])
      .map((page, index) => ({ number: index + 1, src: page.zoom ?? page.view ?? '', width: 1400, height: 1974 }))
      .filter((page) => page.src);
    const products = new Map<number, { product: PagedProduct; box: { x0: number; y0: number; x1: number; y1: number } }[]>();
    for (let offset = 0; offset < 2000; offset += 100) {
      const batch = await json(`/offers?catalog_id=${id}&limit=100&offset=${offset}`) as TjekOffer[];
      for (const offer of batch) {
        const box = cropOf(offer.images?.zoom ?? offer.images?.view);
        const page = Number(offer.catalog_page);
        if (!box || !Number.isFinite(page) || page < 1) continue;
        const list = products.get(page) ?? [];
        list.push({
          box,
          product: {
            id: offer.id,
            name: (offer.heading ?? '').trim(),
            description: (offer.description ?? '').replace(/\s+/g, ' ').trim(),
            pack: '',
            price: typeof offer.pricing?.price === 'number' ? offer.pricing.price : null,
            imageUrl: offer.images?.zoom ?? offer.images?.view ?? null,
          },
        });
        products.set(page, list);
      }
      if (batch.length < 100) break;
    }
    return { id, title: meta.branding?.name ?? meta.label ?? '', pages, products };
  }
  return null;
}
