import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY } from '@incitio/ingest';
import { createApp, Store } from './index.js';

// Deliberately NOT under data/: Vite serves that directory as its static
// root, which would publish the database over HTTP.
const dbPath =
  process.env['INCITIO_DB'] ??
  fileURLToPath(new URL('../../../.data/incitio.db', import.meta.url));

// Where the demo feed's root-relative image paths resolve when printing.
const assetDir = fileURLToPath(new URL('../../../data', import.meta.url));

/*
 * The certification marks, read once at boot.
 *
 * The same file `npm run match` reads, and read the same way — a chain's
 * Ø-mark must not depend on whether the page was built from the terminal
 * or from the editor. Its artwork lives under `data/labels/marks/` and
 * is served by the studio's static root, so the paths in the export
 * resolve without rewriting.
 *
 * A missing or malformed file is not fatal: the marks become plain words
 * again, which is what the studio printed before this existed. Said on
 * stdout rather than swallowed, because a page quietly losing its marks
 * is the kind of thing nobody notices until a retailer does.
 */
const labels = (() => {
  try {
    const { dictionary, issues } = parseLabelDictionary(
      readFileSync(fileURLToPath(new URL('../../../data/labels/tjek-labels.json', import.meta.url)), 'utf8'),
    );
    if (issues.length > 0) console.warn(`mærker: ${issues.length} rækker sprunget over`);
    return dictionary;
  } catch (error) {
    console.warn(`mærker: kunne ikke læses, tilbud får ord i stedet for mærker (${
      error instanceof Error ? error.message : error})`);
    return EMPTY_LABEL_DICTIONARY;
  }
})();

const store = new Store(dbPath);
const port = Number(process.env['PORT'] ?? 8787);

serve({ fetch: createApp(store, { assetDir, labels }).fetch, port }, (info) => {
  console.log(
    `incitio api på http://localhost:${info.port} (db: ${dbPath}, `
    + `${labels.entries.length} mærker)`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}
