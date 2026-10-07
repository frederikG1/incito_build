/**
 * Tjek CMS publications into Incitio.
 *
 *   types      the CMS's own API answers, read leniently
 *   sections   a section → its offer boxes, capacity, main and overflow pages
 *   editions   several publications that are one avis → base + per-edition deltas
 *   catalog    all of it → one CatalogDocument with its editions as variants
 *
 * Pure: no network, no model. The answers come from the CMS editor's own
 * requests; see `scripts/cms-report.ts` for a run over a captured week.
 */
export * from './types.js';
export * from './sections.js';
export * from './editions.js';
export * from './catalog.js';
export * from './section-templates.js';
