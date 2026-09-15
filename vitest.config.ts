import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The studio is React and is judged on screen, but a few of its
    // functions decide what a run costs — see `referenceJobs` — and
    // those are ordinary pure functions worth pinning down.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
});
