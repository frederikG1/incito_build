import type { Brand, PageTemplate } from '@incitio/schema';
import { parseCsv, sniffDelimiter } from '@incitio/ingest';
import { NETTO } from './brands/netto.js';
import { NEMLIG } from './brands/nemlig.js';
import { SUPERBRUGSEN } from './brands/superbrugsen.js';
import type { BrandDefinition, FeedSource } from './types.js';

export * from './types.js';
export * from './grid.js';
export * from './labels.js';

/**
 * Every tenant the system knows.
 *
 * Isolation is structural, not a filter applied late: nothing in the
 * system takes a bare template id or theme, only a brand plus an id
 * resolved WITHIN that brand. A Netto session that asked for
 * `sb/grid-4` gets "unknown template", because the lookup never sees
 * SuperBrugsen's set.
 */
const REGISTRY: Record<string, BrandDefinition> = {
  [NETTO.brand.id]: NETTO,
  [SUPERBRUGSEN.brand.id]: SUPERBRUGSEN,
  [NEMLIG.brand.id]: NEMLIG,
};

export class UnknownBrandError extends Error {
  constructor(id: string) {
    super(`unknown brand "${id}"`);
    this.name = 'UnknownBrandError';
  }
}

export function brandIds(): string[] {
  return Object.keys(REGISTRY);
}

export function listBrands(): { id: string; name: string }[] {
  return Object.values(REGISTRY).map((d) => ({ id: d.brand.id, name: d.brand.name }));
}

export function findBrand(id: string): BrandDefinition | undefined {
  return REGISTRY[id];
}

export function getBrand(id: string): BrandDefinition {
  const definition = REGISTRY[id];
  if (!definition) throw new UnknownBrandError(id);
  return definition;
}

/**
 * Resolve a template id against ONE brand's own set.
 *
 * The only way to get a template in this system. There is deliberately
 * no global template lookup: that function would be the hole through
 * which one chain's layouts reach another chain's page.
 */
export function resolveTemplate(brand: Brand, templateId: string): PageTemplate | undefined {
  return brand.templates.find((t) => t.id === templateId);
}

/** Templates of this brand that hold exactly `count` offers. */
export function templatesForCount(brand: Brand, count: number): PageTemplate[] {
  return brand.templates.filter((t) => t.slots.length === count);
}

/** The offer counts this brand can lay out, ascending. */
export function brandCapacities(brand: Brand): number[] {
  return [...new Set(brand.templates.map((t) => t.slots.length))].sort((a, b) => a - b);
}

export interface SourceMatch {
  source: FeedSource;
  /** What was matched on, shown so a rejection is actionable. */
  reason: string;
}

export interface SourceMiss {
  source: null;
  reason: string;
  /** Field names found in the file, to help work out what it is. */
  fields: string[];
}

export type SourceResult = SourceMatch | SourceMiss;

function jsonFields(payload: unknown): { fields: string[]; nested: boolean } {
  if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object') {
    return { fields: Object.keys(payload[0] as object), nested: false };
  }
  // Coop-style: records two levels down under Pages[].Entries[].
  const pages = (payload as { Pages?: unknown[] })?.Pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      const entries = (page as { Entries?: unknown[] })?.Entries;
      if (Array.isArray(entries) && entries.length > 0) {
        return { fields: Object.keys(entries[0] as object), nested: true };
      }
    }
  }
  return { fields: [], nested: false };
}

/**
 * Work out which of THIS CHAIN'S readers can read an uploaded file.
 *
 * Deliberately not "work out which chain this belongs to". The real
 * workflow is a chain uploading this week's file in a format they
 * already publish — so the useful question is "is this one of ours,
 * and which one?". Answering the other question would also mean a
 * mis-detected upload could silently rebuild a different chain's
 * catalogue.
 */
export function resolveSource(
  definition: BrandDefinition,
  text: string,
  filename = '',
): SourceResult {
  const trimmed = text.trimStart();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
    || filename.toLowerCase().endsWith('.json');
  const format: 'csv' | 'json' = looksJson ? 'json' : 'csv';

  let fields: string[] = [];
  let nested = false;

  if (looksJson) {
    try {
      ({ fields, nested } = jsonFields(JSON.parse(text)));
    } catch {
      return { source: null, reason: 'filen er ikke gyldig JSON', fields: [] };
    }
  } else {
    const rows = parseCsv(text, sniffDelimiter(text));
    fields = rows[0] ? Object.keys(rows[0]) : [];
  }

  if (fields.length === 0) {
    return { source: null, reason: 'ingen rækker fundet i filen', fields };
  }

  const present = new Set(fields);
  for (const source of definition.sources) {
    if (source.format !== format) continue;
    if (source.signature.nested !== undefined && source.signature.nested !== nested) continue;
    if (source.signature.fields.every((f) => present.has(f))) {
      return { source, reason: `${source.name} — genkendt på ${source.signature.fields.join(', ')}` };
    }
  }

  /*
   * Report against the closest reader rather than listing them all.
   *
   * "mangler heading, pricing" is something a person can check against
   * their file; "matched none of 2 signatures" is not.
   */
  const closest = [...definition.sources]
    .map((source) => ({
      source,
      missing: source.signature.fields.filter((f) => !present.has(f)),
    }))
    .sort((a, b) => a.missing.length - b.missing.length)[0];

  return {
    source: null,
    reason: closest
      ? `filen passer ikke til ${definition.brand.name}s formater — nærmest er `
        + `${closest.source.name}, som mangler ${closest.missing.join(', ')}`
      : `${definition.brand.name} har ingen læser til en ${format.toUpperCase()}-fil`,
    fields,
  };
}

/** This chain's default source — the one a fresh run reads. */
export function defaultSource(definition: BrandDefinition): FeedSource {
  return definition.sources[0]!;
}

/** One named source of this chain, or undefined. */
export function findSource(
  definition: BrandDefinition,
  sourceId: string,
): FeedSource | undefined {
  return definition.sources.find((s) => s.id === sourceId);
}
