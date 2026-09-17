/**
 * Read a published leaflet PDF and report the grid under it.
 *
 *   npm run reference -- ~/Downloads/uge38.pdf --page 1
 *   npm run reference -- ~/Downloads/uge38.pdf --pages 1-6 --out .data/reference/sb-w38
 *   npm run reference -- ~/Downloads/uge38.pdf --page 1 --overlay
 *
 * This is the deterministic half of reading a reference. Nothing here
 * calls a model, nothing here is a screenshot, and the same file gives
 * the same answer every time — which is the whole reason the geometry
 * moved out of a prompt and into a package.
 *
 * `--overlay` renders the page and draws the blocks on top of it, which
 * is the only honest way to check a layout reader: the numbers always
 * look plausible, and a picture of them does not.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { blocks, gridOf, readPage } from '@incitio/reference';
import type { Block, PdfjsLike, ReferencePage } from '@incitio/reference';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('brug: npm run reference -- <fil.pdf> [--page 1] [--pages 1-6] [--out sti] [--overlay]');
  process.exit(1);
}

const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1]!.startsWith('--') ? args[at + 1] : undefined;
};

const pages = (() => {
  const spec = flag('pages') ?? flag('page') ?? '1';
  const [from, to] = spec.split('-').map((n) => Number.parseInt(n, 10));
  if (!from) return [1];
  return Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
})();

/*
 * pdf.js is loaded here rather than imported by the package.
 *
 * It is a peer dependency for a reason — see `PdfjsLike` — and the
 * legacy build is the one that runs in Node without a DOM. Loaded once,
 * handed in, so the package itself stays free of it and testable
 * without a PDF anywhere in sight.
 */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfjsLike;
const path = resolve(process.cwd(), file);
/*
 * Read fresh on every call. pdf.js TRANSFERS the array it is handed to
 * its worker, which leaves the copy here detached — a second use of the
 * same bytes dies with "detached ArrayBuffer" one page later.
 */
const bytes = () => new Uint8Array(readFileSync(path));

const say = (label: string, value: string) => console.log(`${label.padEnd(11)}${value}`);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** What a block is, as far as geometry alone can tell. */
function shape(block: Block): string {
  const parts = [
    block.images > 0 ? `${block.images} billeder` : '',
    block.texts > 0 ? `${block.texts} tekster` : '',
    block.maxTextSize > 0 ? `${block.maxTextSize.toFixed(0)}pt` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

const out = flag('out');
const readings: ReferencePage[] = [];

for (const page of pages) {
  const reading = await readPage(pdfjs, { data: bytes() }, page);
  readings.push(reading);

  const kinds = reading.items.reduce<Record<string, number>>((count, item) => {
    count[item.kind] = (count[item.kind] ?? 0) + 1;
    return count;
  }, {});

  console.log(`\n── side ${page} ${'─'.repeat(40)}`);
  say('ark', `${reading.width.toFixed(0)} × ${reading.height.toFixed(0)} pt`);
  say('kasser', Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', '));

  const found = blocks(reading);
  say('blokke', String(found.length));

  const grid = gridOf(reading);
  if (!grid) {
    say('gitter', 'ingen — blokkenes kanter falder ikke på et fælles gitter');
  } else {
    say('gitter', `${grid.columns} × ${grid.rows}, afvigelse ${pct(grid.fit)}`);
    for (const row of grid.areas) console.log(`            "${row}"`);
  }

  console.log('');
  // Same letters the grid uses, so a row of `areas` can be read against
  // the list below it. A block the grid left out — a masthead, a footer
  // band — is marked rather than renumbered, because "which blocks are
  // not offers" is the question a person checking this actually has.
  const ids = new Map((grid?.slots ?? []).map((slot) => [slot.block, slot.id]));
  found.forEach((block) => {
    const { x, y, w, h } = block.rect;
    console.log(
      `  ${(ids.get(block) ?? '·').padEnd(2)} ${pct(x).padStart(6)} ${pct(y).padStart(6)}`
      + `  ${pct(w).padStart(6)} × ${pct(h).padStart(6)}`
      + `  ${shape(block).padEnd(28)} ${block.text.slice(0, 44)}`,
    );
  });

  if (out) {
    const path = resolve(process.cwd(), `${out}-p${String(page).padStart(2, '0')}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...reading, grid }, null, 2)}\n`);
    say('skrev', path);
  }
}

/*
 * The picture, when asked for.
 *
 * Rendered through the same pdf.js in a real browser and drawn on with
 * the blocks this run found — so what is checked is the reading, not a
 * second implementation of it.
 */
if (args.includes('--overlay')) {
  const { chromium } = await import('playwright');
  const lib = readFileSync('node_modules/pdfjs-dist/build/pdf.min.mjs', 'utf8');
  const worker = readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'utf8');
  const browser = await chromium.launch();

  for (const reading of readings) {
    const page = await browser.newPage({ viewportSize: { width: 900, height: 1300 } });
    await page.setContent(`<canvas id="c"></canvas><script type="module">${lib}\nwindow.pdfjsLib = pdfjsLib;</script>`);
    await page.addScriptTag({ content: `window.__worker = ${JSON.stringify(worker)};` });
    await page.evaluate(async ([bytes, n]) => {
      const api = (window as unknown as { pdfjsLib: PdfjsLike & { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
      api.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
        new Blob([(window as unknown as { __worker: string }).__worker], { type: 'text/javascript' }),
      );
      const doc = await api.getDocument({ data: Uint8Array.from(bytes as number[]) }).promise;
      const sheet = await doc.getPage(Number(n)) as unknown as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void> };
      };
      const view = sheet.getViewport({ scale: 1.4 });
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      canvas.width = view.width;
      canvas.height = view.height;
      await sheet.render({ canvasContext: canvas.getContext('2d'), viewport: view, canvas }).promise;
    }, [[...bytes()], String(reading.page)] as [number[], string]);

    await page.evaluate((found: { rect: { x: number; y: number; w: number; h: number } }[]) => {
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      ctx.lineWidth = 3;
      found.forEach((block, index) => {
        const { x, y, w, h } = block.rect;
        ctx.strokeStyle = '#2d6cdf';
        ctx.strokeRect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height);
        ctx.fillStyle = '#2d6cdf';
        ctx.fillRect(x * canvas.width, y * canvas.height - 22, 26, 22);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px system-ui';
        ctx.fillText('abcdefghijklmnopqrstuvwxyz'[index % 26]!, x * canvas.width + 8, y * canvas.height - 6);
      });
    }, blocks(reading).map((b) => ({ rect: b.rect })));

    const path = resolve(process.cwd(), `${out ?? '.data/reference/overlay'}-p${String(reading.page).padStart(2, '0')}.png`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, await page.locator('#c').screenshot());
    say('tegnede', path);
    await page.close();
  }
  await browser.close();
}
