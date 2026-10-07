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

  test('a new avis judges its file before it is made', async ({ page }) => {
    await page.goto('/#/superbrugsen');
    await page.getByRole('button', { name: /^Lav avisen for uge/ }).first().click();
    const dialog = page.getByRole('dialog', { name: /Ny avis/ });
    const pick = dialog.locator('input[type=file]');
    // Another chain's file: said here, not after the week is built from it.
    await pick.setInputFiles(feed('nemlig.json'));
    await expect(dialog.locator('.feedcheck__report--ulæselig')).toContainText('Kan ikke læses');
    // The chain's own, whole file: nothing to say.
    await pick.setInputFiles(feed('SuperBrugsenW36.json'));
    await expect(dialog.locator('.feedcheck__report')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Annullér' }).click();
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

  test('dragging the edge two cells share moves both, and Alt moves one alone', async ({ page }) => {
    const { catalogId, pages } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/side/${pages[0]}`);
    await page.getByRole('button', { name: 'Rediger layout' }).click();
    const cells = page.locator('.celledit__cell');
    await expect(cells.first()).toBeVisible();
    const boxes = await cells.evaluateAll((all) => all.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    // A cell with a neighbour across its left edge — or, on a page of rows, across its top.
    const across = (vertical: boolean) => boxes.flatMap((r, i) => boxes.map((l, j) => ({ i, j, r, l }))).find(({ r, l }) => vertical
      ? Math.abs(r.top - l.bottom) < 40 && Math.min(r.right, l.right) - Math.max(r.left, l.left) > 40
      : Math.abs(r.left - l.right) < 40 && Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top) > 40);
    const vertical = !across(false);
    const pair = across(vertical);
    expect(pair).toBeTruthy();
    const { i, j } = pair!;
    const drag = async (by: number, alt = false) => {
      const grip = cells.nth(i).locator(vertical ? '.celledit__grip--n' : '.celledit__grip--w');
      const g = (await grip.boundingBox())!;
      const at = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (const k of [0.5, 1]) {
        await page.mouse.move(at.x + (vertical ? 0 : by * k), at.y + (vertical ? by * k : 0), { steps: 4 });
      }
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    };
    // The held cell's near edge, and its neighbour's facing edge.
    const edges = async () => {
      const held = (await cells.nth(i).boundingBox())!;
      const next = (await cells.nth(j).boundingBox())!;
      return vertical
        ? { near: held.y, facing: next.y + next.height }
        : { near: held.x, facing: next.x + next.width };
    };
    const before = await edges();
    await drag(-40);
    const after = await edges();
    expect(after.near).toBeLessThan(before.near - 25);
    // The neighbour gave what the cell took: the alley between them is what it was.
    expect(Math.abs((after.near - after.facing) - (before.near - before.facing))).toBeLessThan(1.5);
    await drag(60, true);
    const alone = await edges();
    expect(alone.near).toBeGreaterThan(after.near + 40);
    expect(Math.abs(alone.facing - after.facing)).toBeLessThan(1.5);
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

test.describe('the design menu', () => {
  test('opens on top of the top bar, heading readable', async ({ page }) => {
    const { catalogId, pages } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/side/${pages[0]}`);
    await page.locator('.sheet [data-slot-id]').first().click();
    await page.getByRole('button', { name: 'Skift ▾' }).click();
    const menu = page.getByRole('dialog', { name: 'Design for varen' });
    const box = (await menu.getByText('Design for varen').boundingBox())!;
    // Whatever is drawn at the heading belongs to the menu, not to the bar above it.
    const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role=dialog]') !== null,
      { x: box.x + 5, y: box.y + box.height / 2 });
    expect(onTop).toBe(true);
  });
});

test.describe('printing', () => {
  test('the print file says what it would be sent with', async ({ page }) => {
    const { catalogId } = seeded();
    await page.goto(`/#/superbrugsen/${catalogId}/bog`);
    await page.getByRole('button', { name: "Flere PDF'er" }).click();
    await expect(page.locator('.pdf__caveat')).toContainText('godkendelser mangler');
  });
});

test.describe('planning ahead', () => {
  test('an avis weeks out is made for that week, even from another week\'s file', async ({ page }) => {
    await page.goto('/#/superbrugsen');
    const chip = page.locator('.ahead:not(.ahead--made)').first();
    const week = Number((await chip.locator('b').textContent())!.replace(/\D/g, ''));
    await chip.click();
    const dialog = page.getByRole('dialog', { name: `Ny avis for uge ${week}` });
    await dialog.locator('input[type=file]').setInputFiles(feed('SuperBrugsenW36.json'));
    await dialog.getByRole('button', { name: 'Lav avisen' }).click();
    // Not refused: made for the week chosen, and the file's week is said.
    await expect(page.locator('.toast')).toContainText(`Uge ${week} er lavet med varer fra SuperBrugsenW36.json`);
    await expect(page.locator('.banner--error')).toHaveCount(0);
  });
});

test.describe('deleting an avis', () => {
  test('an avis made weeks ahead can be deleted from its card', async ({ page }) => {
    await page.goto('/#/superbrugsen');
    const chip = page.locator('.ahead:not(.ahead--made)').last();
    const week = Number((await chip.locator('b').textContent())!.replace(/\D/g, ''));
    await chip.click();
    const dialog = page.getByRole('dialog', { name: `Ny avis for uge ${week}` });
    await dialog.locator('input[type=file]').setInputFiles(feed('SuperBrugsenW36.json'));
    await dialog.getByRole('button', { name: 'Lav avisen' }).click();
    await expect(page.locator('.toast')).toContainText(`Uge ${week}`);
    // Pages, so there is something to save.
    await page.getByRole('button', { name: /Hurtigt udkast/ }).click();
    await expect(page.locator('.saving__state--saved')).toBeVisible({ timeout: 15_000 });
    await page.goto('/#/superbrugsen');
    const made = page.locator('.ahead__wrap').filter({ hasText: `Uge ${week}` });
    await made.getByRole('button', { name: /^Mere om/ }).click();
    page.once('dialog', (confirm) => void confirm.accept());
    await made.getByRole('button', { name: 'Slet avisen…' }).click();
    await expect(page.locator('.ahead:not(.ahead--made)').filter({ hasText: `Uge ${week}` })).toHaveCount(1);
    // Not written back by an autosave a moment later.
    await page.waitForTimeout(3500);
    const list = await (await page.request.get('/api/brand/catalogs', { headers: { 'x-incitio-brand': 'superbrugsen' } })).json() as { catalogs: { week: { week: number } | null }[] };
    expect(list.catalogs.some((c) => c.week?.week === week)).toBe(false);
  });
});
