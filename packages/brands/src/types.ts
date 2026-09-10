import type { Brand } from '@incitio/schema';
import type { FieldMapping } from '@incitio/ingest';

/**
 * One way a chain hands over its offers.
 *
 * A chain does not have "a feed". SuperBrugsen alone has Coop's own
 * tilbudsavis export, nested under `Pages[].Entries[]`, and the flat
 * Tjek offers API a single store publishes — different field names,
 * different shapes, same chain. Modelling a brand as having ONE feed
 * meant the second one could only arrive by replacing the first.
 */
export interface FeedSource {
  /** Stable id, used in reports and on the command line. */
  id: string;
  /** What to call it when telling someone which reader ran. */
  name: string;
  format: 'csv' | 'json';
  /**
   * Field names that identify this format. All must be present;
   * `nested` distinguishes a payload whose records sit under
   * `Pages[].Entries[]` from a top-level array.
   */
  signature: { fields: string[]; nested?: boolean };
  mapping: FieldMapping;
  /** A sample of this format shipped in the repo, under the static root. */
  path?: string;
}

/**
 * One tenant, complete: how to read their feeds, and how their pages
 * look.
 *
 * `Brand` is the serialisable half — it crosses the wire to the browser
 * and into the PDF renderer. The mappings are code, so they stay here
 * on the server side. Onboarding a chain is meant to be one file in
 * `src/brands/` and one line in the registry, nothing else.
 */
export interface BrandDefinition {
  brand: Brand;
  /** Every format this chain delivers. The first is the default. */
  sources: FeedSource[];
}
