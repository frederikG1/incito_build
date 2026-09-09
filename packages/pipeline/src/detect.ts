import { parseCsv, sniffDelimiter } from '@incitio/ingest';
import { RETAILERS, type RetailerConfig } from './retailers.js';

/**
 * Work out which retailer profile an uploaded feed belongs to.
 *
 * The real workflow is not "arbitrary unknown feed" — it is a retailer
 * uploading this week's file in their own established format. The shape is
 * stable; only the contents change. So detection matches on the field
 * signature that identifies a format, and the caller can always override.
 */
export interface Detection {
  retailer: RetailerConfig | null;
  format: 'csv' | 'json';
  /** Why it matched, shown to the user so a wrong guess is obvious. */
  reason: string;
  /** Field names found, for the "nothing matched" message. */
  fields: string[];
}

/** Signature fields that identify a format. All must be present. */
const SIGNATURES: { retailerId: string; fields: string[]; nested?: boolean }[] = [
  { retailerId: 'nemlig', fields: ['ProductSku', 'CampaignPriceDK01'] },
  { retailerId: 'superbrugsen', fields: ['Header', 'Motivid', 'Priority'], nested: true },
  { retailerId: 'sample', fields: ['artikelnr', 'varenavn', 'pris'] },
];

function jsonFields(payload: unknown): { fields: string[]; nested: boolean } {
  if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object') {
    return { fields: Object.keys(payload[0] as object), nested: false };
  }
  // Coop-style: records two levels down under Pages[].Entries[].
  const pages = (payload as { Pages?: unknown[] })?.Pages;
  if (Array.isArray(pages) && pages.length > 0) {
    const entries = (pages[0] as { Entries?: unknown[] })?.Entries;
    if (Array.isArray(entries) && entries.length > 0) {
      return { fields: Object.keys(entries[0] as object), nested: true };
    }
    // Pages exist but the first is empty (a cover, typically) — look on.
    for (const page of pages) {
      const more = (page as { Entries?: unknown[] })?.Entries;
      if (Array.isArray(more) && more.length > 0) {
        return { fields: Object.keys(more[0] as object), nested: true };
      }
    }
  }
  return { fields: [], nested: false };
}

export function detectFeed(text: string, filename = ''): Detection {
  const trimmed = text.trimStart();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
    || filename.toLowerCase().endsWith('.json');

  let fields: string[] = [];
  let nested = false;

  if (looksJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      ({ fields, nested } = jsonFields(parsed));
    } catch {
      return { retailer: null, format: 'json', reason: 'not valid JSON', fields: [] };
    }
  } else {
    const rows = parseCsv(text, sniffDelimiter(text));
    fields = rows[0] ? Object.keys(rows[0]) : [];
  }

  const format: 'csv' | 'json' = looksJson ? 'json' : 'csv';
  if (fields.length === 0) {
    return { retailer: null, format, reason: 'no records found in the file', fields };
  }

  const present = new Set(fields);
  for (const signature of SIGNATURES) {
    if (signature.nested !== undefined && signature.nested !== nested) continue;
    const missing = signature.fields.filter((f) => !present.has(f));
    if (missing.length === 0) {
      const retailer = RETAILERS[signature.retailerId];
      if (retailer) {
        return {
          retailer,
          format,
          reason: `matched ${retailer.displayName} on ${signature.fields.join(', ')}`,
          fields,
        };
      }
    }
  }

  return {
    retailer: null,
    format,
    reason: `no known profile matches these fields`,
    fields,
  };
}
