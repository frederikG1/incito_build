/**
 * Rebuild a published leaflet from its own link.
 *
 * Three steps, and none of them calls a model:
 *   1. the link gives up the incito document      (fetch)
 *   2. the document gives up pages and offers     (incito)
 *   3. the pages give up their grids              (document)
 *
 * That is the whole difference from `@incitio/match`, which is handed a
 * PICTURE of a page and has to ask a model what is on it. Here the page
 * states what is on it, so the import is free, exact and repeatable —
 * and what comes out the other end is the same `CatalogDocument`, so
 * everything downstream is unchanged.
 */
export * from './incito.js';
export * from './fetch.js';
export * from './document.js';
export * from './paged.js';
export * from './cells.js';
export * from './catalog.js';

import { fetchIncito, fetchPageImage, fetchSource, PublicationError } from './fetch.js';
import { pagedPublication, type PagedCell, type PagedSource } from './paged.js';
import { fetchCatalog, type CatalogSource } from './catalog.js';
import { readIncito, type Publication } from './incito.js';
import { publicationDocument, type ImportOptions, type PublicationImport } from './document.js';

/** The publication behind a link, read but not yet turned into a document. */
export async function fetchPublication(url: string): Promise<Publication> {
  return readIncito(await fetchIncito(url));
}

/**
 * A link in, a catalogue out.
 *
 * The one call the server route and the CLI both make, so the studio and
 * the terminal cannot drift into two different notions of what importing
 * a publication means — the same bargain `matchPage` makes.
 */
export async function importPublication(
  url: string,
  options: ImportOptions & PagedOptions,
): Promise<PublicationImport & { publication: Publication; paged: { title: string; known: number } | null }> {
  /*
   * A live catalogue on Tjek first, unless the link is plainly a viewer
   * page: a catalogue says which product stands where, so nothing on it
   * has to be found.
   */
  const viewer = /publication-viewer\./.test(url);
  const catalog = viewer ? null : await fetchCatalog(url).catch(() => null);
  if (catalog) {
    const publication = await pagedImport({ title: catalog.title, pages: catalog.pages }, options, catalog.products);
    const known = [...catalog.products.values()].reduce((sum, list) => sum + list.length, 0);
    return { ...publicationDocument(publication, options), publication, paged: { title: catalog.title, known } };
  }
  const source = await fetchSource(url);
  if (source.kind === 'incito') {
    const publication = readIncito(source.data);
    return { ...publicationDocument(publication, options), publication, paged: null };
  }
  const publication = await pagedImport(source.paged, options);
  return { ...publicationDocument(publication, options), publication, paged: { title: source.paged.title, known: 0 } };
}

export interface PagedOptions {
  /**
   * Where a page picture is kept, returning the reference to print it
   * from. The viewer's own links are signed for one size and may not
   * outlive the week; our copy does. Without a store the viewer's link
   * is used as it is.
   */
  store?: (bytes: Buffer, extension: string) => string;
  /**
   * The cells on a page picture and its paper, read off its pixels —
   * `findPageCells`, run where the picture can be decoded (the server
   * has a browser for it). Without it a page comes in as a picture
   * with no cells, and cells are drawn by hand.
   */
  analyse?: (bytes: Buffer) => Promise<{ cells: PagedCell[]; paper?: string }>;
}

const extensionOf = (bytes: Buffer) => (bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg'
  : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png'
    : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : 'jpg');
/** The picture's own pixels, read from its header — the viewer's width and height are rounded. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue; }
      const marker = bytes[at + 1]!;
      const length = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = bytes.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** Every page picture fetched (and kept) and its cells found, four at a time. */
async function pagedImport(
  source: PagedSource,
  options: ImportOptions & PagedOptions,
  products?: CatalogSource['products'],
): Promise<Publication> {
  const wanted = options.pages?.length
    ? source.pages.filter((page) => options.pages!.includes(page.number))
    : source.pages;
  if (wanted.length === 0) throw new PublicationError('ingen af de valgte sider findes i udgivelsen');
  const pages: { number: number; image: string; width: number; height: number; cells: PagedCell[]; paper?: string }[] = new Array(wanted.length);
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const index = next++;
      const page = wanted[index]!;
      const bytes = await fetchPageImage(page.src);
      const size = imageSize(bytes) ?? { width: page.width, height: page.height };
      const image = options.store ? options.store(bytes, extensionOf(bytes)) : page.src;
      const read = await options.analyse?.(bytes).catch(() => null) ?? null;
      /*
       * The catalogue's own boxes when it has them — they are the
       * publisher's — and the paper under each read off the pixels.
       */
      const known = products?.get(page.number) ?? [];
      const cells: PagedCell[] = known.length > 0
        ? known.map(({ product, box }) => {
          const px = { x0: box.x0 * size.width, y0: box.y0 * size.height, x1: box.x1 * size.width, y1: box.y1 * size.height };
          const found = read?.cells.find((cell) => overlap(cell.box, px) > 0.5);
          return { box: px, product, ...(found?.paper ? { paper: found.paper } : read?.paper ? { paper: read.paper } : {}) };
        })
        : read?.cells ?? [];
      pages[index] = { number: page.number, image, ...size, cells, ...(read?.paper ? { paper: read.paper } : {}) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return pagedPublication(options.catalogId, pages);
}

/** How much of the smaller box the two share. */
function overlap(a: PagedCell['box'], b: PagedCell['box']): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return smaller > 0 ? (w * h) / smaller : 0;
}
