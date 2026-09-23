/**
 * What a published page actually contains, read out of the file.
 *
 * A chain's leaflet exists as a vector PDF before it exists as a
 * picture, and everything this repo has been asking a model to estimate
 * off a JPEG — where the offers sit, how many columns the page is on,
 * how far a packshot runs past its cell — is stated exactly in that
 * file. This reads it.
 *
 * NOT a renderer and not the printer's side of the house: `@incitio/pdf`
 * turns this project's catalogues INTO a PDF, and pointing the two at
 * one package would put two opposite directions behind one name. This
 * package only ever reads someone else's page.
 *
 * What comes out is geometry and paint order, never meaning. Whether a
 * box is a price mark, a certification mark or a packshot is not in the
 * file — a PDF knows it drew an image, not what the image was of — and
 * guessing it here would be the same estimate this package exists to
 * replace, moved one layer down. See `grid.ts` for what the geometry is
 * turned into, and leave the naming to the stage that can see.
 */

/**
 * A box on the page, as a share of the sheet.
 *
 * `0..1` on both axes with the origin at the TOP LEFT — the direction a
 * screen, a CSS grid and every measurement in this repo already use.
 * PDF user space is y-up from the bottom left, and that flip happens
 * here, once, rather than in every consumer.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What kind of drawing operation put this box on the page.
 *
 * Three kinds because three are what a leaflet is made of: type,
 * photographs, and filled shapes — the coloured bands, the price discs,
 * the rules. Deliberately not "price" or "product": see the note above.
 */
export type ItemKind = 'text' | 'image' | 'path';

export interface PageItem {
  kind: ItemKind;
  rect: Rect;
  /**
   * Where this was painted in the page's own drawing order.
   *
   * A PDF content stream is painted in document order, so this IS the
   * z-index — exactly, from the file, with nothing estimated. It is the
   * one fact about overlap that no model should ever be asked for.
   *
   * EXACT for `image` and `path`, which is where it matters: a disc
   * over a packshot, a band under a headline. For `text` it is the
   * index within the page's text stream and is NOT comparable with the
   * other two — pdf.js exposes text through a separate pass whose items
   * do not line up one-to-one with the `showText` operators (measured
   * on a real page: 727 operators against 702 items, the difference
   * being kerning and end-of-line artefacts). Zipping them would be a
   * guess wearing a measurement's clothes. Type on a leaflet is painted
   * over its artwork in practice; where that has to be certain, the
   * question belongs to the stage that can see the crop.
   */
  order: number;
  /** For `text`, the run's own characters. */
  text?: string;
  /** For `text`, the size in points, so headline and fine print differ. */
  size?: number;
  /** For `path`, the fill in `#rrggbb` when the page set one. */
  fill?: string;
}

export interface ReferencePage {
  /** 1-based, as a person counts pages. */
  page: number;
  /** The sheet in points, kept so a consumer can convert back. */
  width: number;
  height: number;
  items: PageItem[];
}

/** A 2×3 affine matrix, in the order PDF and pdf.js both write it. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * The box a unit square lands in under this matrix.
 *
 * All four corners, not two: a rotated or mirrored transform — a
 * leaflet's tilted coupon sheet, a flipped image — has its extremes on
 * corners the naive pair never visits.
 */
