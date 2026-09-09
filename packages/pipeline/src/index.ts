import type { CatalogDocument, ImageProfile, TemplateLibrary } from '@incitio/schema';
import { ingestCsv, ingestJson, type IngestIssue, type LabelDictionary } from '@incitio/ingest';
import { generateCatalog, type PageGroup, type SelectionOptions, type SelectionReject } from '@incitio/layout';
import type { RetailerConfig } from './retailers.js';

export * from './retailers.js';
export * from './detect.js';

export interface BuildOptions {
  catalogId?: string;
  name?: string;
  library?: TemplateLibrary;
  profiles?: Map<string, ImageProfile>;
  /** Supplied by the M4 Claude planner; falls back to category pagination. */
  groups?: PageGroup[];
  /** Editorial selection. Omit to publish every offer in the feed. */
  selection?: SelectionOptions;
  /** Certification marks. Omit and labels stay plain text. */
  labels?: LabelDictionary;
}

export interface BuildResult {
  document: CatalogDocument;
  issues: IngestIssue[];
  unplaced: string[];
  offerCount: number;
  notSelected: SelectionReject[];
  categoryMix: Record<string, number>;
}

/**
 * Feed text in, finished catalog out. The one entry point the app, the
 * tests and any future CLI all share, so none of them can drift into a
 * slightly different notion of what "generate a catalog" means.
 */
export function buildCatalog(
  source: string,
  format: 'csv' | 'json',
  retailer: RetailerConfig,
  options: BuildOptions = {},
): BuildResult {
  const { feed, issues } =
    format === 'csv'
      ? ingestCsv(source, retailer.mapping, options.labels)
      : ingestJson(source, retailer.mapping, options.labels);

  const { document, unplaced, notSelected, categoryMix } = generateCatalog(feed.offers, {
    id: options.catalogId ?? `${retailer.id}-1`,
    name: options.name ?? retailer.displayName,
    retailerId: retailer.id,
    theme: retailer.theme,
    pageAspect: retailer.pageAspect,
    ...(options.library ? { library: options.library } : {}),
    ...(options.profiles ? { profiles: options.profiles } : {}),
    ...(options.groups ? { groups: options.groups } : {}),
    ...(options.selection ? { selection: options.selection } : {}),
  });

  return { document, issues, unplaced, notSelected, categoryMix, offerCount: feed.offers.length };
}
