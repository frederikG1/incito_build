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

import { fetchIncito } from './fetch.js';
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
  options: ImportOptions,
): Promise<PublicationImport & { publication: Publication }> {
  const publication = await fetchPublication(url);
  return { ...publicationDocument(publication, options), publication };
}
