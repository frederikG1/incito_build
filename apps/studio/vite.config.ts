import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * `data/` is served as the static root so generated product images resolve
 * at the same `/images/...` paths the feed carries — no rewriting of URLs
 * between ingest and render.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../data', import.meta.url)),
  server: {
    port: 5173,
    // The API runs as a separate process; proxying keeps the browser on a
    // single origin so no CORS handling leaks into the client.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});
