import type { OfferLabelInput, Quantity } from '@incitio/schema';
import type { FieldMapping } from '@incitio/ingest';

/**
 * The Tjek offers API shape — a flat array of offer objects, which is
 * what a single store publishes and what most chains on the platform
 * deliver.
 *
 * Written once and parameterised by chain, because the shape is the
 * platform's, not the chain's: onboarding another retailer that
 * publishes here is `tjekOffers('netto')`, not another 200 lines.
 */

interface TjekQuantity {
  unit?: { symbol?: string; si?: { symbol?: string; factor?: number } };
  size?: { from?: number | null; to?: number | null };
  pieces?: { from?: number | null; to?: number | null };
}

const UNITS: Record<string, Quantity['unit']> = {
  kg: 'kg', g: 'g', l: 'l', ml: 'ml', cl: 'ml', dl: 'ml',
  pcs: 'pcs', stk: 'pcs', m: 'm', pack: 'pack',
};

/**
 * Size, unit and piece count from the feed's structured quantity.
 *
 * Ranges are common — "90-175 g", "15-18 x 33 cl" — because one offer
 * covers several pack sizes, and the LOWER bound is the one to carry.
 * The chain prints "Kg-pris maks." beside these, and a maximum unit
 * price is price divided by the SMALLEST pack: Taffel at 12 kr over
 * 90-175 g is quoted at 133,33/kg, which is 12/0.090. Taking the upper
 * bound would derive 68,57 and print a figure the chain does not
 * stand behind.
 */
export function tjekQuantity(raw: unknown): Quantity {
  const q = raw as TjekQuantity | undefined;
  const symbol = q?.unit?.symbol?.toLowerCase() ?? '';
  const unit = UNITS[symbol];
  const size = q?.size?.from ?? q?.size?.to ?? null;
  const pieces = q?.pieces?.from ?? 1;

  if (!unit || size === null || !Number.isFinite(size)) {
    return { size: null, unit: 'pcs', pieceCount: Math.max(1, Math.round(pieces || 1)) };
  }
  // Centilitres and decilitres are stored as millilitres so the
  // comparison maths downstream has one scale per dimension.
  const scale = symbol === 'cl' ? 10 : symbol === 'dl' ? 100 : 1;
  if (unit === 'pcs') {
    return { size: null, unit: 'pcs', pieceCount: Math.max(1, Math.round(pieces || 1)) };
  }
  return { size: size * scale, unit, pieceCount: Math.max(1, Math.round(pieces || 1)) };
}

/**
 * Editorial phrases the chain writes into the description.
 *
 * These are the chain's own words and are printed verbatim — "Frit
 * valg." is a promise about what the price covers and "Begrænset
 * parti." is a legal qualifier. They are lifted into labels so a tile
 * can set them as chips rather than burying them in fine print.
 */
const PHRASES: { pattern: RegExp; kind: OfferLabelInput['kind']; text: string }[] = [
  { pattern: /frit valg/i, kind: 'custom', text: 'Frit valg' },
  { pattern: /flere varianter/i, kind: 'custom', text: 'Flere varianter' },
  { pattern: /begrænset parti/i, kind: 'custom', text: 'Begrænset parti' },
  { pattern: /ugens køb/i, kind: 'new', text: 'Ugens køb' },
  { pattern: /dybfrost/i, kind: 'custom', text: 'Dybfrost' },
  { pattern: /økologisk|\bøko\b/i, kind: 'organic', text: 'Økologisk' },
  { pattern: /ikke egnet til børn/i, kind: 'custom', text: 'Ikke egnet til børn' },
];

export function tjekLabels(description: string): OfferLabelInput[] {
  const found = PHRASES.filter((p) => p.pattern.test(description));
  // "Frit valg" and "Flere varianter" say the same thing to a shopper;
  // published tiles print one of them, not both.
  const deduped = found.filter(
    (p) => !(p.text === 'Flere varianter' && found.some((o) => o.text === 'Frit valg')),
  );
  return deduped.map(({ kind, text }) => ({ kind, text }));
}

/**
 * What is left of the description once the chips and the unit price
 * have been taken out of it.
 *
 * Printing the raw string under a tile that already shows "Frit valg."
 * as a chip and "133,33 / kg" as a comparison repeats both. What
 * remains — "Danmark, kl. I.", "Sælges i hele forpakninger" — is the
 * part a leaflet actually sets as fine print.
 */