function box(m: Matrix, x0 = 0, y0 = 0, x1 = 1, y1 = 1): [number, number, number, number] {
  const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x1, y1), apply(m, x0, y1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/**
 * The pdf.js surface this file uses, named rather than imported.
 *
 * pdf.js is a peer dependency: it is heavy, it is only needed by the
 * stage that reads someone else's page, and a package that pulls it
 * into every build of the studio would cost every consumer for a lane
 * most of them never enter. Typed structurally so this file compiles
 * without it installed, and fails loudly at the call site if it is not.
 */
export interface PdfjsLike {
  getDocument: (options: { data?: Uint8Array; url?: string; isEvalSupported?: boolean }) => {
    promise: Promise<PdfDocumentLike>;
  };
  OPS: Record<string, number>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage: (page: number) => Promise<PdfPageLike>;
}

interface PdfPageLike {
  view: number[];
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent: () => Promise<{ items: { str: string; transform: number[]; width: number; height: number }[] }>;
}

/**
 * Read one page's boxes.
 *
 * The graphics come off the operator list, which is the content stream
 * with its state resolved — so the matrix stack is walked here, exactly
 * as a renderer would, and every image and filled path is reported in
 * the page's own coordinates and in the page's own order.
 *
 * Text comes off pdf.js's text pass instead of the operator list,
 * because that pass already resolves the font metrics a text run's box
 * depends on. The cost is the ordering caveat on `PageItem.order`.
 */
export async function readPage(
  pdfjs: PdfjsLike,
  source: { data?: Uint8Array; url?: string },
  page: number,
): Promise<ReferencePage> {
  const { OPS } = pdfjs;
  const doc = await pdfjs.getDocument({ ...source, isEvalSupported: false }).promise;
  const sheet = await doc.getPage(page);

  const [vx0, vy0, vx1, vy1] = sheet.view as [number, number, number, number];
  const width = vx1 - vx0;
  const height = vy1 - vy0;

  /*
   * Page space to sheet share, with the y-axis turned over.
   *
   * PDF measures up from the bottom left and everything downstream
   * measures down from the top left. One conversion, stated once: a
   * second one anywhere else in the pipeline is a page drawn upside
   * down that still validates.
   */
  const toRect = (x0: number, y0: number, x1: number, y1: number): Rect => ({
    x: (Math.min(x0, x1) - vx0) / width,
    y: (vy1 - Math.max(y0, y1)) / height,
    w: Math.abs(x1 - x0) / width,
    h: Math.abs(y1 - y0) / height,
  });

  /*
   * Off the sheet is not on the page.
   *
   * A printed leaflet is imposed with bleed and trim: artwork runs past
   * the trim box on every side, and a plate can carry marks nobody ever
   * sees. Anything whose box does not reach the sheet is dropped, and
   * what does is left at its true size — the overrun is exactly the
   * `bleedPercent` this repo already models.
   */
  const onSheet = (r: Rect) => r.x < 1 && r.y < 1 && r.x + r.w > 0 && r.y + r.h > 0
    && r.w < 4 && r.h < 4;

  const items: PageItem[] = [];
  const ops = await sheet.getOperatorList();

  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let fill: string | undefined;

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i]!;
    const args = ops.argsArray[i] as unknown[];

    if (fn === OPS['save'] || fn === OPS['beginGroup']) { stack.push(ctm); continue; }
    if (fn === OPS['restore'] || fn === OPS['endGroup']) { ctm = stack.pop() ?? IDENTITY; continue; }
    if (fn === OPS['transform']) {
      ctm = multiply(ctm, (args as number[]).slice(0, 6) as Matrix);
      continue;
    }
    /*
     * A form XObject is a page inside the page.
     *
     * It saves the state and concatenates its own matrix — a renderer
     * that misses this draws everything inside the form with whatever
     * matrix happened to be current, which on a real leaflet put a
     * price disc two and a half pages off the sheet. There are 32 of
     * them on the front page of the book this was written against.
     */
    if (fn === OPS['paintFormXObjectBegin']) {
      stack.push(ctm);
      const matrix = (args as unknown[])[0] as number[] | undefined;
      if (matrix && matrix.length >= 6) ctm = multiply(ctm, matrix.slice(0, 6) as Matrix);
      continue;
    }
    if (fn === OPS['paintFormXObjectEnd']) { ctm = stack.pop() ?? IDENTITY; continue; }
    if (fn === OPS['setFillRGBColor']) {
      /*
       * pdf.js has said this two ways across its versions: three
       * channels, and one CSS string. Read both, because a build that
       * says the other one does not fail — it writes `#NaN0000` into
       * every filled shape on the page and nothing notices until a
       * colour is asked for.
       */
      const [r, g, b] = args as unknown[];
      fill = typeof r === 'string'
        ? r
        : `#${hex(Number(r) || 0)}${hex(Number(g) || 0)}${hex(Number(b) || 0)}`;
      continue;
    }

    if (
      fn === OPS['paintImageXObject'] || fn === OPS['paintJpegXObject']
      || fn === OPS['paintImageMaskXObject'] || fn === OPS['paintInlineImageXObject']
    ) {
      /*
       * An image is always drawn into the unit square and placed by the
       * matrix — that is the whole of PDF's image model, and it is why
       * a packshot's box needs no heuristic here.
       */
      const [x0, y0, x1, y1] = box(ctm);
      const rect = toRect(x0, y0, x1, y1);
      if (onSheet(rect)) items.push({ kind: 'image', rect, order: i });
      continue;
    }

    if (fn === OPS['constructPath']) {
      /*
       * A path used as a clip is not ink.
       *
       * It is the SHAPE OF A HOLE — the rounded corner a photograph is
       * poured through, the bbox a form is confined to — and counting
       * it as something drawn fills every gutter on the page with
       * boxes nobody can see. pdf.js emits the clip immediately after
       * the path it clips with, so one look ahead settles it.
       */
      const next = ops.fnArray[i + 1];
      if (next === OPS['clip'] || next === OPS['eoClip']) continue;

      /*
       * pdf.js hands the path's own bounding box along with it, so the
       * curve data never has to be walked: `constructPath` carries
       * [ops, data, minMax] and the third is [minX, minY, maxX, maxY]
       * in path space.
       */
      const minMax = (args as unknown[])[2] as ArrayLike<number> | undefined;
      if (!minMax || minMax.length < 4) continue;
      const [x0, y0, x1, y1] = box(
        ctm, minMax[0] as number, minMax[1] as number, minMax[2] as number, minMax[3] as number,
      );
      const rect = toRect(x0, y0, x1, y1);
      if (onSheet(rect)) items.push({ kind: 'path', rect, order: i, ...(fill ? { fill } : {}) });
    }
  }

  const text = await sheet.getTextContent();
  text.items.forEach((run, index) => {
    if (run.str.trim() === '') return;
    const m = run.transform as unknown as Matrix;
    // The run's origin is its BASELINE, so the box reaches up from
    // there by the line's height. Descenders hang below it; no leaflet
    // grid has ever turned on a descender.
    const [x0, y0] = [m[4], m[5]];
    items.push({
      kind: 'text',
      rect: toRect(x0, y0, x0 + run.width, y0 + run.height),
      order: index,
      text: run.str,
      size: Math.abs(m[3]) || run.height,
    });
  });

  return { page, width, height, items };
}
