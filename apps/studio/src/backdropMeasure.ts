import type { PageDecoration } from '@incitio/schema';
import { nearestAspect, partOf, type BackdropBrief, type Part } from '@incitio/decor/backdrop';

/**
 * What the background brief needs to know about one page, read off the
 * page as it is drawn in the editor — nothing guessed:
 *
 *   - its shape, for the aspect the picture is drawn at;
 *   - its colour, the ground the page is printed on;
 *   - each product's tight box, in percent of the page, to keep empty;
 *   - every piece of type, sorted into nine parts of the page.
 */
export type PageMeasure = Omit<BackdropBrief, 'offer' | 'products' | 'style'> & {
  /** The sheet's width over its height. */
  ratio: number;
  /** The products' own boxes, apart from the pictures in `regions`. */
  productBoxes: { x0: number; x1: number; y0: number; y1: number }[];
};

type Box = { x0: number; x1: number; y0: number; y1: number };

/**
 * The largest empty places on the page, in percent — up to three.
 *
 * The page is read as a coarse grid; a cell is taken when anything
 * printed touches it, with a small margin. The biggest free rectangle
 * wins, one that touches the sheet's edge a little more (a motif coming
 * in from the edge is how a leaflet does it); then the next, apart.
 */
export function freeSpots(taken: Box[], ratio: number): Box[] {
  const cols = 40;
  const rows = Math.max(8, Math.round(cols / ratio));
  const margin = 1;
  const busy = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (const b of taken) {
    const c0 = Math.max(0, Math.floor(((b.x0 - margin) / 100) * cols));
    const c1 = Math.min(cols - 1, Math.ceil(((b.x1 + margin) / 100) * cols) - 1);
    const r0 = Math.max(0, Math.floor(((b.y0 - margin) / 100) * rows));
    const r1 = Math.min(rows - 1, Math.ceil(((b.y1 + margin) / 100) * rows) - 1);
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) busy[r]![c] = true;
  }
  const spots: Box[] = [];
  for (let round = 0; round < 3; round += 1) {
    let best: { c0: number; c1: number; r0: number; r1: number; score: number } | null = null;
    for (let r0 = 0; r0 < rows; r0 += 1) {
      for (let c0 = 0; c0 < cols; c0 += 1) {
        if (busy[r0]![c0]) continue;
        let width = cols - c0;
        for (let r1 = r0; r1 < rows && !busy[r1]![c0]; r1 += 1) {
          let w = 0;
          while (w < width && !busy[r1]![c0 + w]) w += 1;
          width = w;
          const c1 = c0 + width - 1;
          const area = (width / cols) * ((r1 - r0 + 1) / rows);
          const edge = c0 === 0 || c1 === cols - 1 || r0 === 0 || r1 === rows - 1;
          const score = area * (edge ? 1.3 : 1);
          if (width / cols >= 0.1 && (r1 - r0 + 1) / rows >= 0.05 && (!best || score > best.score)) {
            best = { c0, c1, r0, r1, score };
          }
        }
      }
    }
    if (!best) break;
    const area = ((best.c1 - best.c0 + 1) / cols) * ((best.r1 - best.r0 + 1) / rows);
    if (area < 0.018) break;
    spots.push({
      x0: (best.c0 / cols) * 100, x1: ((best.c1 + 1) / cols) * 100,
      y0: (best.r0 / rows) * 100, y1: ((best.r1 + 1) / rows) * 100,
    });
    for (let r = Math.max(0, best.r0 - 1); r <= Math.min(rows - 1, best.r1 + 1); r += 1) {
      for (let c = Math.max(0, best.c0 - 1); c <= Math.min(cols - 1, best.c1 + 1); c += 1) busy[r]![c] = true;
    }
  }
  return spots;
}

