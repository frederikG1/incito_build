import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp, Store } from './index.js';

// Deliberately NOT under data/: Vite serves that directory as its static
// root, which would publish the database over HTTP.
const dbPath =
  process.env['INCITIO_DB'] ??
  fileURLToPath(new URL('../../../.data/incitio.db', import.meta.url));

const store = new Store(dbPath);
const port = Number(process.env['PORT'] ?? 8787);

serve({ fetch: createApp(store).fetch, port }, (info) => {
  console.log(`incitio api on http://localhost:${info.port} (db: ${dbPath})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}
