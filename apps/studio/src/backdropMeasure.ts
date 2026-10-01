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
  /** Every piece of type on the page, as boxes — what a motif may never cover. */
  wordBoxes: { x0: number; x1: number; y0: number; y1: number }[];
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

/** Pixel sizes of the pictures an imported page draws as backgrounds — see `loadPagePictures`. */
const natural = new Map<string, { w: number; h: number }>();

/**
 * Learn the real size of every picture a page draws as a background.
 *
 * A published page sets its packshots as the background of a box, and
 * the box is usually much larger than the product in it. Measured by
 * the box, a page of six products was all product and no paper, and a
 * motif had nowhere to go. With the picture's own size the drawn product
 * is found inside its box, as `drawnBox` does for a tile's photograph.
 */
export async function loadPagePictures(pageId: string): Promise<void> {
  const stack = document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
  const urls = new Set<string>();
  for (const node of stack?.querySelectorAll<HTMLElement>('[data-incito-block], [data-incito-block] *') ?? []) {
    const found = /url\("?([^")]+)"?\)/.exec(node.style.backgroundImage);
    if (found?.[1] && !natural.has(found[1])) urls.add(found[1]);
  }
  await Promise.all([...urls].map((url) => new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => { natural.set(url, { w: image.naturalWidth, h: image.naturalHeight }); resolve(); };
    image.onerror = () => resolve();
    image.src = url;
    setTimeout(resolve, 4000);
  })));
}

/** Where a background picture's pixels are inside its box, when its size is known. */
function drawnBackground(node: HTMLElement): DOMRect {
  const box = node.getBoundingClientRect();
  const holder = [node, ...node.querySelectorAll<HTMLElement>('*')].find((el) => el.style.backgroundImage);
  const url = holder ? /url\("?([^")]+)"?\)/.exec(holder.style.backgroundImage)?.[1] : undefined;
  const size = url ? natural.get(url) : undefined;
  if (!holder || !size || !/contain/.test(getComputedStyle(holder).backgroundSize)) return box;
  const at = holder.getBoundingClientRect();
  const scale = Math.min(at.width / size.w, at.height / size.h);
  const w = size.w * scale; const h = size.h * scale;
  return new DOMRect(at.left + (at.width - w) / 2, at.top + (at.height - h) / 2, w, h);
}

export function measurePage(pageId: string, ground: string | null): PageMeasure | null {
  const stack = document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
  // The sheet itself when it carries the id (as a thumbnail does), else the sheet inside it.
  const page = stack?.matches('.page:not(.page--overlay)') ? stack as HTMLElement : stack?.querySelector<HTMLElement>('.page');
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

  /*
   * A page printed from its publication has no tiles to measure — its
   * products, prices, heading and art are elements of its own tree. Each
   * is kept clear exactly like a tile; the sheet-sized ones are its paper.
   */
  const published = [...page.querySelectorAll<HTMLElement>('[data-incito-block]')]
    .map((node) => ({ node, box: node.querySelector('p') ? node.getBoundingClientRect() : drawnBackground(node) }))
    .filter(({ box }) => box.width > 0 && box.height > 0 && box.width * box.height < P.width * P.height * 0.6);
  const asShare = (box: DOMRect) => ({
    x0: pct(box.left, P.left, P.width), x1: pct(box.right, P.left, P.width),
    y0: pct(box.top, P.top, P.height), y1: pct(box.bottom, P.top, P.height),
  });
  regions.push(...published.filter(({ node }) => !node.querySelector('p')).map(({ box }) => asShare(box)));

  const text: Part[] = [...page.querySelectorAll<HTMLElement>(TYPE)]
    .filter((node) => !node.hidden && node.getBoundingClientRect().width > 0 && !node.classList.contains('page__note--behind'))
    .map((node) => {
      const box = node.getBoundingClientRect();
      return partOf(
        (box.left + box.width / 2 - P.left) / P.width,
        (box.top + box.height / 2 - P.top) / P.height,
      );
    })
    .concat(published.filter(({ node }) => node.querySelector('p')).map(({ box }) => partOf(
      (box.left + box.width / 2 - P.left) / P.width,
      (box.top + box.height / 2 - P.top) / P.height,
    )));

  const wordBoxes: Box[] = [...page.querySelectorAll<HTMLElement>(TYPE)]
    .filter((node) => !node.hidden && !node.classList.contains('page__note--behind'))
    .map((node) => node.getBoundingClientRect())
    // The lines themselves: an element's box can hold a product as well as its words.
    .concat(published.flatMap(({ node }) => [...node.querySelectorAll('p')].map((line) => line.getBoundingClientRect())))
    .filter((box) => box.width > 0 && box.height > 0)
    .map(asShare);

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
    })))
    .concat(published.map(({ box }) => asShare(box)));
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
    wordBoxes,
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

