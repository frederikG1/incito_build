import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.js';
import { seeded } from './account.js';

const feed = (name: string) => fileURLToPath(new URL(`../data/feeds/${name}`, import.meta.url));

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('only the sign-in screen draws, and a wrong password is said', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log ind' })).toBeVisible();
    await expect(page.locator('.shell')).toHaveCount(0);
    await page.getByLabel('E-mail').fill(seeded().email);
    await page.getByLabel('Adgangskode').fill('not-the-right-password');
    await page.getByRole('button', { name: 'Log ind' }).click();
    await expect(page.getByRole('alert')).toHaveText('Forkert e-mail eller adgangskode');
  });
});

test.describe('signed in', () => {
  test('sees only the chain the account works for', async ({ page }) => {
    await page.goto('/');
    const brands = await (await page.request.get('/api/brands')).json() as { brands: { id: string }[] };
    expect(brands.brands.map((b) => b.id)).toEqual(['superbrugsen']);
    const foreign = await page.request.get('/api/brand/profile', { headers: { 'x-incitio-brand': 'netto' } });
    expect(foreign.status()).toBe(403);
  });

  test('Feedtjek judges the week\'s file on the front page', async ({ page }) => {
    await page.goto('/#/superbrugsen');
    const pick = page.locator('.feedcheck__pick input[type=file]');
    await pick.setInputFiles(feed('SuperBrugsenW36.json'));
    await expect(page.locator('.feedcheck__report--ok')).toContainText('Klar til at bygge');
    await expect(page.locator('.feedcheck__report')).toContainText('160 tilbud');
    await pick.setInputFiles(feed('nemlig.json'));
    await expect(page.locator('.feedcheck__report--ulæselig')).toContainText('Kan ikke læses');
  });

  test('a tile opens in the inspector, and its three tabs switch', async ({ page }) => {
    const { catalogId, pages } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/side/${pages[0]}`);
    const tile = page.locator('.sheet [data-slot-id]').first();
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page.locator('.inspector__head h2')).not.toBeEmpty();
    for (const [tab, shows] of [['Billede', 'Sidens tekster'], ['Dele', 'Elementer'], ['Indhold', 'Overskrift på flisen']] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.locator('.inspector')).toContainText(shows);
    }
  });

  test('the keyboard moves a tile and ⌘Z takes it back', async ({ page }) => {
    const { catalogId, pages } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/side/${pages[0]}`);
    await page.locator('.sheet [data-slot-id]').first().click();
    const undo = page.getByRole('button', { name: 'Fortryd' });
    await expect(undo).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await expect(undo).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(undo).toBeDisabled();
  });
});

test.describe('saving', () => {
  test('an edit is saved by itself and is there after a reload', async ({ page }) => {
    const { catalogId, pages } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/side/${pages[0]}`);
    await page.locator('.sheet [data-slot-id]').first().click();
    const headline = page.getByLabel('Overskrift på flisen');
    const wording = `E2E ${Date.now()}`;
    await headline.fill(wording);
    // Autosave: dirty, then saved, with no button pressed.
    await expect(page.locator('.saving__state--saved')).toBeVisible({ timeout: 15_000 });
    const stored = await (await page.request.get(`/api/brand/catalogs/${catalogId}`, { headers: { 'x-incitio-brand': 'superbrugsen' } })).json() as {
      document: { pages: { placements: { overrides?: { displayName?: string | null } }[] }[] };
    };
    expect(stored.document.pages.flatMap((p) => p.placements).some((p) => p.overrides?.displayName === wording)).toBe(true);
    await page.reload();
    await page.locator('.sheet [data-slot-id]').first().click();
    await expect(page.getByLabel('Overskrift på flisen')).toHaveValue(wording);
  });
});

test.describe('roles', () => {
  test('an editor sees the sign-off buttons, but may not press them', async ({ page }) => {
    const { catalogId } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/godkend`);
    const sign = page.getByRole('button', { name: /^Godkend som/ }).first();
    await expect(sign).toBeVisible();
    await expect(sign).toBeDisabled();
    await expect(sign).toHaveAttribute('title', /Kun for/);
  });
});

test.describe('the week\'s file', () => {
  test('is judged where it lands: products without a picture are said in the shelf', async ({ page }) => {
    const { catalogId, pages } = seeded();
    // W36 with the first three entries' pictures taken out.
    const feed = JSON.parse(readFileSync(new URL('../data/feeds/SuperBrugsenW36.json', import.meta.url), 'utf8')) as {
      Pages: { Entries: Record<string, unknown>[] }[];
    };
    let blanked = 0;
    for (const entry of feed.Pages.flatMap((p) => p.Entries)) {
      if (blanked >= 3) break;
      entry['Motivid'] = '';
      entry['Varer'] = [];
      blanked += 1;
    }
    const file = fileURLToPath(new URL('../.data/e2e/uden-billeder.json', import.meta.url));
    writeFileSync(file, JSON.stringify(feed));
    await page.goto(`/#/superbrugsen/${catalogId}/varer`);
    await page.locator('.goods__file input[type=file]').setInputFiles(file);
    // The read-in says so itself, and points at the shelf.
    await expect(page.locator('.toast')).toContainText('se feedtjekket i varelisten');
    await page.evaluate((hash) => { window.location.hash = hash; }, `/superbrugsen/${catalogId}/side/${pages[0]}`);
    const verdict = page.locator('.shelf__verdict');
    await expect(verdict).toContainText('3 uden billede');
    await verdict.getByRole('button', { name: 'Luk' }).click();
    await expect(verdict).toHaveCount(0);
  });
});
