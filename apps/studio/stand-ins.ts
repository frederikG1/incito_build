import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Where the studio still shows Eksempeltal, read off its source.
 *
 * Two marks, both deliberate: `SIGNALS_ARE_DEMO = true` in `signals.ts`
 * (reach, households, results), and any use of `standInPrices` — the
 * made-up 30-day price history — outside tests. Replacing the stand-ins
 * removes both, and then this finds nothing.
 *
 * Read from the files rather than imported, so the check needs no
 * bundle and cannot be fooled by tree-shaking.
 */
export function standInsIn(srcDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8');
        const where = relative(srcDir, path);
        if (/SIGNALS_ARE_DEMO\s*=\s*true/.test(text)) found.push(`${where}: SIGNALS_ARE_DEMO = true (rækkevidde, husstande, resultater)`);
        if (/\bstandInPrices\b/.test(text)) found.push(`${where}: standInPrices (opdigtet 30-dages prishistorik)`);
      }
    }
  };
  walk(srcDir);
  return found;
}
