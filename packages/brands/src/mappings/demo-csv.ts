import type { FieldMapping } from '@incitio/ingest';
import { classifyLabels } from '../labels.js';

/** The demo CSV: Danish column names, semicolon separated. */
export const DEMO_CSV_SIGNATURE = { fields: ['artikelnr', 'varenavn', 'pris'] };

/**
 * The hand-written demo file, `data/feeds/sample-offers.csv` — the
 * smallest complete mapping in the repo, and the one to copy when a
 * chain sends a spreadsheet.
 */
export function demoCsv(retailerId: string, sourceName = 'sample-offers.csv'): FieldMapping {
  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    fields: {
      id: 'artikelnr',
      name: 'varenavn',
      brand: 'maerke',
      category: 'kategori',
      description: 'beskrivelse',
      price: 'pris',
      prePrice: 'foerpris',
      quantity: 'maengde',
      validFrom: 'gyldig_fra',
      validTo: 'gyldig_til',
      imageUrl: 'billede',
      labels: (row: Record<string, unknown>) =>
        classifyLabels(String(row['etiketter'] ?? '')),
    },
  };
}
