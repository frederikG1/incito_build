import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const DATA = fileURLToPath(new URL('../../data', import.meta.url));

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/**
 * Serve `data/` straight off the disk, on every request.
 *
 * Vite indexes `publicDir` when it starts and does not watch it — it sits
 * outside the app's root — so a file written afterwards (a drawn motif in
 * `data/decor`, an upload in `data/uploads`) was answered with index.html
 * and the page showed a broken picture until the dev server restarted.
 * Registered before Vite's own middleware, so this answers first.
 */
function liveData(): Plugin {
  return {
    name: 'incitio-live-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
        const type = TYPES[extname(path).toLowerCase()];
        if (!type) return next();
        const file = normalize(join(DATA, path));
        // Nothing outside data/.
        if (!file.startsWith(DATA + sep)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader('content-type', type);
        res.setHeader('cache-control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * `data/` is served as the static root so generated product images resolve
 * at the same `/images/...` paths the feed carries — no rewriting of URLs
 * between ingest and render.
 */
export default defineConfig({
  plugins: [liveData(), react()],
  publicDir: DATA,
  server: {
    port: 5173,
    // The API runs as a separate process; proxying keeps the browser on a
    // single origin so no CORS handling leaks into the client.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});
