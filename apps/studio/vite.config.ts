import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createReadStream, readFileSync, statSync } from 'node:fs';
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
 * The service worker that routes the chain's product photographs through
 * the API's cache (`image-sw.js`). Served at the root so its scope is the
 * whole studio — `data/` is the public dir, so it cannot simply live there.
 */
const SW = fileURLToPath(new URL('./image-sw.js', import.meta.url));
function imageWorker(): Plugin {
  return {
    name: 'incitio-image-worker',
    configureServer(server) {
      server.middlewares.use('/image-sw.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript');
        res.setHeader('cache-control', 'no-cache');
        res.end(readFileSync(SW));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'image-sw.js', source: readFileSync(SW, 'utf8') });
    },
  };
}

/**
 * `data/` is served as the static root so generated product images resolve
 * at the same `/images/...` paths the feed carries — no rewriting of URLs
 * between ingest and render.
 */
export default defineConfig({
  plugins: [imageWorker(), liveData(), react()],
  publicDir: DATA,
  server: {
    port: 5173,
    // The API runs as a separate process; proxying keeps the browser on a
    // single origin so no CORS handling leaks into the client.
    // INCITIO_API points a second studio at a second API (e.g. one on a copy of the database).
    proxy: { '/api': { target: process.env['INCITIO_API'] ?? 'http://localhost:8787', changeOrigin: true } },
  },
});
