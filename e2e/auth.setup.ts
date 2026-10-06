import { expect, test as setup } from './fixtures.js';
import { seeded } from './account.js';

/** Sign in once through the real form; every studio test starts with this session. */
setup('sign in', async ({ page }) => {
  const account = seeded();
  await page.goto('/');
  await page.getByLabel('E-mail').fill(account.email);
  await page.getByLabel('Adgangskode').fill(account.password);
  await page.getByRole('button', { name: 'Log ind' }).click();
  await expect(page.locator('.top__who')).toContainText(account.name);
  await page.context().storageState({ path: '.data/e2e/state.json' });
});
