/**
 * Render a built catalogue and assert nothing is cut off.
 *
 *   npm run check -- .data/out/superbrugsen-baseline.json
 *
 * The clipping bugs in this renderer were all invisible to TypeScript
 * and to the unit tests: a grid track collapsing, a percentage height
 * resolving to `auto`, a price mark sized against the page instead of
 * the tile. Every one of them only showed up as a product with its
 * bottom sliced off. This runs the real browser and measures.
 *
 * Deliberately a script rather than a vitest case: it needs Chromium
 * and a built catalogue, and `npm test` should stay instant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { CatalogDocument } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { renderCatalogueHtml } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!path) {
  console.error('brug: npm run check -- <sti-til-katalog.json>');
  process.exit(1);
}

const document = CatalogDocument.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')),
);
const { brand } = getBrand(document.brandId);
const assetDir = fileURLToPath(new URL('data', ROOT));

const html = renderCatalogueHtml(document, brand, {
  assetBase: pathToFileURL(`${assetDir}/`).href,
});
const scratch = `${assetDir}/.incitio-check.html`;
writeFileSync(scratch, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
await page
  .waitForFunction(() => [...window.document.images].every((i) => i.complete), undefined, {
    timeout: 30_000,
  })
  .catch(() => undefined);

const findings = await page.evaluate(() => {
  /** The visible artwork inside an `object-fit: contain` box. */
  const painted = (img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    // A `cover` image fills its box and is clipped to it by design, so
    // the box IS the painted area — contain maths would report the part
    // that was cropped on purpose as a defect.
    if (getComputedStyle(img).objectFit === 'cover') return r;
    const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    return {
      left: r.left + (r.width - w) / 2,
      right: r.right - (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      bottom: r.bottom - (r.height - h) / 2,
    };
  };

  const problems: { page: number; kind: string; detail: string }[] = [];
  const missing: string[] = [];
  const where = (el: Element) => {
    const slot = el.closest('.slot') as HTMLElement | null;
    const tile = el.closest('.tile');
    const role = [...(tile?.classList ?? [])].find((c) => c.startsWith('tile--')) ?? '';
    return `${slot?.dataset['slotId'] ?? '?'}/${role.replace('tile--', '')}`;
  };

  /*
   * Does the markup still match the stylesheet?
   *
   * The check below measures geometry, and geometry looked fine on a
   * page whose tile had been rewritten to utility classes the project
   * does not ship: every element was unstyled, so nothing overflowed
   * anything. A structural assertion catches that in one line, where
   * the measurements cannot.
   */
  const required = ['.tile', '.tile__media', '.tile__info', '.price'];
  for (const selector of required) {
    if (window.document.querySelector(selector) === null) {
      problems.push({
        page: 0,
        kind: 'markup no longer matches the stylesheet',
        detail: `no element matches "${selector}" — the renderer and styles.css have diverged`,
      });
    }
  }

  [...window.document.querySelectorAll('.page')].forEach((el, index) => {
    const n = index + 1;
    const bounds = el.getBoundingClientRect();

    /*
     * A product cut off, measured against the box that actually clips
     * it.
     *
     * That is the SLOT for an ordinary tile and the PAGE for one the
     * template let bleed — those are the two elements carrying
     * `overflow: hidden`. Measuring against the artwork box instead
     * reported every staggered and fanned cluster as broken, because
     * those transforms are meant to reach outside it.
     */
    for (const img of el.querySelectorAll('img')) {
      const media = img.closest('.tile__media');
      if (!media) continue;
      const slot = img.closest('.slot');
      if (!slot) continue;
      /*
       * An image that never arrived has no intrinsic size, so the
       * geometry below would measure its empty box and report a
       * rotated cluster as two pixels out of place. A dead image
       * service is worth knowing about, but it is not a layout defect.
       */
      if (!(img as HTMLImageElement).naturalWidth) { missing.push(where(img)); continue; }

      const bleeds = slot.classList.contains('slot--bleed');
      const clip = bleeds ? bounds : slot.getBoundingClientRect();
      const a = painted(img as HTMLImageElement);
      const over = Math.max(
        clip.left - a.left, a.right - clip.right,
        clip.top - a.top, a.bottom - clip.bottom,
      );
      if (over > 1) {
        problems.push({
          page: n,
          kind: bleeds ? 'artwork off the sheet' : 'artwork cut at the slot edge',
          detail: bleeds
            ? `${Math.round(over)}px ${where(img)} — lower this template's bleed`
            : `${Math.round(over)}px ${where(img)}`,
        });
      }
    }

    /*
     * The price mark is SUPPOSED to overlap the product — that is the
     * design. It must never overlap the product's NAME, which is the
     * one thing a shopper has to be able to read next to the number.
     */
    for (const tile of el.querySelectorAll('.tile')) {
      const mark = tile.querySelector('.price');
      const label = tile.querySelector('.tile__name');
      if (!mark || !label) continue;
      const m = mark.getBoundingClientRect();
      const t = label.getBoundingClientRect();
      const hits = !(m.right < t.left || m.left > t.right || m.bottom < t.top || m.top > t.bottom);
      if (hits) {
        problems.push({
          page: n,
          kind: 'price mark covers the product name',
          detail: `${(label.textContent ?? '').slice(0, 30)} — raise the mark`,
        });
      }
    }

    // Half a promo chip or half a line of type.
    for (const tags of el.querySelectorAll('.tile__tags')) {
      if (tags.scrollHeight - tags.clientHeight > 2) {
        problems.push({ page: n, kind: 'promo tag clipped', detail: '' });
      }
    }
    for (const info of el.querySelectorAll('.tile__info')) {
      const over = info.scrollHeight - info.clientHeight;
      if (over > 2) problems.push({ page: n, kind: 'text clipped', detail: `${over}px ${where(info)}` });
    }
  });

  return { problems, missing };
});

