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
import { Brand, CatalogDocument, PageTemplate } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { renderCatalogueHtml } from '@incitio/pdf';
import { coverage, largestEmptyRect, rectArea, type Rect } from '@incitio/renderer';

/**
 * A rectangle as the browser hands it over.
 *
 * A local alias so the block inside `page.evaluate` can be typed
 * without reaching for a value at module scope — that block is
 * serialised and run in the page, where nothing from this file exists.
 * Types are erased before it gets there; a `const` would not be.
 */
type Box = Rect;

const ROOT = new URL('..', import.meta.url);
const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!path) {
  console.error('brug: npm run check -- <sti-til-katalog.json>');
  process.exit(1);
}

const document = CatalogDocument.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')),
);
/*
 * Derived layouts, when the catalogue was built with them.
 *
 * Without this the checker resolves the brand from its id alone and
 * silently skips every page whose template it cannot find — so the
 * layouts most worth measuring, the ones nobody drew by hand, would
 * report clean because they never rendered at all.
 */
const templateArg = process.argv.slice(2).find((a) => a.startsWith('--templates='))?.slice(12);
const base = getBrand(document.brandId).brand;
const brand = templateArg
  ? Brand.parse({
    ...base,
    templates: [
      ...(JSON.parse(readFileSync(resolve(process.cwd(), templateArg), 'utf8')).templates ?? [])
        .map((t: unknown) => PageTemplate.parse(t)),
      ...base.templates,
    ],
  })
  : base;
const assetDir = fileURLToPath(new URL('data', ROOT));