/** `rgb(1, 2, 3)` as `#010203`; null for a transparent colour. */
function hexOf(css: string): string | null {
  const found = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([0-9.]+))?/.exec(css);
  if (!found) return null;
  if (found[4] !== undefined && Number(found[4]) < 0.5) return null;
  return `#${found.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

const TYPE = [
  '.tile__name', '.tile__brand', '.tile__description', '.tile__quantity', '.tile__meta',
  '.price', '.tile__marks', '.tile__tags', '.tile__badge', '.page__title', '.page__subtitle', '.page__note',
].join(',');

/** What a drawn motif's subject starts with — how a redraw finds its own. */
export const MOTIF_SUBJECT = 'AI-motiv:';

/**
 * Everything printed or laid on a page that a motif must not go under —
 * except the page's earlier motifs, which a redraw replaces.
 */
const TAKEN = [
  TYPE,
  `.page__decor:not([data-decor-subject^="${MOTIF_SUBJECT}"])`,
  '.page__logo', '.page__lines',
  '.page__note:not(.page__note--behind)', '.page__foot', '.slot__empty',
].join(',');

/**
 * Where a picture's pixels actually are, not its element's box.
 *
 * A packshot is set with `object-fit: contain`, so a tall bottle in a
 * wide cell is an element as wide as the cell with the bottle in its
 * middle. Measured by the element, every product claimed its whole
 * cell: the brief left the model almost no room, and every motif it
 * drew was then thrown away as lying "under a product".
 */
function drawnBox(img: HTMLImageElement): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
  const box = img.getBoundingClientRect();
  const fit = getComputedStyle(img).objectFit;
  if ((fit !== 'contain' && fit !== 'scale-down') || !img.naturalWidth || !img.naturalHeight) return box;
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const [px, py] = getComputedStyle(img).objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  const left = box.left + (box.width - w) * (px ?? 0.5);
  const top = box.top + (box.height - h) * (py ?? 0.5);
  return { left, top, right: left + w, bottom: top + h, width: w, height: h };
}

export function measurePage(pageId: string, ground: string | null): PageMeasure | null {
  const stack = document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
  const page = stack?.querySelector<HTMLElement>('.page');
  if (!page) return null;
  const P = page.getBoundingClientRect();
  if (P.width <= 0 || P.height <= 0) return null;
  const pct = (value: number, from: number, span: number) =>
    Math.min(100, Math.max(0, ((value - from) / span) * 100));

  // One box per tile: the tight union of its product pictures.
  const regions = [...page.querySelectorAll<HTMLElement>('.tile')].map((tile) => {
    const shots = [...tile.querySelectorAll<HTMLImageElement>('.tile__media img, .tile__pack img')]
      .map(drawnBox)
      .filter((box) => box.width > 0 && box.height > 0);
    const media = tile.querySelector<HTMLElement>('.tile__media')?.getBoundingClientRect();
    const boxes = shots.length > 0 ? shots : media ? [media] : [];
    if (boxes.length === 0) return null;
    return {
      x0: pct(Math.min(...boxes.map((b) => b.left)), P.left, P.width),
      x1: pct(Math.max(...boxes.map((b) => b.right)), P.left, P.width),
      y0: pct(Math.min(...boxes.map((b) => b.top)), P.top, P.height),
      y1: pct(Math.max(...boxes.map((b) => b.bottom)), P.top, P.height),
    };
  }).filter((box): box is NonNullable<typeof box> => Boolean(box));

  const text: Part[] = [...page.querySelectorAll<HTMLElement>(TYPE)]
    .filter((node) => !node.hidden && node.getBoundingClientRect().width > 0 && !node.classList.contains('page__note--behind'))
    .map((node) => {
      const box = node.getBoundingClientRect();
      return partOf(
        (box.left + box.width / 2 - P.left) / P.width,
        (box.top + box.height / 2 - P.top) / P.height,
      );
    });

  const colour = (ground && /^#[0-9a-f]{6}$/i.test(ground) ? ground : null)
    ?? hexOf(getComputedStyle(page).backgroundColor)
    ?? '#ffffff';

  const shots: Box[] = [...page.querySelectorAll<HTMLImageElement>('.tile__media img, .tile__pack img')]
    .map(drawnBox)
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      x0: pct(box.left, P.left, P.width), x1: pct(box.right, P.left, P.width),
      y0: pct(box.top, P.top, P.height), y1: pct(box.bottom, P.top, P.height),
    }));
  const taken: Box[] = shots.concat([...page.querySelectorAll<HTMLElement>(TAKEN)]
    // An empty cell is a product still to come, not room for a motif.
    // The editor draws those as its own drop targets over the sheet.
    .concat([...page.querySelectorAll<HTMLElement>('.slot')].filter((slot) => !slot.querySelector('.tile')))
    .concat([...(stack?.querySelectorAll<HTMLElement>('.empties__cell') ?? [])])
    .filter((node) => !node.hidden)
    .map((node) => node.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      x0: pct(box.left, P.left, P.width), x1: pct(box.right, P.left, P.width),
      y0: pct(box.top, P.top, P.height), y1: pct(box.bottom, P.top, P.height),
    })));
  const ratio = P.width / P.height;
  /*
   * The page's own pictures are kept clear too — its heading artwork,
   * its balloons, its logo. They are not type, so the brief never heard
   * of them, and the model filled the heading with food.
   */
  const pictures = [...page.querySelectorAll<HTMLElement>(
    `.page__decor:not([data-decor-subject^="${MOTIF_SUBJECT}"]), .page__logo, .page__lines`,
  )]
    .map((node) => node.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({
      x0: pct(box.left, P.left, P.width), x1: pct(box.right, P.left, P.width),
      y0: pct(box.top, P.top, P.height), y1: pct(box.bottom, P.top, P.height),
    }))
    // A picture over most of the sheet is a backdrop, not a place to avoid.
    .filter((box) => (box.x1 - box.x0) * (box.y1 - box.y0) < 4000);

  return {
    productBoxes: regions,
    aspect: nearestAspect(P.width, P.height), colour,
    regions: [...regions, ...pictures].slice(0, 20), text: [...new Set(text)],
    ratio, spots: freeSpots(taken, ratio),
  };
}

/**
 * A drawn motif as a decoration that sits in its free spot.
 *
 * Laid as a corner-anchored decoration rather than a measured box, so
 * every control a decoration has — corner, size, drag, mirror, layer —
 * works on it exactly as on any other picture. Sized to the spot, never
 * smaller than a fifth of the page (a motif nobody sees is the thing
 * this replaced), pushed against the sheet's edge where the spot meets
 * it; the offsets are solved against the stylesheet's own bleed.
 */
export function motifDecoration(
  motif: { url: string; spot: Box; width: number; height: number },
  ratio: number,
  id: string,
  subject: string,
  /** The smallest share of the page it may be; 0 keeps it exactly as boxed. */
  least = 0.2,
): PageDecoration {
  const s = motif.spot;
  const aspect = motif.width / Math.max(1, motif.height);
  const sw = (s.x1 - s.x0) / 100;
  const sh = (s.y1 - s.y0) / 100;
  // Width as a share of the page; height as a share of the page's height.
  const width = Math.min(0.6, Math.max(least, 0.05, Math.min(sw, (sh / ratio) * aspect)));
  const height = (width / aspect) * ratio;
  const exact = least === 0;
  const left = exact ? s.x0 / 100 : s.x0 <= 2 ? -0.03 : s.x1 >= 98 ? 1.03 - width : s.x0 / 100 + (sw - width) / 2;
  const top = exact ? s.y0 / 100 : s.y0 <= 2 ? 0 : s.y1 >= 98 ? 1 - height : s.y0 / 100 + (sh - height) / 2;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const anchor = `${cy < 0.5 ? 'top' : 'bottom'}-${cx < 0.5 ? 'left' : 'right'}` as PageDecoration['anchor'];
  // `.page__decor--*` hangs a picture off its corner by 14 % of its scale.
  const bleedX = 0.14 * width;
  const bleedY = 0.14 * width * ratio;
  const offsetX = anchor.endsWith('left') ? left + bleedX : left - (1 + bleedX - width);
  const offsetY = anchor.startsWith('top') ? top + bleedY : top - (1 + bleedY - height);
  const clamp = (v: number) => Math.round(Math.min(75, Math.max(-75, v * 100)) * 10) / 10;
  return {
    id, imageUrl: motif.url, subject, offerId: null, anchor,
    scale: Math.round(width * 100) / 100, rotate: 0, opacity: 1, flip: false, front: false,
    offsetX: clamp(offsetX), offsetY: clamp(offsetY),
  };
}
