import { test as base } from '@playwright/test';

/**
 * Every browser test, with the chain's image service shut off.
 *
 * The tests are about the studio, not the photographs, and Republica has
 * asked us to keep the volume down: a CI run must never become a few
 * hundred image requests. The service worker that would route them
 * through the API's cache is blocked in the config, so they come straight
 * from the page — and are refused here.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/^https:\/\/imageservice\d*\.republica\.dk\//, (route) => route.abort());
    await use(page);
  },
});
export { expect } from '@playwright/test';