const { problems, missing } = findings;

const layout = await page.evaluate(() =>
  [...window.document.querySelectorAll('.page')].map((el) => ({
    template: (el as HTMLElement).dataset['templateId'] ?? '?',
    tiles: el.querySelectorAll('.tile').length,
    ground: getComputedStyle(el).getPropertyValue('--ground').trim(),
    packs: [...el.querySelectorAll('.tile__pack')]
      .map((x) => x.className.replace('tile__pack tile__pack--', '')),
  })));

await browser.close();
rmSync(scratch, { force: true });

console.log(`katalog    ${document.name} — ${document.pages.length} sider\n`);
console.log('side  skabelon             varer  grund     varianter');
layout.forEach((p, i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}  ${p.template.padEnd(20)} ${String(p.tiles).padStart(5)}  `
    + `${p.ground.padEnd(9)} ${[...new Set(p.packs)].join(', ')}`,
  );
});

const distinct = (values: string[]) => new Set(values).size;
console.log(
  `\nvariation  ${distinct(layout.map((p) => p.template))} skabeloner, `
  + `${distinct(layout.map((p) => String(p.tiles)))} tætheder, `
  + `${distinct(layout.map((p) => p.ground))} baggrunde, `
  + `${distinct(layout.flatMap((p) => p.packs))} variantopstillinger`,
);

if (missing.length > 0) {
  // Not a failure: the image services are somebody else's, and a slow
  // one costs a proof, not a catalogue.
  console.log(`billeder   ${missing.length} nåede ikke at loade (${[...new Set(missing)].slice(0, 4).join(', ')})`);
}

if (problems.length === 0) {
  console.log('afskæring  ingen');
} else {
  console.log(`\nafskæring  ${problems.length} problemer`);
  for (const f of problems) console.log(`  side ${f.page}: ${f.kind} ${f.detail}`);
  process.exit(1);
}
