import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfferRules, readDesignExport, type OfferDesign } from '@incitio/schema';

/**
 * The offer designs each chain ships with: `data/designs/<brand>-cms.json`,
 * copied out of Tjek's CMS (Design templates → Offers → Copy to clipboard).
 * Used until the chain saves its own in the studio. A file that cannot be
 * read is said and skipped — that chain falls back to its plain tiles.
 */
export function readDefaultDesigns(dir: string): Record<string, { designs: OfferDesign[]; tag: string | null; rules: OfferRules }> {
  const out: Record<string, { designs: OfferDesign[]; tag: string | null; rules: OfferRules }> = {};
  let files: string[] = [];
  try { files = readdirSync(dir).filter((file) => file.endsWith('-cms.json')); } catch { return out; }
  for (const file of files) {
    try {
      const { designs, tag, rules } = readDesignExport(readFileSync(join(dir, file), 'utf8'));
      out[file.replace(/-cms\.json$/, '')] = { designs, tag, rules: OfferRules.parse(rules) };
    } catch (error) {
      console.warn(`designs: ${file} kunne ikke læses (${error instanceof Error ? error.message : error})`);
    }
  }
  return out;
}
