import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { standInsIn } from '../../stand-ins.js';

describe('the production build guard', () => {
  it('finds the stand-ins the studio ships with today', () => {
    const found = standInsIn(fileURLToPath(new URL('..', import.meta.url)));
    expect(found.some((f) => f.startsWith('signals.ts: SIGNALS_ARE_DEMO'))).toBe(true);
    expect(found.some((f) => f.includes('standInPrices'))).toBe(true);
  });

  it('finds nothing once they are replaced, and ignores tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'incitio-src-'));
    writeFileSync(join(dir, 'signals.ts'), 'export const SIGNALS_ARE_DEMO = false;\n');
    mkdirSync(join(dir, '__tests__'));
    writeFileSync(join(dir, '__tests__', 'x.test.ts'), "import { standInPrices } from '@incitio/workflow';\n");
    expect(standInsIn(dir)).toEqual([]);
  });
});
