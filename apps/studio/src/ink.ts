/**
 * How much of a cutout is actually the product.
 *
 * A packshot is a picture with a product somewhere in it, and the
 * margin around that product is not the same from one chain's image
 * service to the next: SuperBrugsen's arrive trimmed to the ink, and a
 * nemlig packshot is a 576-square with the product filling about three
 * quarters of it and white the rest.
 *
 * That margin is invisible until two measurements are compared across
 * it, which is exactly what standing a cluster up from a picture does.
 * The model is asked where each product sits and answers about the
 * PRODUCT — the pack, the bag, the bottle. The page was measured by its
 * `img` element, which is the whole picture, margin included. Divide
 * one by the other and every padded cutout is scaled up by its own
 * padding: a product with a quarter of white around it comes out a
 * third too big, which is the "it is close but everything is wrong
 * size" that no amount of prompt fixes.
 *
 * So the margin is measured and taken off. What is compared afterwards
 * is ink against ink.
 */

/** Where the product sits inside its picture, in fractions of it. */
export interface InkBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The whole picture, for a cutout that is all product. */
export const WHOLE: InkBox = { left: 0, top: 0, width: 1, height: 1 };

/**
 * The product's own rectangle in a decoded picture.
 *
 * Pure, so it can be tested without a canvas. A pixel counts as product
 * when it is neither transparent nor near-white — both, because the two
 * kinds of margin are both in circulation: a PNG cutout carries alpha,
 * and a JPEG packshot carries white.
 *
 * `null` when nothing was found, which is a picture that is all
 * background — the caller keeps the whole frame rather than dividing by
 * nothing.
 */
export function scanInk(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  /** Luminance above which a pixel may be background. */
  white = 246,
  /** Alpha below which it certainly is. */
  clear = 12,
): InkBox | null {
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3]! <= clear) continue;
      if (pixels[i]! > white && pixels[i + 1]! > white && pixels[i + 2]! > white) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return {
    left: x0 / width,
    top: y0 / height,
    width: (x1 - x0 + 1) / width,
    height: (y1 - y0 + 1) / height,
  };
}

/*
 * Read once per picture.
 *
 * A cluster is stood up more than once while an editor works on it and
 * the answer cannot change between runs — it is a property of the file.
 */
const seen = new Map<string, InkBox>();

/**
 * Measure a cutout, by URL.
 *
 * SAME-ORIGIN ONLY, and that is not a limitation here: the cutouts are
 * already copied onto this server by `prepareCluster`, precisely so
 * they can be handed to a model with a filename. A canvas may not read
 * a picture from another origin, so a chain's own image host would
 * throw — caught, and the whole frame returned, which is what every
 * measurement did before this existed.
 */
export async function inkOf(url: string): Promise<InkBox> {
  const known = seen.get(url);
  if (known) return known;

  const box = await new Promise<InkBox>((done) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || canvas.width === 0 || canvas.height === 0) return done(WHOLE);
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        return done(scanInk(data, canvas.width, canvas.height) ?? WHOLE);
      } catch {
        // Tainted by another origin, or no 2d context at all.
        return done(WHOLE);
      }
    };
    image.onerror = () => done(WHOLE);
    image.src = url;
  });

  seen.set(url, box);
  return box;
}

/**
 * A picture on white, as bytes.
 *
 * The composition comes back from the image model already keyed out —
 * white knocked through to alpha and trimmed to the products, which is
 * what a tile needs and not what a reader needs. A vision model shown a
 * transparent PNG is shown whatever the decoder puts behind it, and the
 * one thing it must not be is guesswork. So the alpha is laid back onto
 * white before the picture is read.
 *
 * Same-origin only, for the same reason as `inkOf` — and the same
 * arrangement: the picture being flattened is one this server made.
 */
export async function onWhite(url: string): Promise<Uint8Array> {
  const image = await new Promise<HTMLImageElement>((done, fail) => {
    const element = new Image();
    element.onload = () => done(element);
    element.onerror = () => fail(new Error(`${url} kunne ikke hentes`));
    element.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0) throw new Error('billedet kunne ikke tegnes');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((done) => {
    canvas.toBlob(done, 'image/png');
  });
  if (!blob) throw new Error('billedet kunne ikke kodes');
  return new Uint8Array(await blob.arrayBuffer());
}