/**
 * Where on the page a motif goes — chosen here, never left to the model.
 *
 * There is always an answer. First the page's largest free place, if it
 * is big enough to be worth a picture; the one at the sheet's edge and
 * near the page's biggest product wins, so the motif reads as belonging
 * to it. A page with no such place gets a corner instead: the motif
 * comes in from off the sheet, over whatever paper is there, placed
 * where it covers the least product and no words. Kept to a shape a
 * group of objects can fill — never a sliver.
 */
export function motifTarget(measure: PageMeasure): Box {
  const ratio = measure.ratio;
  const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) / 10000;
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / 10000;
  const lead = [...measure.productBoxes].sort((a, b) => area(b) - area(a))[0];
  const near = (b: Box) => {
    if (!lead) return 1;
    const dx = ((b.x0 + b.x1) - (lead.x0 + lead.x1)) / 200;
    const dy = ((b.y0 + b.y1) - (lead.y0 + lead.y1)) / 200;
    return 1 / (1 + 2 * Math.hypot(dx, dy / ratio));
  };
  /** The box cut to a shape a group can fill: at most twice as long as it is wide, on the page. */
  const shaped = (b: Box): Box => {
    const w = (b.x1 - b.x0) * ratio; const h = b.y1 - b.y0;
    if (w > 2 * h) {
      const keep = (2 * h) / ratio;
      return b.x0 <= 2 ? { ...b, x1: b.x0 + keep } : b.x1 >= 98 ? { ...b, x0: b.x1 - keep } : { ...b, x0: (b.x0 + b.x1 - keep) / 2, x1: (b.x0 + b.x1 + keep) / 2 };
    }
    if (h > 2 * w) {
      const keep = 2 * w;
      return b.y0 <= 2 ? { ...b, y1: b.y0 + keep } : b.y1 >= 98 ? { ...b, y0: b.y1 - keep } : { ...b, y0: (b.y0 + b.y1 - keep) / 2, y1: (b.y0 + b.y1 + keep) / 2 };
    }
    return b;
  };
  /*
   * A free strip along the sheet's edge is made a place by letting the
   * motif come in from off the page: widened outward until it is a shape
   * a group of objects can fill. What shows is what counts.
   */
  const bled = (b: Box): Box => {
    const w = (b.x1 - b.x0) * ratio; const h = b.y1 - b.y0;
    if (w < 0.7 * h && (b.x0 <= 1 || b.x1 >= 99)) {
      const grow = (0.7 * h) / ratio - (b.x1 - b.x0);
      return b.x0 <= 1 ? { ...b, x0: b.x0 - grow } : { ...b, x1: b.x1 + grow };
    }
    if (h < 0.7 * w && (b.y0 <= 1 || b.y1 >= 99)) {
      const grow = 0.7 * w - h;
      return b.y0 <= 1 ? { ...b, y0: b.y0 - grow } : { ...b, y1: b.y1 + grow };
    }
    return b;
  };
  const shows = (b: Box) => area({ x0: Math.max(0, b.x0), x1: Math.min(100, b.x1), y0: Math.max(0, b.y0), y1: Math.min(100, b.y1) });
  const free = (measure.spots ?? []).map((b) => shaped(bled(b))).filter((b) => shows(b) >= 0.04);
  if (free.length > 0) {
    const edge = (b: Box) => (b.x0 <= 2 || b.x1 >= 98 || b.y0 <= 2 || b.y1 >= 98 ? 1.3 : 1);
    return free.sort((a, b) => shows(b) * edge(b) * near(b) - shows(a) * edge(a) * near(a))[0]!;
  }
  /*
   * A corner or an edge, coming in from off the sheet: the largest size
   * that covers no words and at most a little of a product, and of the
   * places that allows, the one that covers the least product. A page
   * where every place touches words takes the one touching fewest.
   */
  const candidates: { box: Box; words: number; goods: number; size: number }[] = [];
  for (const size of [0.36, 0.3, 0.25, 0.2]) {
    const w = size * 100; const h = size * 100 * ratio;
    for (const x0 of [-w * 0.3, 100 - w * 0.7]) {
      for (const y0 of [-h * 0.15, 50 - h / 2, 100 - h * 0.85]) {
        const box = { x0, x1: x0 + w, y0, y1: y0 + h };
        const shown = area({ x0: Math.max(0, box.x0), x1: Math.min(100, box.x1), y0: Math.max(0, box.y0), y1: Math.min(100, box.y1) });
        candidates.push({
          box, size,
          words: measure.wordBoxes.reduce((sum, b) => sum + overlap(box, b), 0) / shown,
          goods: measure.productBoxes.reduce((sum, b) => sum + overlap(box, b), 0) / shown,
        });
      }
    }
  }
  const fits = candidates.filter((c) => c.words === 0 && c.goods <= 0.3);
  const pick = fits.length > 0
    ? fits.sort((a, b) => b.size - a.size || a.goods - b.goods || near(b.box) - near(a.box))[0]!
    : candidates.sort((a, b) => a.words - b.words || a.goods - b.goods || b.size - a.size)[0]!;
  return pick.box;
}

