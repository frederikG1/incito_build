import type { OfferLabelInput } from '@incitio/schema';

/**
 * Feeds ship label text as an opaque delimited string. The kind is
 * inferred so the tile can colour it, while the original wording is kept
 * verbatim — chains are particular about that, and some of it is legally
 * fixed phrasing that must not be reworded.
 */
export function classifyLabels(raw: string, separator = '|'): OfferLabelInput[] {
  return raw
    .split(separator)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const lower = text.toLowerCase();
      if (lower.includes('medlem')) return { kind: 'member' as const, text };
      if (/\d\s*for\s*\d/.test(lower)) return { kind: 'multibuy' as const, text };
      if (lower.includes('spar')) return { kind: 'saving' as const, text };
      if (lower.includes('øko')) return { kind: 'organic' as const, text };
      if (lower.startsWith('ny')) return { kind: 'new' as const, text };
      return { kind: 'custom' as const, text };
    });
}
