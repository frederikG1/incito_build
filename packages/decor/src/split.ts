import { chromium, type Browser } from 'playwright';
import { generateJson, type GeminiOptions, type GeneratedImage } from './gemini.js';

/**
 * One picture of several variants, as one cutout per variant.
 *
 * A leaflet often photographs "Coop vaskemiddel" as three bottles in one
 * packshot — one offer, one price, three variants in a single image.
 * Everything that arranges a cluster works on separate cutouts, one per
 * product, so a tile like that could be moved and scaled as a whole but
 * never stood up. This finds each package in the picture (a vision
 * model answers with boxes, never pixels) and cuts it out, so the tile
 * becomes an ordinary cluster.
 *
 * Packages that overlap in the photograph overlap in their crops too: a
 * crop is a rectangle, and the neighbour's shoulder comes with it. The
 * arrangement puts them side by side again, which is usually where they
 * were anyway.
 */

export interface VariantBox {
  /** The variant as the pack names it — "Color", "White". */
  name: string;
  /** Shares of the picture, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short variant label printed on this pack, e.g. "Color". Max 3 words.' },
          ymin: { type: 'integer' },
          xmin: { type: 'integer' },
          ymax: { type: 'integer' },
          xmax: { type: 'integer' },
        },
        required: ['name', 'ymin', 'xmin', 'ymax', 'xmax'],
      },
    },
  },
  required: ['products'],
} as const;

function promptFor(expected: number | null): string {
  return `This is a supermarket packshot: several products photographed together
for one offer — variants of the same brand, often overlapping each other.

Return one entry per separate physical container — each bottle, box, bag,
jar, can or tray is its own entry, EVEN WHEN they share a brand and design.
Work left to right.${expected ? `

The picture is known to be composed of exactly ${expected} separate product
photographs, so there are ${expected} containers. Find all ${expected}.` : ''}

The box must enclose the WHOLE container, including any part hidden behind
a neighbour, in coordinates 0-1000 of the image. No boxes for shadows,
loose labels or background.

"name" is the short variant label printed on that container ("Color",
"Pure Senses", "Jordbær"), in the pack's own language.`;
}

/**
 * The models tried, in order. The second and third are there because a
 * busy or over-cautious model answering "one product" is the commonest
 * failure, and a different model rarely makes the same mistake.
 */
const MODELS = ['', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'];

export async function findVariants(
  image: GeneratedImage,
  options: GeminiOptions & { expected?: number | null } = {},
): Promise<{ boxes: VariantBox[]; usage?: { input: number; output: number } }> {
  type Row = { name: string; ymin: number; xmin: number; ymax: number; xmax: number };
  const want = Math.max(2, options.expected ?? 2);
  let best: VariantBox[] = [];
  let usage: { input: number; output: number } | undefined;
  let lastError: unknown = null;

  for (const model of MODELS) {
    try {
      const answer = await generateJson<{ products: Row[] }>(
        promptFor(options.expected ?? null),
        SCHEMA,
        {
          ...options,
          ...(model ? { model } : {}),
          timeoutMs: options.timeoutMs ?? 60_000,
        },
        [image],
      );
      usage = answer.usage ?? usage;
      const boxes = (answer.value.products ?? [])
        .map((row) => {
          const clamp = (v: number) => Math.min(1000, Math.max(0, Number(v) || 0)) / 1000;
          const x0 = clamp(Math.min(row.xmin, row.xmax));
          const x1 = clamp(Math.max(row.xmin, row.xmax));
          const y0 = clamp(Math.min(row.ymin, row.ymax));
          const y1 = clamp(Math.max(row.ymin, row.ymax));
          return { name: String(row.name ?? '').trim().slice(0, 40), x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        })
        // A box a few percent wide is the model pointing at nothing.
        .filter((box) => box.w > 0.03 && box.h > 0.03)
        .sort((a, b) => a.x - b.x)
        .slice(0, 8);
      if (boxes.length > best.length) best = boxes;
      if (best.length >= want) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (best.length === 0 && lastError) throw lastError;
  return { boxes: best, ...(usage ? { usage } : {}) };
}

/**
 * How many product photographs a Tjek image-transformer URL composes.
 *
 * A multi-variant packshot is not one photograph: the transformer lays
 * several out side by side and its `u` parameter lists them, comma
 * separated. That count is the truth the model is asked to find.
 */
export function composedCount(url: string): number | null {
  try {
    const u = new URL(url).searchParams.get('u');
    const count = u ? u.split(',').filter(Boolean).length : 0;
    return count > 1 ? count : null;
  } catch {
    return null;
  }
}

/**
 * Cut each box out of the picture as a PNG, a little generous so a pack
 * the model boxed tight does not lose its cap.
 */
export async function cropBoxes(
  image: GeneratedImage,
  boxes: VariantBox[],
  options: { browser?: Browser; pad?: number } = {},
): Promise<Buffer[]> {
  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage();
  try {
    const src = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
    const pad = options.pad ?? 0.015;
    const out = await page.evaluate(async ({ src, boxes, pad }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      return boxes.map((box) => {
        const x0 = Math.max(0, Math.floor((box.x - pad) * W));
        const y0 = Math.max(0, Math.floor((box.y - pad) * H));
        const x1 = Math.min(W, Math.ceil((box.x + box.w + pad) * W));
        const y1 = Math.min(H, Math.ceil((box.y + box.h + pad) * H));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, x1 - x0);
        canvas.height = Math.max(1, y1 - y0);
        canvas.getContext('2d')!.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        return canvas.toDataURL('image/png').split(',')[1]!;
      });
    }, { src, boxes, pad });
    return out.map((data) => Buffer.from(data, 'base64'));
  } finally {
    await page.close();
    if (!options.browser) await browser.close();
  }
}

/**
 * The products in a picture found from its own pixels — no model.
 *
 * A packshot with a transparent or plain white background shows each
 * package as an island of ink. Islands are found on a coarse grid (a
 * 120px-wide copy of the picture) and grown back to full size; anything
 * smaller than a few percent of the ink is a crumb, not a product. Two
 * packages that touch or overlap come back as one island, which is
 * what the model is for — this is the reserve, and it is exact where
 * it works.
 */
export async function findIslands(
  image: GeneratedImage,
  options: { browser?: Browser } = {},
): Promise<VariantBox[]> {
  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage();
  try {
    const src = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
    return await page.evaluate(async ({ src }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const W = 120;
      const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      // Ink: anything not transparent and not near-white.
      const ink = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p += 1) {
        const a = d[p * 4 + 3]!;
        const light = d[p * 4]! > 242 && d[p * 4 + 1]! > 242 && d[p * 4 + 2]! > 242;
        ink[p] = a > 40 && !light ? 1 : 0;
      }
      const seen = new Uint8Array(W * H);
      const islands: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
      let total = 0;
      for (let start = 0; start < W * H; start += 1) {
        if (!ink[start] || seen[start]) continue;
        const box = { x0: W, y0: H, x1: 0, y1: 0, n: 0 };
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          const x = p % W;
          const y = (p - x) / W;
          box.n += 1;
          box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
          box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        total += box.n;
        islands.push(box);
      }
      return islands
        .filter((box) => box.n > total * 0.04)
        .map((box) => ({
          name: '',
          x: box.x0 / W,
          y: box.y0 / H,
          w: (box.x1 - box.x0 + 1) / W,
          h: (box.y1 - box.y0 + 1) / H,
        }))
        .sort((a, b) => a.x - b.x)
        .slice(0, 8);
    }, { src });
  } finally {
    await page.close();
    if (!options.browser) await browser.close();
  }
}
