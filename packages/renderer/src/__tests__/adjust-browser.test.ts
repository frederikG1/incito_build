import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright';
import type { ImageAdjust } from '@incitio/schema';
import { adjustment, develop } from '../adjust.js';

/*
 * The browser's filter and `develop` must be the same arithmetic — the
 * histogram the studio shows is computed by one and the page is drawn by
 * the other. Every 8-bit value of every channel goes through Chromium
 * once, as a 256×3 strip, and is compared pixel for pixel.
 */
const W = 256;
const H = 3;

function strip(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let x = 0; x < W; x++) {
    out.set([x, 0, 0, 255], x * 4);
    out.set([0, x, 255 - x, 255], (W + x) * 4);
    out.set([x, 255 - x, (x * 7) % 256, 255], (2 * W + x) * 4);
  }
  return out;
}

let browser: Browser | null = null;
beforeAll(async () => {
  try { browser = await chromium.launch(); } catch { browser = null; }
});
afterAll(async () => { await browser?.close(); });

async function rendered(adjust: ImageAdjust): Promise<Uint8ClampedArray> {
  const page = await browser!.newPage({ deviceScaleFactor: 1 });
  const { style, defs } = adjustment(adjust);
  const css = Object.entries(style).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`).join(';');
  await page.setContent(`<body style="margin:0;background:#000">${defs ? renderToStaticMarkup(defs) : ''}<canvas id="c" width="${W}" height="${H}" style="display:block;${css}"></canvas></body>`);
  const pixels = await page.evaluate(({ data, w, h }) => {
    const c = document.getElementById('c') as HTMLCanvasElement;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    return null;
  }, { data: Array.from(strip()), w: W, h: H });
  void pixels;
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  const out = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
  await page.close();
  return new Uint8ClampedArray(out);
}

const CASES: [string, ImageAdjust][] = [
  ['exposure + contrast', { exposure: 0.7, contrast: 0.35 }],
  ['brightness + levels', { brightness: -0.4, levels: { black: 0.1, white: 0.85, gamma: 1.4, outBlack: 0.05, outWhite: 0.95 } }],
  ['curves per channel', { curves: { rgb: [[0, 0], [0.5, 0.65], [1, 1]], b: [[0, 0.1], [1, 0.8]] } }],
  ['hue + saturation + lightness', { hue: 70, saturation: 0.5, lightness: -0.2 }],
];

describe.skipIf(process.env.CI_NO_BROWSER)('the browser draws what develop computes', () => {
  for (const [name, adjust] of CASES) {
    it(name, async () => {
      if (!browser) return void console.warn("no Chromium — skipped");
      const want = develop(strip(), W, H, adjust);
      const got = await rendered(adjust);
      let worst = 0;
      for (let i = 0; i < want.length; i++) {
        if (i % 4 === 3) continue;
        worst = Math.max(worst, Math.abs(want[i]! - got[i]!));
      }
      expect(worst).toBeLessThanOrEqual(2);
    }, 20000);
  }
});
