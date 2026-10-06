import { defineConfig, devices } from '@playwright/test';

/**
 * The studio in a real browser, against its own API and its own database.
 *
 *   npm run e2e            # headless
 *   npm run e2e -- --ui    # watch it
 *
 * Ports apart from the dev servers (5173/8787), so a run never meets the
 * studio somebody has open. The API runs with sign-in ON — the tests go
 * through the same door staff do — on a database `e2e/seed.ts` makes
 * fresh each run. Product photos still come through the shared image
 * cache (.data/image-cache), so a run asks the chain's image service for
 * nothing it has already seen.
 */
const API = 8796;
const STUDIO = 5177;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${STUDIO}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'login', testMatch: /auth\.setup\.ts/ },
    {
      name: 'studio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: '.data/e2e/state.json' },
      dependencies: ['login'],
    },
  ],
  webServer: [
    {
      command: 'node ./node_modules/.bin/vite-node e2e/seed.ts && node ./node_modules/.bin/vite-node packages/server/src/main.ts',
      url: `http://localhost:${API}/api/health`,
      env: { PORT: String(API), INCITIO_DB: '.data/e2e/incitio.db', INCITIO_AUTH: 'on' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node ./node_modules/.bin/vite apps/studio --port ${STUDIO} --strictPort`,
      url: `http://localhost:${STUDIO}`,
      env: { INCITIO_API: `http://localhost:${API}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