export function tjekFinePrint(description: string): string {
  return description
    .replace(/(kg|liter|stk\.?|meter)-?pris\s*(?:maks\.?)?\s*[\d.,]+/gi, '')
    .replace(/\b(frit valg|flere varianter|begrænset parti|ugens køb|dybfrost|ikke egnet til børn)\b\.?/gi, '')
    .replace(/\+\s*pant/gi, '')
    .replace(/\b\d+[\d,.\s–-]*\s*(g|kg|ml|cl|dl|l|stk\.?)\b\.?/gi, '')
    .replace(/\b1\s+(stk|pose|pakke|flaske|dåse|bakke|bæger|bundt)\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,]+|[\s.,]+$/g, '')
    .trim();
}

/**
 * Coarse category from the product heading.
 *
 * The Tjek payload carries `category_ids`, and on these feeds it is
 * empty on every offer — so without this every product lands in one
 * bucket and the deterministic planner produces a single section
 * called "Uncategorised". Keyword matching is crude, but it is honest
 * about being crude and it is only ever a FALLBACK: when the curator
 * runs it groups by meaning and never reads this.
 */
const CATEGORIES: { pattern: RegExp; name: string }[] = [
  { pattern: /øl|vin|cider|spiritus|whisky|gin|rom|cognac|tequila|breezer|somersby/i, name: 'Øl og vin' },
  { pattern: /sodavand|kondi|pepsi|cola|juice|saft|drik|vand|energy|red bull|kaffe|te\b/i, name: 'Drikkevarer' },
  { pattern: /chips|nødder|slik|chokolade|lakrids|bolche|kage|is\b|dessert|snack|m&m|malteser/i, name: 'Snacks og slik' },
  { pattern: /mælk|yoghurt|ost|smør|fløde|hytteost|skyr|æg\b|mejeri/i, name: 'Mejeri' },
  { pattern: /brød|rugbrød|boller|knækbrød|wraps|toast/i, name: 'Brød' },
  { pattern: /kød|kylling|gris|okse|kalv|bacon|pølse|hakket|filet|fisk|laks|rejer/i, name: 'Kød og fisk' },
  { pattern: /frugt|grønt|salat|tomat|agurk|kartof|løg|æble|blomme|banan|bær|blomst|dahlia/i, name: 'Frugt og grønt' },
  { pattern: /pizza|frost|dybfrost|færdigret|suppe|sauce|dressing|ketchup|mayonnaise|pasta|ris\b/i, name: 'Kolonial' },
  { pattern: /vask|rengør|papir|toilet|ble|shampoo|tandpasta|batteri/i, name: 'Husholdning' },
];

export function tjekCategory(heading: string, description: string): string {
  const text = `${heading} ${description}`;
  return CATEGORIES.find((c) => c.pattern.test(text))?.name ?? 'Øvrige tilbud';
}

/** Field mapping for one chain's Tjek offers feed. */
export function tjekOffers(retailerId: string, sourceName: string): FieldMapping {
  const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? '').trim();

  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    fields: {
      id: 'id',
      name: 'heading',
      description: (row) => tjekFinePrint(text(row, 'description')) || null,
      brand: () => null,
      category: (row) => tjekCategory(text(row, 'heading'), text(row, 'description')),
      price: (row) => (row['pricing'] as { price?: number })?.price ?? null,
      prePrice: (row) => (row['pricing'] as { pre_price?: number })?.pre_price ?? null,
      // The feed states no saving; ingest derives one when a previous
      // price is present and leaves it null otherwise.
      quantityValue: (row) => tjekQuantity(row['quantity']),
      validFrom: 'run_from',
      validTo: 'run_till',
      // `zoom` is the 1000px render. The tiles are printed at A4, so the
      // largest available is the right default; `view` is the fallback.
      imageUrl: (row) => {
        const images = row['images'] as Record<string, string> | undefined;
        return images?.['zoom'] ?? images?.['view'] ?? images?.['thumb'] ?? null;
      },
      /*
       * Position in the chain's own printed book, as editorial weight.
       *
       * A retailer puts its drivers on the first pages, so page 1 is a
       * strong signal and page 36 a weak one. Absent — every offer on
       * page 0 — this returns null and importance falls back to
       * discount depth.
       */
      priority: (row) => {
        const page = Number(row['catalog_page']);
        if (!Number.isFinite(page) || page <= 0) return null;
        return Math.max(0.15, Math.min(1, 1 - (page - 1) / 40));
      },
      labels: (row) => tjekLabels(text(row, 'description')),
    },
  };
}
