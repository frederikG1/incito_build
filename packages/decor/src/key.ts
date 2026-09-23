import { chromium, type Browser } from 'playwright';
import type { GeneratedImage } from './gemini.js';

/**
 * The motifs out of a page picture painted on one flat colour.
 *
 * The brief asks for the page's own colour, flat, with the motif lying
 * on it. So the colour is known, and everything connected to the
 * border that is near it is ground: it goes. Near, not equal — the
 * model's flat is never exact, and the soft shadow it lays under each
 * object is that same colour darker. So the ground is unmixed rather
 * than cut: a pixel is read as `alpha · colour + (1 − alpha) · ground`,
 * which turns the shadow into a real, see-through shadow that works on
 * whatever background the page actually has.
 *
 * Then each group of objects that is left becomes its own picture with
 * its own box on the page, so each can be moved by itself.
 */
export interface KeyedMotif {
  png: Buffer;
  /** Where it sat on the page, in percent. */
  box: { x0: number; x1: number; y0: number; y1: number };
  width: number;
  height: number;
}

export async function keyOutMotifs(
  image: GeneratedImage,
  options: { browser?: Browser; max?: number } = {},
): Promise<KeyedMotif[]> {
  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage();
  try {
    const src = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
    const found = await page.evaluate(async ({ src, max }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const W = img.naturalWidth; const H = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, W, H);
      const d = data.data;

      // The ground: the median of the border ring, per channel.
      const ring: number[][] = [[], [], []];
      const sample = (x: number, y: number) => {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c += 1) ring[c]!.push(d[i + c]!);
      };
      for (let x = 0; x < W; x += 4) { sample(x, 0); sample(x, H - 1); }
      for (let y = 0; y < H; y += 4) { sample(0, y); sample(W - 1, y); }
      const g = ring.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!);

      const dist = (i: number) => Math.hypot(d[i]! - g[0]!, d[i + 1]! - g[1]!, d[i + 2]! - g[2]!);
      const gg = g[0]! * g[0]! + g[1]! * g[1]! + g[2]! * g[2]!;
      /*
       * How far a pixel is the ground darkened: the same colour scaled
       * down, which is what a shadow on it is. `null` when it is not.
       */
      const shade = (i: number): number | null => {
        const scale = (d[i]! * g[0]! + d[i + 1]! * g[1]! + d[i + 2]! * g[2]!) / Math.max(1, gg);
        const off = Math.hypot(d[i]! - scale * g[0]!, d[i + 1]! - scale * g[1]!, d[i + 2]! - scale * g[2]!);
        return scale < 1 && off < 28 ? scale : null;
      };
      // Ground outright. Tight: a pale object must never read as ground.
      const NEAR = 22;

      /*
       * The background: flooded from the border through ground and
       * shadow only. Everything it does not reach is the motif, and the
       * motif stays fully opaque — the earlier version gave partial
       * transparency to anything NEAR the ground colour, and a pale
       * chopping board on a pale blue page came out see-through.
       */
      const back = new Uint8Array(W * H);
      const stack: number[] = [];
      const push = (p: number) => {
        if (back[p]) return;
        const i = p * 4;
        if (dist(i) > NEAR && shade(i) === null) return;
        back[p] = 1;
        stack.push(p);
      };
      for (let x = 0; x < W; x += 1) { push(x); push((H - 1) * W + x); }
      for (let y = 0; y < H; y += 1) { push(y * W); push(y * W + W - 1); }
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % W; const y = (p - x) / W;
        if (x > 0) push(p - 1);
        if (x < W - 1) push(p + 1);
        if (y > 0) push(p - W);
        if (y < H - 1) push(p + W);
      }

      for (let p = 0; p < W * H; p += 1) {
        const i = p * 4;
        if (back[p]) {
          const k = shade(i);
          if (dist(i) <= NEAR || k === null) { d[i + 3] = 0; continue; }
          // A shadow: black, as strong as it darkens — right on any page.
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
          d[i + 3] = Math.round(Math.min(1, (1 - k) * 1.1) * 255);
          continue;
        }
        /*
         * The motif's own edge, one pixel deep: blended with the ground
         * by the painter's anti-aliasing, so unmixed to a soft edge
         * rather than left as a pale fringe.
         */
        const x = p % W; const y = (p - x) / W;
        const edge = (x > 0 && back[p - 1]) || (x < W - 1 && back[p + 1])
          || (y > 0 && back[p - W]) || (y < H - 1 && back[p + W]);
        if (!edge) continue;
        const a = Math.min(1, Math.max(0.35, (dist(i) - NEAR) / 60));
        for (let c = 0; c < 3; c += 1) {
          d[i + c] = Math.max(0, Math.min(255, (d[i + c]! - (1 - a) * g[c]!) / a));
        }
        d[i + 3] = Math.round(a * 255);
      }
      ctx.putImageData(data, 0, 0);

      // Groups: islands of solid pixels on a coarse grid.
      const G = 160;
      const gh = Math.max(1, Math.round((H / W) * G));
      const cell = W / G;
      const solid = new Uint8Array(G * gh);
      for (let gy = 0; gy < gh; gy += 1) {
        for (let gx = 0; gx < G; gx += 1) {
          const x = Math.min(W - 1, Math.floor((gx + 0.5) * cell));
          const y = Math.min(H - 1, Math.floor((gy + 0.5) * (H / gh)));
          solid[gy * G + gx] = d[(y * W + x) * 4 + 3]! > 140 ? 1 : 0;
        }
      }
      const seen = new Uint8Array(G * gh);
      const boxes: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
      for (let start = 0; start < G * gh; start += 1) {
        if (!solid[start] || seen[start]) continue;
        const box = { x0: G, y0: gh, x1: 0, y1: 0, n: 0 };
        const todo = [start];
        seen[start] = 1;
        while (todo.length) {
          const p = todo.pop()!;
          const x = p % G; const y = (p - x) / G;
          box.n += 1;
          box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
          box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
          // Eight-way and one cell of slack: crumbs of one motif stay one.
          for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
              const nx = x + dx; const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= G || ny >= gh) continue;
              const q = ny * G + nx;
              if (solid[q] && !seen[q]) { seen[q] = 1; todo.push(q); }
            }
          }
        }
        boxes.push(box);
      }
      const total = G * gh;
      const kept = boxes
        .filter((box) => box.n > total * 0.004)
        // A crumb at the sheet's very edge is not a motif.
        .filter((box) => box.n > total * 0.012 || (box.x0 > 1 && box.y0 > 1 && box.x1 < G - 2 && box.y1 < gh - 2))
        .sort((a, b) => b.n - a.n)
        .slice(0, max);

      // Each group cut out, a little generous so its shadow comes along.
      return kept.map((box) => {
        // Wide enough that a soft shadow ends inside the picture.
        const pad = 8;
        const x0 = Math.max(0, Math.floor((box.x0 - pad) * cell));
        const y0 = Math.max(0, Math.floor((box.y0 - pad) * (H / gh)));
        const x1 = Math.min(W, Math.ceil((box.x1 + 1 + pad) * cell));
        const y1 = Math.min(H, Math.ceil((box.y1 + 1 + pad) * (H / gh)));
        const out = document.createElement('canvas');
        out.width = x1 - x0; out.height = y1 - y0;
        const octx = out.getContext('2d')!;
        octx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        // And whatever still reaches the edge fades out, never a cut line.
        const feather = Math.max(4, Math.round(Math.min(out.width, out.height) * 0.06));
        const px = octx.getImageData(0, 0, out.width, out.height);
        for (let y = 0; y < out.height; y += 1) {
          for (let x = 0; x < out.width; x += 1) {
            const edge = Math.min(x, y, out.width - 1 - x, out.height - 1 - y);
            if (edge >= feather) continue;
            const i = (y * out.width + x) * 4 + 3;
            px.data[i] = Math.round(px.data[i]! * (edge / feather));
          }
        }
        octx.putImageData(px, 0, 0);
        return {
          data: out.toDataURL('image/png').split(',')[1]!,
          box: { x0: (x0 / W) * 100, x1: (x1 / W) * 100, y0: (y0 / H) * 100, y1: (y1 / H) * 100 },
          width: x1 - x0,
          height: y1 - y0,
        };
      });
    }, { src, max: options.max ?? 4 });
    return found.map((entry) => ({
      png: Buffer.from(entry.data, 'base64'), box: entry.box, width: entry.width, height: entry.height,
    }));
  } finally {
    await page.close();
    if (!options.browser) await browser.close();
  }
}
