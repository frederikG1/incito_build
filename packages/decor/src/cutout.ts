import { chromium, type Browser } from 'playwright';

/**
 * Knock the white field out of a generated image.
 *
 * The artwork arrives on a plain white background because `imagePrompt`
 * demands one, and a white square pasted onto SuperBrugsen's sand or
 * Netto's yellow reads as a bug. So the field has to go.
 *
 * Done in Chromium, through Playwright, and that is not a workaround:
 * this pipeline already launches Chromium to draw every page, so the one
 * dependency is paid for. It also buys a PNG encoder, an alpha channel
 * and a decoder for whatever the model returns, none of which Node has —
 * the alternative was `sharp`, a native build, to do arithmetic the
 * browser already does.
 *
 * FLOOD FILL FROM THE EDGES, not a global "white is transparent".
 * The difference matters on exactly the images this generates: the white
 * of a halved egg, the shine on an almond, the sugar on a pastry are all
 * near-white and all MUST stay. Only white reachable from the border
 * without crossing the subject is background, which is what the prompt's
 * "clear margin on all four sides" guarantees.
 */

export interface CutoutOptions {
  browser?: Browser;
  /**
   * Luminance above which a pixel may be background, 0–255. Generated
   * white fields sit at 250+; 236 leaves room for the faint grey the
   * model sometimes lays down without eating a pale subject.
   */
  threshold?: number;
  /** Trim the transparent border afterwards. */
  trim?: boolean;
}

export interface CutoutResult {
  bytes: Buffer;
  width: number;
  height: number;
  /** Share of the image that survived, 0–1. Near 1 means nothing was cut. */
  kept: number;
  /**
   * The luminance the fill actually cut at.
   *
   * Derived from the image's own border unless that border is too dark
   * to be a field — see the note in the fill. Reported because "nothing
   * was removed" and "nothing COULD be removed" look the same from
   * outside and are different problems.
   */
  threshold: number;
}

/**
 * Returns a PNG with an alpha channel.
 *
 * `kept` is the honest part: if the model ignores the white-background
 * instruction the flood fill finds nothing and this returns the image
 * essentially unchanged, which the caller can notice rather than
 * discovering it on a printed page.
 */
export async function cutout(
  image: Buffer,
  mimeType: string,
  options: CutoutOptions = {},
): Promise<CutoutResult> {
  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage();
  try {
    const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`;
    const result = await page.evaluate(async ({ src, threshold, trim }) => {
      const img = new Image();
      img.src = src;
      await img.decode();

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const image = ctx.getImageData(0, 0, w, h);
      const d = image.data;

      const lum = (i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

      /*
       * The threshold, read off the border rather than assumed.
       *
       * A fixed cut is right for artwork this pipeline GENERATED — the
       * prompt demands a pure white field and the model delivers 250+.
       * It is wrong for a chain's own photograph, and measurably so: a
       * packshot off a white sweep arrives as a JPEG, and JPEG ringing
       * puts the 8×8 block edges a level or two below the neighbouring
       * white. Measured on a real upload, the surviving background sat
       * at luminance 235-236 against a threshold of 236 — so a fifth of
       * the sweep stayed behind as a fine dash pattern, which is
       * exactly what it looked like on the page.
       *
       * So: sample the border ring, and take a low percentile of it as
       * how dark this particular background actually gets. The 5th
       * rather than the minimum, because a subject that touches the
       * edge would otherwise drag the whole cut down with it.
       *
       * Only when the border really IS a light field. A product
       * photographed on a table has a dark border, and adapting to that
       * would flood the fill straight through the picture; there the
       * fixed cut stands, finds nothing, and `kept` reports it honestly.
       * The floor is the same guard from the other side.
       */
      const ring: number[] = [];
      for (let x = 0; x < w; x += 1) { ring.push(lum((x) * 4), lum(((h - 1) * w + x) * 4)); }
      for (let y = 0; y < h; y += 1) { ring.push(lum((y * w) * 4), lum((y * w + w - 1) * 4)); }
      ring.sort((a, b) => a - b);
      const at = (f: number) => ring[Math.min(ring.length - 1, Math.floor(ring.length * f))] ?? 255;
      const median = at(0.5);
      // 3 below the border's own low water mark: enough to take the
      // noise, not enough to reach a subject the sample already excluded.
      const cut = median >= 225
        ? Math.max(200, Math.min(threshold, at(0.05) - 3))
        : threshold;

      /*
       * Breadth-first from every border pixel. An explicit stack rather
       * than recursion: a 1024² field is a million pixels and the call
       * stack does not survive that.
       */
      const bg = new Uint8Array(w * h);
      const stack: number[] = [];
      const push = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = y * w + x;
        if (bg[p]) return;
        if (lum(p * 4) < cut) return;
        bg[p] = 1;
        stack.push(p);
      };
      for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
      for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % w;
        const y = (p / w) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }

      /*
       * Feather, or the subject keeps a white rind.
       *
       * A hard cut leaves the anti-aliased pixels the generator drew
       * against white — which are themselves nearly white — sitting on
       * the chain's colour as a bright halo. A kept pixel that borders
       * the background therefore fades out over how close to white it
       * is, which is the same ramp the generator used going in.
       */
      const soft = cut - 46;
      let kept = 0;
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (bg[p]) { d[i + 3] = 0; continue; }
        kept += 1;
        const x = p % w;
        const y = (p / w) | 0;
        const edge = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1])
          || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w]);
        if (!edge) continue;
        const l = lum(i);
        if (l <= soft) continue;
        d[i + 3] = Math.round(255 * (1 - (l - soft) / (cut - soft)));
      }

      // Bounding box of what survived, so the artwork can be positioned
      // by its subject rather than by the model's framing.
      let minX = w; let minY = h; let maxX = -1; let maxY = -1;
      if (trim) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!trim || maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }

      ctx.putImageData(image, 0, 0);
      const out = document.createElement('canvas');
      out.width = maxX - minX + 1;
      out.height = maxY - minY + 1;
      out.getContext('2d')!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);

      return {
        url: out.toDataURL('image/png'),
        width: out.width,
        height: out.height,
        kept: kept / (w * h),
        // What the fill actually used, so a caller can say why a
        // picture came back uncut instead of guessing.
        threshold: cut,
      };
    }, {
      src: dataUrl,
      threshold: options.threshold ?? 236,
      trim: options.trim ?? true,
    });

    return {
      bytes: Buffer.from(result.url.slice(result.url.indexOf(',') + 1), 'base64'),
      width: result.width,
      height: result.height,
      kept: result.kept,
      threshold: result.threshold,
    };
  } finally {
    await page.close();
    if (!options.browser) await browser.close();
  }
}

/* ------------------------------------------------- one Chromium, kept */

let shared: Promise<Browser> | null = null;

/**
 * One Chromium for the whole process, launched on first use.
 *
 * `cutout` launches its own when nobody hands it one, which is right
 * for a script that runs once and exits. It is wrong for the server:
 * a launch is the better part of a second, it is paid on EVERY composed
 * picture, and a page whose six clusters are composed at the same time
 * would start six browsers to do six flood fills. So a long-lived
 * caller asks for this one and passes it in.
 *
 * Deliberately not the default inside `cutout`: a browser held open
 * keeps the event loop alive, and `npm run decorate` would stop
 * exiting.
 */
export async function sharedBrowser(): Promise<Browser> {
  if (!shared) {
    shared = chromium.launch().then((browser) => {
      // A crashed browser must not be handed out for the rest of the
      // process's life.
      browser.on('disconnected', () => { shared = null; });
      return browser;
    }).catch((error: unknown) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}

