import type { Browser } from 'playwright';

/**
 * Two page images, compared pixel by pixel.
 *
 * Done in the Chromium the renderer already runs, on a canvas, so the
 * repository needs no image library: PNG decoding is the browser's, and
 * the browser is what drew the page in the first place.
 *
 * `threshold` is how far a pixel's channels may move (0–1 of full scale)
 * before it counts — 0 for "the same renderer twice must be identical",
 * ~0.1 against a capture from Tjek's viewer, where font hinting and image
 * resampling move edges by a shade. The expected image is scaled to the
 * actual one's size when they differ, and the result says so.
 */
export interface PixelDiff {
  width: number;
  height: number;
  /** The expected image had another size and was scaled to compare. */
  scaled: boolean;
  differing: number;
  /** Share of all pixels that differ, 0–1. */
  ratio: number;
  /** The actual page faded, every differing pixel in solid red. */
  diffPng: Buffer;
}

export async function diffPngs(
  browser: Browser,
  actual: Buffer,
  expected: Buffer,
  options: { threshold?: number } = {},
): Promise<PixelDiff> {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(async ({ a, b, threshold }) => {
      const load = (b64: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('not a readable image'));
        image.src = `data:image/png;base64,${b64}`;
      });
      const [one, two] = await Promise.all([load(a), load(b)]);
      const width = one.naturalWidth;
      const height = one.naturalHeight;
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
      };
      const got = pixels(one);
      const want = pixels(two);
      const out = new ImageData(width, height);
      const limit = threshold * 255;
      let differing = 0;
      for (let i = 0; i < got.data.length; i += 4) {
        const delta = Math.max(
          Math.abs(got.data[i]! - want.data[i]!),
          Math.abs(got.data[i + 1]! - want.data[i + 1]!),
          Math.abs(got.data[i + 2]! - want.data[i + 2]!),
          Math.abs(got.data[i + 3]! - want.data[i + 3]!),
        );
        if (delta > limit) {
          differing += 1;
          out.data.set([255, 0, 0, 255], i);
        } else {
          const grey = 255 - (255 - (got.data[i]! + got.data[i + 1]! + got.data[i + 2]!) / 3) * 0.25;
          out.data.set([grey, grey, grey, 255], i);
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.putImageData(out, 0, 0);
      return {
        width, height, differing,
        scaled: two.naturalWidth !== width || two.naturalHeight !== height,
        diff: canvas.toDataURL('image/png').split(',')[1]!,
      };
    }, { a: actual.toString('base64'), b: expected.toString('base64'), threshold: options.threshold ?? 0 });
    return {
      width: result.width,
      height: result.height,
      scaled: result.scaled,
      differing: result.differing,
      ratio: result.differing / Math.max(1, result.width * result.height),
      diffPng: Buffer.from(result.diff, 'base64'),
    };
  } finally {
    await page.close();
  }
}