const html = renderCatalogueHtml(document, brand, {
  assetBase: pathToFileURL(`${assetDir}/`).href,
});
const scratch = `${assetDir}/.incitio-check.html`;
writeFileSync(scratch, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
/*
 * Make the artwork actually load before measuring it.
 *
 * Tiles carry `loading="lazy"`, which is right for the editor and
 * wrong here: a catalogue is far taller than any viewport, so on a
 * 21-page book only 72 of 220 images had ever entered one. The rest
 * stayed at `complete === false` forever, and the wait below timed out
 * against a condition that could never become true.
 *
 * That is the worst possible failure mode for this script. An image
 * with no natural dimensions cannot be reported as cut off, so a run
 * measuring two thirds of the book came back with FEWER findings and
 * read as the cleaner result. Raising the timeout does nothing —
 * measured, it stays at 72 — because nothing was in flight.
 *
 * Dropping the lazy flag is enough — Chromium starts the fetch as soon
 * as the attribute changes, with no scrolling needed. This is exactly
 * what `settleImages` in @incitio/pdf does before printing, which is
 * why the PDF and the PNG proofs were right the whole time and only
 * the checker was reading a partial book. Kept in step with it
 * deliberately: a checker that loads the page differently from the
 * printer is measuring something nobody ships.
 *
 * The timeout is still swallowed afterwards — a checker that refuses
 * to report anything because one image is slow is useless — and the
 * count printed below says how much of the book the findings cover.
 */
await page.evaluate(() => {
  for (const img of window.document.images) img.loading = 'eager';
});
await page
  .waitForFunction(() => [...window.document.images].every((i) => i.complete), undefined, {
    // Scaled to the book: the artwork comes from the chain's image
    // service over the network, not from disk.
    timeout: Math.min(180_000, 20_000 + document.pages.length * 6_000),
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
  /*
   * Raw rectangles for the ground measurement, and nothing else.
   *
   * Every decision about them is taken in Node against
   * `@incitio/renderer`'s `measure.ts`. Nothing inside `page.evaluate`
   * can import a module or be reached by a unit test, so the rule here
   * is that this block collects and does not conclude. What it hands
   * back is what a ruler would give you.
   */
  const boxes: {
    page: number;
    slotId: string;
    role: string;
    /** A band feature crops rather than letterboxes — see below. */
    covers: boolean;
    slot: Box;
    parts: Box[];
  }[] = [];
  const pages: { page: number; bounds: Box; parts: Box[] }[] = [];
  const plain = (r: { left: number; top: number; right: number; bottom: number }): Box =>
    ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
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
     * it — which is the PAGE, and only the page.
     *
     * This used to measure an ordinary tile against its SLOT, on the
     * belief that a slot clips. It has not since the artwork was let
     * out of its cell: `.slot` is `overflow: visible` and nothing but
     * `.page` has `overflow: hidden`. So the slot test was not
     * measuring clipping at all — it was measuring overrun, and
     * reporting the design as a defect.
     *
     * Kept as two findings, because they are two different things:
     *
     *   off the sheet — artwork past the paper's edge. Always a defect,
     *                   always cut off in print, checked for every slot
     *                   rather than only for a bleeding one.
     *   past its cell — artwork further out than the page's own
     *                   `--fill` and the template's `--bleed` grant it.
     *                   Overrun up to that is deliberate and declared;
     *                   beyond it is a layout that got away.
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

      const a = painted(img as HTMLImageElement);

      const offSheet = Math.max(
        bounds.left - a.left, a.right - bounds.right,
        bounds.top - a.top, a.bottom - bounds.bottom,
      );
      if (offSheet > 1) {
        problems.push({
          page: n,
          kind: 'artwork off the sheet',
          detail: `${Math.round(offSheet)}px ${where(img)} — lower this template's bleed`,
        });
      }

      /*
       * How far this slot's artwork was licensed to reach.
       *
       * `scale: max(--fill, --bleed)` on the artwork, so the painted
       * box on screen is already the grown one: divide it back out to
       * get what it would have covered at rest, and the difference is
       * the grant. Spent entirely on one side when the cell sits
       * against the sheet's rim and `--art-origin` pins it there, so
       * the whole grant is allowed per side rather than half of it —
       * this is a guard against a layout that got away, not a ruler.
       */
      const styles = getComputedStyle(slot);
      const number = (name: string, fallback: number) => {
        const value = Number.parseFloat(styles.getPropertyValue(name));
        return Number.isFinite(value) ? value : fallback;
      };
      const grant = Math.max(number('--fill', 1), number('--bleed', 1));
      const cell = slot.getBoundingClientRect();
      const spare = (size: number) => (size * (grant - 1)) / grant + 1;

      const pastCell = Math.max(
        (cell.left - a.left) - spare(a.right - a.left),
        (a.right - cell.right) - spare(a.right - a.left),
        (cell.top - a.top) - spare(a.bottom - a.top),
        (a.bottom - cell.bottom) - spare(a.bottom - a.top),
      );
      if (pastCell > 1) {
        problems.push({
          page: n,
          kind: 'artwork further past its cell than the page grants it',
          detail: `${Math.round(pastCell)}px beyond a ${grant.toFixed(2)} grant, ${where(img)}`,
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

    /* ------------------------------------------------- bare ground */

    /*
     * What actually prints, slot by slot and then page-wide.
     *
     * The artwork is measured as PAINTED, not as its box: the whole
     * point is that `object-fit: contain` leaves a margin inside the
     * box, and measuring the box would report exactly the space this
     * is looking for as covered. `painted` above already returns the
     * box itself for a `cover` image, which is right — that one fills
     * it and is cropped to it on purpose.
     */
    const inkOf = (root: Element): Box[] => {
      const found: Box[] = [];
      for (const img of root.querySelectorAll('.tile__media img')) {
        if (!(img as HTMLImageElement).naturalWidth) continue;
        found.push(plain(painted(img as HTMLImageElement)));
      }
      for (const sel of ['.price', '.tile__info', '.tile__tags']) {
        for (const part of root.querySelectorAll(sel)) {
          found.push(plain(part.getBoundingClientRect()));
        }
      }
      return found;
    };

    const furniture: Box[] = [];
    for (const sel of ['.page__masthead', '.page__foot', '.page__decor']) {
      for (const part of el.querySelectorAll(sel)) {
        furniture.push(plain(part.getBoundingClientRect()));
      }
    }

    const everything: Box[] = [...furniture];
    for (const slot of el.querySelectorAll('.slot')) {
      const tile = slot.querySelector('.tile');
      const parts = inkOf(slot);
      everything.push(...parts);
      boxes.push({
        page: n,
        slotId: (slot as HTMLElement).dataset['slotId'] ?? '?',
        role: [...(tile?.classList ?? [])]
          .find((c) => c.startsWith('tile--'))?.replace('tile--', '') ?? 'tom',
        // A wide feature crops its artwork to the box instead of
        // letterboxing it, so it is full by construction and its
        // coverage says nothing about the defect being hunted here.
        covers: (slot as HTMLElement).dataset['shape'] === 'band'
          && Boolean(tile?.classList.contains('tile--feature')),
        slot: plain(slot.getBoundingClientRect()),
        parts,
      });
    }
    pages.push({ page: n, bounds: plain(bounds), parts: everything });
  });

  return { problems, missing, boxes, pages };
});

const { problems, missing, boxes, pages } = findings;

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

/* ------------------------------------------------------- bar bund */

/*
 * How much of each sheet prints nothing, and where the worst of it is.
 *
 * Two numbers, because they answer two different complaints. Coverage
 * says how much ink the page carries; the largest empty rectangle says
 * whether what is missing is one hole or the ordinary margins around
 * twelve products. A page can be 70% covered and look broken because
 * the other 30% is a single band, and 60% covered and look right.
 *
 * Reported, not enforced — the thresholds come in their own commit,
 * once there are numbers from every chain to set them against. A check
 * that goes red the day it lands during unrelated work is a check
 * people learn to ignore.
 */
const ground = pages.map((sheet) => {
  const area = rectArea(sheet.bounds);
  const hole = largestEmptyRect(sheet.bounds, sheet.parts);
  return {
    page: sheet.page,
    covered: coverage(sheet.bounds, sheet.parts),
    hole: hole ? rectArea(hole) / area : 0,
    // Where to look on the proof. Percentages of the sheet, from its
    // top-left corner, because that is how you find it by eye.
    at: hole
      ? `${Math.round(((hole.left - sheet.bounds.left) / (sheet.bounds.right - sheet.bounds.left)) * 100)}%`
        + `,${Math.round(((hole.top - sheet.bounds.top) / (sheet.bounds.bottom - sheet.bounds.top)) * 100)}%`
      : '—',
  };
});

const pct = (value: number) => `${(value * 100).toFixed(1).padStart(5)}%`;

console.log('\nside  dækket  største tomme felt  hvor');
for (const sheet of ground) {
  console.log(`  ${String(sheet.page).padStart(2)}  ${pct(sheet.covered)}  ${pct(sheet.hole)}             ${sheet.at}`);
}

/*
 * The thinnest slots, which is where a fix has to start.
 *
 * A band feature is left out: it crops its artwork to the box rather
 * than letterboxing it, so it is full by construction and would always
 * take the top of this list for the wrong reason.
 */
const thin = boxes
  .filter((b) => !b.covers && rectArea(b.slot) > 0)
  .map((b) => ({ ...b, covered: coverage(b.slot, b.parts) }))
  .sort((a, b) => a.covered - b.covered)
  .slice(0, 5);
if (thin.length > 0) {
  console.log('\ntyndeste pladser');
  for (const slot of thin) {
    console.log(`  side ${slot.page} ${slot.slotId}/${slot.role}`.padEnd(28) + `${pct(slot.covered)} dækket`);
  }
}

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
