/**
 * How much bare ground a chain's OWN printed pages carry.
 *
 *   npm run measure:ground
 *   npm run measure:ground -- --brand superbrugsen
 *
 * `npm run check` measures the same thing on a generated page. Without
 * this, the threshold it compares against would be a number somebody
 * felt was about right — and the whole complaint being answered here is
 * "there is more air than in the real thing", which is a comparison, not
 * an absolute. So the real thing gets measured too, and its number is
 * the target.
 *
 * Reads `.data/reference/<chain>/*.jpg`, which `npm run refs` fetches
 * and git ignores. Writes `data/density/<chain>.json`, which is
 * committed: the measurement is the artefact, the scans are not.
 *
 * Ink is anything that is not the page's field. The field is sampled
 * from the margins with `sampleGroundPalette` — the same measurement
 * that gives a rebuilt page its background — and it is a PALETTE rather
 * than one colour because a printed field is not flat: SuperBrugsen
 * tiles a flower motif over cream, and counting the motif as product
 * would report an almost empty page as almost full.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { largestEmptyCells, type CellRect } from '@incitio/renderer';
import { mediaType, sampleGroundPalette } from '@incitio/match';
import { listBrands } from '@incitio/brands';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};

/**
 * The grid both sides are reduced to.
 *
 * Pinned against the exact geometry in `measure.test.ts`: at this
 * resolution the sampled answer lands within 2% of the area the exact
 * measure gives for the same layout. Finer buys nothing a threshold
 * could use; coarser starts losing a band.
 */
const COLUMNS = 100;

/** How far a pixel may sit from the field before it counts as product. */
const TOLERANCE = 48;

const refRoot = fileURLToPath(new URL('.data/reference', ROOT));
const wanted = flag('brand');
const chains = (existsSync(refRoot) ? readdirSync(refRoot, { withFileTypes: true }) : [])
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => (wanted ? name === wanted : listBrands().some((b) => b.id === name)));

if (chains.length === 0) {
  console.error(
    wanted
      ? `ingen referencesider i .data/reference/${wanted} — kør npm run refs`
      : 'ingen referencesider i .data/reference — kør npm run refs',
  );
  process.exit(1);
}

const browser = await chromium.launch();
const outDir = fileURLToPath(new URL('data/density', ROOT));
mkdirSync(outDir, { recursive: true });

try {
  for (const chain of chains) {
    const dir = `${refRoot}/${chain}`;
    const files = readdirSync(dir)
      .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
      .sort();

    console.log(`\n${chain} — ${files.length} trykte sider`);
    console.log('side        dækket  største tomme felt  bund');

    const measured: {
      page: string; covered: number; hole: number; ground: string[];
    }[] = [];

    for (const name of files) {
      const bytes = readFileSync(`${dir}/${name}`);
      const type = mediaType(bytes);
      const palette = await sampleGroundPalette(browser, bytes, type);

      const tab = await browser.newPage();
      let grid: boolean[][];
      let aspect: number;
      try {
        await tab.goto('about:blank');
        ({ grid, aspect } = await tab.evaluate(async (input) => {
          const img = new Image();
          img.src = input.dataUrl;
          await img.decode();
          const canvas = window.document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          const { width: w, height: h } = canvas;
          const rows = Math.max(1, Math.round((input.columns * h) / w));

          const field = input.palette.map((hex) => [
            Number.parseInt(hex.slice(1, 3), 16),
            Number.parseInt(hex.slice(3, 5), 16),
            Number.parseInt(hex.slice(5, 7), 16),
          ]);

          /*
           * One cell is ink when MOST of the pixels sampled in it are
           * far from every field colour. Most, not any: a halftone
           * screen and a JPEG's own ringing put stray dark pixels all
           * over a flat field, and "any" would paint the whole page as
           * product.
           */
          const cells: boolean[][] = [];
          const cw = w / input.columns;
          const ch = h / rows;
          const probes = [0.25, 0.5, 0.75];
          for (let y = 0; y < rows; y += 1) {
            const row: boolean[] = [];
            for (let x = 0; x < input.columns; x += 1) {
              let far = 0;
              let seen = 0;
              for (const py of probes) {
                for (const px of probes) {
                  const sx = Math.min(w - 1, Math.floor((x + px) * cw));
                  const sy = Math.min(h - 1, Math.floor((y + py) * ch));
                  const [r, g, b] = ctx.getImageData(sx, sy, 1, 1).data;
                  seen += 1;
                  const near = field.some(([fr, fg, fb]) => Math.hypot(
                    r! - fr!, g! - fg!, b! - fb!,
                  ) <= input.tolerance);
                  if (!near) far += 1;
                }
              }
              row.push(far * 2 > seen);
            }
            cells.push(row);
          }
          return { grid: cells, aspect: w / h };
        }, {
          dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
          palette,
          columns: COLUMNS,
          tolerance: TOLERANCE,
        }));
      } finally {
        await tab.close();
      }

      const total = grid.length * (grid[0]?.length ?? 0);
      const inked = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
      const hole: CellRect | null = largestEmptyCells(grid);
      const covered = total > 0 ? inked / total : 1;
      const holeShare = hole && total > 0 ? (hole.width * hole.height) / total : 0;

      measured.push({
        page: name,
        covered,
        hole: holeShare,
        ground: palette,
      });
      const pct = (value: number) => `${(value * 100).toFixed(1).padStart(5)}%`;
      console.log(
        `${name.padEnd(12)}${pct(covered)}  ${pct(holeShare)}             `
        + `${palette[0]}  (${aspect.toFixed(2)})`,
      );
    }

    /*
     * The median, not the mean.
     *
     * Every book carries a page that is one photograph and a page that
     * is a wall of terms and conditions. Those are real pages and they
     * are not what an offers page should be measured against, and a
     * mean lets either of them move the target.
     */
    const middle = <T>(values: T[]): T => [...values].sort()[Math.floor(values.length / 2)]!;
    const summary = {
      brand: chain,
      pages: measured.length,
      measuredAt: new Date().toISOString().slice(0, 10),
      grid: { columns: COLUMNS, tolerance: TOLERANCE },
      covered: {
        median: middle(measured.map((m) => m.covered)),
        worst: Math.min(...measured.map((m) => m.covered)),
      },
      hole: {
        median: middle(measured.map((m) => m.hole)),
        worst: Math.max(...measured.map((m) => m.hole)),
      },
      page: measured,
    };

    const file = `${outDir}/${chain}.json`;
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `\nmedian     ${(summary.covered.median * 100).toFixed(1)}% dækket, `
      + `største tomme felt ${(summary.hole.median * 100).toFixed(1)}%`,
    );
    console.log(`skrev      data/density/${chain}.json`);
  }
} finally {
  await browser.close();
}
