/**
 * A published leaflet, read out of the format it was published in.
 *
 * Tjek's viewer serves an *incito* document: the whole catalogue as a
 * tree of positioned views, with the offers marked `role: "offer"` and
 * every product's name, price, fine print and packshot inside them. It
 * is not a picture of a page — it is the page's own structure, which is
 * why nothing here estimates anything. Where `@incitio/match` shows a
 * model a photograph and asks it to read the grid, this READS the grid.
 *
 * What comes out is deliberately not a `CatalogDocument`: that
 * translation lives in `document.ts` and needs a brand to hang the page
 * on. This file's only job is to turn one vendor's tree into flat,
 * boring facts — rectangles, strings and image URLs — so the part that
 * builds a document never has to know what an incito is.
 */

import { splitLabelPrice } from '@incitio/schema';

/** One rectangle on a page, in the page's own units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One product as the published page carries it. */
export interface PublicationOffer {
  /** The publisher's own offer id, kept so a reimport is recognisable. */
  id: string;
  /** Where the offer's own box sits on the sheet. */
  rect: Rect;
  name: string;
  /** The fine print under the name — weight, unit price, "Frit valg". */
  description: string;
  /** What the price applies to: "4 poser", "1 stk.". */
  pack: string;
  price: number | null;
  currency: string;
  /** The packshot, or null when the offer prints without one. */
  imageUrl: string | null;
  /**
   * A cell with nothing known about what stands in it — a product found
   * on a page picture by its pixels (see `findPageCells`). It becomes a
   * cell of the layout and nothing else: no offer, no placement.
   */
  unbound?: boolean;
  /** The paper around it, on a page picture — see `TemplateSlot.paper`. */
  paper?: string;
  /** Certification marks and other badges printed inside the tile. */
  marks: string[];
  /**
   * Where the offer's three boxes sit inside its own rect, in shares of
   * that rect — the packshot, the price mark, the words. Null when the
   * subtree is not built that way.
   */
  frame: OfferFrame | null;
}

/** The inside of one published offer — see `PublicationOffer.frame`. */
export interface OfferFrame {
  media: Rect;
  price: Rect | null;
  words: Rect | null;
  /** The chain's drawn price shape, printed behind the figure. */
  splash: string | null;
  /** The price's type colour, as the page sets it. */
  priceInk: string | null;
  /** Whether the words sit at the top of their box or at its foot. */
  wordsAlign: 'start' | 'end';
  /** Type sizes as the page sets them, in the page's own points. */
  type: { name: number; body: number; figure: number; pack: number } | null;
  /** The pack line the price mark sets above its figure — "1 pose". */
  pack: string | null;
  /** The price mark's lines, when it sets more than a figure and a pack. */
  priceLines: RawLine[] | null;
  priceStack: RawStack | null;
  /** Other boxes of words over the tile — a member-discount roundel. */
  badges: { rect: Rect; lines: RawLine[]; stack: RawStack; image: string | null }[];
  /** Small drawn marks in the tile. */
  art: { rect: Rect; image: string }[];
}

/** One line of type in the page's own points — see `FrameLine`. */
export interface RawLine {
  role: 'figure' | 'pack' | 'note';
  text: string;
  sup?: { start: number; end: number };
  size: number;
  color?: string;
  bold: boolean;
  /** The chain's heading face rather than its body face. */
  face?: 'heading';
  upper: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  margin?: [number, number, number, number];
  /** "50%", or points. */
  width?: string | number;
}

export interface RawStack {
  align: 'flex-start' | 'center' | 'flex-end';
  justify: 'flex-start' | 'center' | 'flex-end';
}

/** Words or a flat band on the sheet that belong to no offer. */
export interface PageLabel {
  rect: Rect;
  lines: RawLine[];
  stack: RawStack;
  /** A drawn shape behind the words. */
  image: string | null;
  /** A flat colour behind them — or the whole of a band with no words. */
  fill: string | null;
}

/** Artwork on the sheet that belongs to no offer — a splash of fries. */
export interface PageArtwork {
  imageUrl: string;
  rect: Rect;
  /** Degrees, as the page turns it. */
  rotate: number;
}

/** One page of the publication. */
export interface PublicationPage {
  /** 1-based, as the reader counts them. */
  number: number;
  width: number;
  height: number;
  /** The sheet's own colour, stated by the file rather than sampled. */
  ground: string | null;
  /** A texture or photograph printed under the whole sheet. */
  background: { imageUrl: string; opacity: number } | null;
  /**
   * The section headline, which these publications set as artwork
   * rather than as type — "Stærk pris" is a drawing, not a font.
   */
  masthead: { imageUrl: string; rect: Rect } | null;
  /** Textless artwork outside the offers, in the page's own points. */
  artwork: PageArtwork[];
  /**
   * Words and flat bands outside the offers — "Storkøb min. 1,3 kg" on
   * its roundel, the red "Gælder fra …" strip — in the page's points.
   */
  labels: PageLabel[];
  offers: PublicationOffer[];
  /** The sheet view itself, untouched — what `IncitoSource.view` keeps. */
  view: Record<string, unknown>;
}

export interface Publication {
  id: string;
  locale: string;
  pages: PublicationPage[];
  /** `font_assets` as family → woff2 URL: the chain's own typefaces. */
  fonts: Record<string, string>;
  theme: { fontFamily: string; color: string; background: string; lineHeight: number };
}

/**
 * One node of the incito tree.
 *
 * Typed loosely on purpose: this is somebody else's format, every field
 * is optional in practice, and a strict interface here would turn a new
 * view type in next week's publication into a crash rather than into a
 * view we ignore.
 */
interface View {
  role?: string;
  id?: string;
  view_name?: string;
  text?: string;
  src?: string;
  background_image?: string;
  accessibility_label?: string;
  style?: string;
  layout_top?: number | string;
  layout_left?: number | string;
  layout_width?: number | string;
  layout_height?: number | string;
  child_views?: View[] | null;
}

/**
 * A layout value as a number, or 0.
 *
 * The format mixes absolute numbers with CSS-ish strings — `"100%"`,
 * `"80px"`, `"auto"` — because a view is either positioned or in flow.
 * Only the positioned ones carry geometry worth having, and a string is
 * exactly the signal that this one is not.
 */
function px(value: number | string | undefined): number {
  return typeof value === 'number' ? value : 0;
}

/** True only for a view whose size is stated in absolute units. */
function sized(view: View): boolean {
  return typeof view.layout_width === 'number' && typeof view.layout_height === 'number';
}

/** `rgb(255, 225, 109)` out of a style string, as `#ffe16d`. */
function groundOf(style: string | undefined): string | null {
  const found = /background-color:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(style ?? '');
  if (!found) return null;
  const hex = found.slice(1, 4)
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/** `opacity: 0.4` out of a style string; 1 when it says nothing. */
function opacityOf(style: string | undefined): number {
  const found = /opacity:\s*([0-9.]+)/i.exec(style ?? '');
  const value = found ? Number(found[1]) : 1;
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 1;
}

/**
 * Whose picture this is.
 *
 * The transformer URL carries the S3 key it is transforming, and the two
 * kinds of image on these pages live in different buckets: a product
 * photograph under `business_images`, everything the chain's designer
 * drew — the price splash, the masthead, the paper texture — under
 * `businesses`. That distinction is the difference between a packshot
 * and the red blob printed behind the price, and reading it off the URL
 * is exact where "the biggest image in the tile" is a guess.
 */
function isPackshot(url: string): boolean {
  return /business_images/.test(decodeURIComponent(url));
}

/** Depth-first walk that also carries each view's absolute position. */
function walk(
  view: View,
  x: number,
  y: number,
  visit: (view: View, x: number, y: number) => boolean | void,
): void {
  const left = x + px(view.layout_left);
  const top = y + px(view.layout_top);
  // A visitor that claims a subtree stops the descent — that is how an
  // offer keeps its own images out of the page's chrome.
  if (visit(view, left, top) === false) return;
  for (const child of view.child_views ?? []) walk(child, left, top, visit);
}

/**
 * The price out of an offer's accessibility label.
 *
 * The label is the one place the publication states the price as a
 * NUMBER — on the page it is set as "49,-", which is typography and not
 * arithmetic. Labels read "Coop paneret kylling, DKK 49", so the
 * currency code is also the only honest source for `currency`.
 */
function pricedLabel(label: string): { name: string; price: number | null; currency: string } {
  // Across line breaks: labels are often wrapped exactly at the comma,
  // and a match that stopped there left 22 of uge 40's offers priceless
  // with ", DKK 32" in their names. See `splitLabelPrice`.
  const found = splitLabelPrice(label);
  if (!found) return { name: label.replace(/\s+/g, ' ').trim(), price: null, currency: 'DKK' };
  return found;
}

/** A price as the page sets it: "49,-", "12,95". */
const PRICE_TEXT = /^\s*\d+([.,]\d+)?\s*,?-?\s*$/;

/** Every TextView string under a view, in reading order. */
function textsUnder(view: View): string[] {
  const found: string[] = [];
  walk(view, 0, 0, (node) => {
    if (node.view_name === 'TextView' && node.text) found.push(node.text.trim());
  });
  return found;
}

/**
 * A product photograph: a PICTURE BOX with a packshot in it. The small
 * certification marks set above a name are `ImageView`s with a `src`,
 * and they may live in the same bucket — they are type, not artwork.
 */
function photoOf(view: View): string | null {
  return view.background_image && isPackshot(view.background_image) ? view.background_image : null;
}

/** Whether an offer lives anywhere under a view — its wrapper is not a label. */
function offerUnder(view: View): boolean {
  let any = false;
  walk(view, 0, 0, (node) => {
    if (any) return false;
    if (node.role === 'offer') { any = true; return false; }
    return;
  });
  return any;
}

/** Whether a product photograph is anywhere under a view. */
function packshotUnder(view: View): boolean {
  let any = false;
  walk(view, 0, 0, (node) => {
    if (photoOf(node)) any = true;
  });
  return any;
}

/**
 * The type size of each TextView under a view, in reading order — the
 * nearest `font-size: Npx` above it, 16 when nothing says.
 */
function sizesUnder(view: View): { text: string; size: number }[] {
  const found: { text: string; size: number }[] = [];
  const visit = (node: View, size: number) => {
    const stated = /font-size:\s*([0-9.]+)px/i.exec(node.style ?? '');
    const here = stated ? Number(stated[1]) : size;
    if (node.view_name === 'TextView' && node.text) found.push({ text: node.text.trim(), size: here });
    for (const child of node.child_views ?? []) visit(child, here);
  };
  visit(view, 16);
  return found;
}

/** Largest `font-size: Npx` set under a view, per text line, summed. */
function typeHeightUnder(view: View, only: (text: string) => boolean): number {
  let total = 0;
  const visit = (node: View, size: number) => {
    const found = /font-size:\s*([0-9.]+)px/i.exec(node.style ?? '');
    const here = found ? Number(found[1]) : size;
    if (node.view_name === 'TextView' && node.text && only(node.text.trim())) total += here * 1.15;
    for (const child of node.child_views ?? []) visit(child, here);
  };
  visit(view, 16);
  return total;
}

/** `rotate(12.5deg)` out of a style string; 0 when it says nothing. */
function rotationOf(style: string | undefined): number {
  const found = /rotate\(\s*(-?[0-9.]+)deg/i.exec(style ?? '');
  const value = found ? Number(found[1]) : 0;
  return Number.isFinite(value) ? value : 0;
}

/** A number of px out of `name:12px`, or null. */
function pxOf(style: string | undefined, name: string): number | null {
  const found = new RegExp(`(?:^|;)\\s*${name}:\\s*(-?[0-9.]+)px`, 'i').exec(style ?? '');
  return found ? Number(found[1]) : null;
}

/** `color:` out of a style, as `#rrggbb`. */
function colorOf(style: string | undefined): string | undefined {
  const found = /(?:^|;)\s*color:\s*(?:rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)|#([0-9a-f]{6}))/i.exec(style ?? '');
  if (!found) return undefined;
  if (found[4]) return `#${found[4].toLowerCase()}`;
  return `#${found.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`;
}

/** How a flex box stacks its lines. */
function stackOf(style: string | undefined): RawStack {
  const pick = (name: string): RawStack['align'] => {
    const found = new RegExp(`${name}:\\s*(flex-start|center|flex-end)`, 'i').exec(style ?? '');
    return (found?.[1] as RawStack['align'] | undefined) ?? 'center';
  };
  return { align: pick('align-items'), justify: pick('justify-content') };
}

/**
 * The lines of a box as the page sets them.
 *
 * A line is a styled wrapper around one TextView; the wrapper carries
 * the size, the colour, the margins that push a line off-centre. Read
 * whole, because a member price is FOUR lines laid out against a drawn
 * roundel, and a figure alone on top of it is not that price mark.
 */
function linesOf(holder: View): RawLine[] {
  const lines: RawLine[] = [];
  for (const wrapper of holder.child_views ?? []) {
    let text: View | null = null;
    walk(wrapper, 0, 0, (node) => {
      if (!text && node.view_name === 'TextView' && node.text) text = node;
    });
    if (!text) continue;
    const node = text as View & { spans?: { start: number; end: number; name: string }[] };
    const style = wrapper.style ?? '';
    const margin = /(?:^|;)\s*margin:\s*(-?[0-9.]+)px\s+(-?[0-9.]+)px\s+(-?[0-9.]+)px\s+(-?[0-9.]+)px/i.exec(style);
    const sup = node.spans?.find((span) => span.name === 'superscript');
    const value = node.text!.trim();
    const width = wrapper.layout_width;
    lines.push({
      role: PRICE_TEXT.test(value) ? 'figure' : 'note',
      text: value,
      ...(sup ? { sup: { start: sup.start, end: Math.min(sup.end, value.length) } } : {}),
      size: pxOf(style, 'font-size') ?? 16,
      ...(colorOf(style) ? { color: colorOf(style)! } : {}),
      bold: /font-weight:\s*(bold|[6-9]00)/i.test(style),
      // incito-h1 is the chain's heading face — heavy in itself, whatever the weight says.
      ...(/font-family:\s*incito-h1/i.test(style) ? { face: 'heading' as const } : {}),
      upper: /text-transform:\s*uppercase/i.test(style),
      ...(/text-align:\s*(left|center|right)/i.exec(style)
        ? { align: /text-align:\s*(left|center|right)/i.exec(style)![1] as RawLine['align'] }
        : {}),
      ...(/line-height:\s*([0-9.]+)(?!px)/i.exec(style)
        ? { lineHeight: Number(/line-height:\s*([0-9.]+)(?!px)/i.exec(style)![1]) }
        : {}),
      ...(margin ? { margin: margin.slice(1, 5).map(Number) as [number, number, number, number] } : {}),
      ...(typeof width === 'string' && /%$/.test(width) ? { width } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof width === 'string' && /^\d+(\.\d+)?px$/.test(width) ? { width: Number(width.slice(0, -2)) } : {}),
    });
  }
  /*
   * One figure per mark: the largest price-shaped line without a raised
   * stretch. "16⁹⁵" beside a member price is the SAVING, set small and
   * superscripted — a number, not the price.
   */
  /*
   * The figure is the biggest price-shaped line. A raised stretch does
   * not disqualify it: a member price is set "109⁹⁵" with its øre up,
   * and ruling those out left the mark with no figure at all — the live
   * price never reached it, and it was sized as fine print. A smaller
   * raised line beside a bigger plain one is still the saving.
   */
  const figures = lines.filter((line) => line.role === 'figure');
  const main = [...figures].sort((a, b) => b.size - a.size)[0] ?? null;
  for (const line of figures) if (line !== main) line.role = 'note';

  // The short line right before the figure is the pack — "1 pose".
  const at = lines.findIndex((line) => line.role === 'figure');
  if (at > 0 && lines[at - 1]!.text.length <= 16 && !/\n/.test(lines[at - 1]!.text)
    && !lines[at - 1]!.sup) {
    lines[at - 1]!.role = 'pack';
  }
  return lines;
}

/** The deepest view whose children are the lines — the flex column. */
/** The scale a view is drawn at by its own `transform_scale`. */
function scaleOf(view: View): number {
  const k = (view as { transform_scale?: unknown }).transform_scale;
  return typeof k === 'number' && k > 0 ? k : 1;
}

/**
 * Everything a mark is drawn at, from its box down to the node its words hang off.
 *
 * SuperBrugsen sets its price marks small and scales them up — a 129 ×
 * 103 box at `transform_scale: 1.36` — and the scale may sit on the box
 * or on the panel inside it. Read at face value, the words came out a
 * third smaller than the viewer draws them against their own disc:
 * "Ugens køb 10,-" printed at the size of the fine print.
 */
function scaleDown(from: View, to: View): number {
  let total = 1;
  const visit = (node: View, k: number): boolean => {
    const here = k * scaleOf(node);
    if (node === to) { total = here; return true; }
    return (node.child_views ?? []).some((child) => visit(child, here));
  };
  visit(from, 1);
  return total;
}

/** The same lines, drawn at `k` times their stated size. */
function scaled(lines: RawLine[], k: number): RawLine[] {
  if (k === 1) return lines;
  return lines.map((line) => ({
    ...line,
    size: line.size * k,
    ...(typeof line.width === 'number' ? { width: line.width * k } : {}),
    ...(line.margin ? { margin: line.margin.map((m) => m * k) as [number, number, number, number] } : {}),
  }));
}

function holderOf(view: View): View {
  let holder = view;
  for (let depth = 0; depth < 4; depth += 1) {
    const kids = holder.child_views ?? [];
    if (kids.length === 1 && textsUnder(kids[0]!).length === textsUnder(holder).length
      && (kids[0]!.child_views?.length ?? 0) > 0 && textsUnder(kids[0]!).length > 1) {
      holder = kids[0]!;
      continue;
    }
    // A sized single child that carries the drawn shape is the holder.
    if (kids.length === 1 && sized(kids[0]!)) { holder = kids[0]!; continue; }
    break;
  }
  return holder;
}

/**
 * The boxes an offer is built from, as shares of the offer.
 *
 * These publications build every offer the same way: an inner box, and
 * inside it a handful of positioned boxes — the photograph, the price
 * mark, the words, and now and then a roundel or a small drawn mark.
 * Each box is classified by what it HOLDS: the product photograph; the
 * figure; the most words; words that are neither; a picture with no
 * words. The tree's nesting is the publisher's business and differs
 * between templates; what each box holds does not.
 */
function frameOf(view: View, name: string): OfferFrame | null {
  const W = px(view.layout_width);
  const H = px(view.layout_height);
  if (W <= 0 || H <= 0) return null;

  // The inner box: the deepest single sized child that holds everything.
  let inner = view;
  let ox = 0;
  let oy = 0;
  for (let depth = 0; depth < 3; depth += 1) {
    const kids = (inner.child_views ?? []).filter(sized);
    if (kids.length !== 1) break;
    inner = kids[0]!;
    ox += px(inner.layout_left);
    oy += px(inner.layout_top);
  }
  const boxes = (inner.child_views ?? []).filter(sized);
  if (boxes.length < 2) return null;

  // A box scaled by its own transform grows from its top-left corner.
  const share = (x: number, y: number, node: View): Rect => ({
    x: x / W, y: y / H,
    w: (px(node.layout_width) * scaleOf(node)) / W,
    h: (px(node.layout_height) * scaleOf(node)) / H,
  });

  let media: Rect | null = null;
  let price: Rect | null = null;
  let priceLines: RawLine[] | null = null;
  let priceStack: RawStack | null = null;
  let splash: string | null = null;
  let words: Rect | null = null;
  let wordsNode: View | null = null;
  let wordCount = 0;
  const badges: OfferFrame['badges'] = [];
  const art: OfferFrame['art'] = [];
  const leftover: { rect: Rect; node: View }[] = [];

  for (const box of boxes) {
    const x = ox + px(box.layout_left);
    const y = oy + px(box.layout_top);
    const rect = share(x, y, box);
    const texts = textsUnder(box);

    if (packshotUnder(box)) {
      media = media
        ? {
          x: Math.min(media.x, rect.x),
          y: Math.min(media.y, rect.y),
          w: Math.max(media.x + media.w, rect.x + rect.w) - Math.min(media.x, rect.x),
          h: Math.max(media.y + media.h, rect.y + rect.h) - Math.min(media.y, rect.y),
        }
        : rect;
      continue;
    }
    // The box that carries the offer's name is the words, even when the
    // page sets the price at its foot.
    const named = Boolean(name) && texts.some((text) => text.toLowerCase() === name.toLowerCase());
    if (!price && !named && texts.some((text) => PRICE_TEXT.test(text))
      && texts.length <= 6) {
      const holder = holderOf(box);
      price = rect;
      priceLines = scaled(linesOf(holder), scaleDown(box, holder));
      priceStack = stackOf(holder.style);
      let drawn: string | null = null;
      walk(box, 0, 0, (node) => {
        if (!drawn && node.background_image && !photoOf(node)) drawn = node.background_image;
      });
      splash = drawn;
      continue;
    }
    if (texts.length === 0) {
      let drawn: string | null = null;
      walk(box, 0, 0, (node) => {
        if (!drawn && node.background_image && !photoOf(node)) drawn = node.background_image;
      });
      if (drawn) art.push({ rect, image: drawn });
      continue;
    }
    leftover.push({ rect, node: box });
  }

  // The words are the box with the name, else the one with the most
  // text; the rest are badges.
  const byName = leftover.find((entry) => Boolean(name)
    && textsUnder(entry.node).some((text) => text.toLowerCase() === name.toLowerCase()));
  for (const entry of byName ? [byName] : leftover) {
    const count = textsUnder(entry.node).length;
    if (count > wordCount) { wordCount = count; words = entry.rect; wordsNode = entry.node; }
  }
  for (const entry of leftover) {
    if (entry.node === wordsNode) continue;
    const holder = holderOf(entry.node);
    let drawn: string | null = null;
    walk(entry.node, 0, 0, (node) => {
      if (!drawn && node.background_image && !photoOf(node)) drawn = node.background_image;
    });
    badges.push({
      rect: entry.rect,
      lines: scaled(linesOf(holder), scaleDown(entry.node, holder)),
      stack: stackOf(holder.style),
      image: drawn,
    });
  }

  /*
   * No box of its own for the price: it is set as the last lines of the
   * words, at the bottom. Split the words box — the figure takes the
   * height its own type needs, the words keep the rest.
   */
  if (!price && words && wordsNode) {
    const node = wordsNode as View;
    const tall = typeHeightUnder(node, (text) => PRICE_TEXT.test(text))
      + typeHeightUnder(node, (text) => /^\d+\s*\p{L}+\.?$/u.test(text));
    const box = words as Rect;
    const cut = Math.min(0.6, tall / (box.h * H || 1));
    if (cut > 0) {
      price = { x: box.x, y: box.y + box.h * (1 - cut), w: box.w, h: box.h * cut };
      words = { ...box, h: box.h * (1 - cut) };
    }
  }

  if (!media) return null;

  const wordsHolder = wordsNode ? holderOf(wordsNode as View) : null;
  const wordsAlign = wordsHolder && /justify-content:\s*flex-end/.test(wordsHolder.style ?? '')
    ? 'end' as const : 'start' as const;

  /*
   * The type sizes, so the copy is set as large as the page set it —
   * not at our own tile's scale, which is tuned for a different grid.
   */
  let type: OfferFrame['type'] = null;
  if (wordsNode) {
    const lines = sizesUnder(wordsNode as View).filter((line) => !PRICE_TEXT.test(line.text));
    const figureLine = priceLines?.find((line) => line.role === 'figure');
    const packLine = priceLines?.find((line) => line.role === 'pack');
    const inWords = sizesUnder(wordsNode as View);
    const figure = figureLine?.size ?? inWords.find((line) => PRICE_TEXT.test(line.text))?.size ?? 0;
    const pack = packLine?.size ?? 0;
    const name = lines[0]?.size ?? 0;
    const body = lines.slice(1).sort((a, b) => b.text.length - a.text.length)[0]?.size ?? 0;
    if (name > 0) type = { name, body, figure, pack };
  }

  // A plain price mark (a figure and its pack) needs no line-by-line copy.
  const rich = priceLines && priceLines.some((line) => line.role === 'note');

  return {
    media, price, words, splash,
    priceInk: priceLines?.find((line) => line.role === 'figure')?.color ?? null,
    wordsAlign, type,
    pack: priceLines?.find((line) => line.role === 'pack')?.text ?? null,
    priceLines: rich ? priceLines : null,
    priceStack: rich ? priceStack : null,
    badges, art,
  };
}

/** One offer's text, images and box, read out of its own subtree. */
function readOffer(view: View, x: number, y: number): PublicationOffer | null {
  if (!sized(view)) return null;

  const texts: string[] = [];
  const packshots: string[] = [];
  const marks: string[] = [];

  walk(view, 0, 0, (node) => {
    if (node.view_name === 'TextView' && node.text) texts.push(node.text.trim());
    const image = node.background_image ?? node.src;
    if (image) (isPackshot(image) ? packshots : marks).push(image);
  });

  const label = pricedLabel(view.accessibility_label ?? '');
  /*
   * The name the label states, matched against what is actually set on
   * the page.
   *
   * The label is authoritative for WHICH string is the name, and the
   * page is authoritative for how it is spelled — they agree today, and
   * when they do not, what the reader sees is what should print.
   */
  const name = texts.find((text) => text.toLowerCase() === label.name.toLowerCase())
    ?? label.name;

  /*
   * The pack is the line the price is set on top of.
   *
   * "4 poser" and "50 cl." are both a number and a word, so no amount
   * of pattern matching tells them apart — but the page does: the pack
   * sits inside the price mark, immediately above the figure, and the
   * fine print sits in the words block underneath. Reading order is
   * therefore exact where a guess at the shape of the string is not.
   */
  const at = texts.findIndex((text) => PRICE_TEXT.test(text));
  const before = at > 0 ? texts[at - 1]! : '';
  const frame = frameOf(view, name);
  /*
   * The pack, from the price mark itself when the offer's boxes could be
   * read — reading order puts the words box BEFORE the price box, so
   * "the line before the figure" is then the fine print, not the pack.
   */
  const pack = frame?.price ? (frame.pack ?? '') : (before === name ? '' : before);

  /*
   * Words the price mark or a roundel sets — "Pris ikke-medlem 37,95",
   * "Medlemsrabat" — are theirs, not the fine print under the name.
   */
  const elsewhere = new Set([
    ...(frame?.priceLines ?? []).map((line) => line.text),
    ...(frame?.badges ?? []).flatMap((badge) => badge.lines.map((line) => line.text)),
  ]);
  const rest = texts.filter(
    (text, index) => text !== name && !PRICE_TEXT.test(text) && text !== pack
      && (frame?.price ? true : index !== at - 1)
      && !elsewhere.has(text),
  );
  // What is left is the fine print — the longest of it, because a tile
  // may also carry a line of legal boilerplate nobody needs here.
  const description = [...rest].sort((a, b) => b.length - a.length)[0] ?? '';

  if (!name && packshots.length === 0) return null;

  return {
    id: view.id ?? '',
    rect: { x, y, w: px(view.layout_width), h: px(view.layout_height) },
    name,
    description,
    pack,
    price: label.price,
    currency: label.currency,
    imageUrl: packshots[0] ?? null,
    marks,
    frame,
  };
}

/**
 * The view that is actually the page, inside the section that holds it.
 *
 * Usually they are the same view and this returns the section. Some
 * publications wrap the page in a section twice its size — measured on
 * a Coop leaflet: `section 1200x2000` holding one `view 600x1000` that
 * is the whole page — and normalising against the section halves every
 * coordinate on the sheet. What that produced was a page whose offers
 * all sat in the top-left quarter, a grid fitter honestly padding the
 * other three quarters with empty tracks, and a ground and background
 * that were never found at all, because the test for "this view is the
 * sheet" asks for 98 % of a box twice the size of anything in it.
 *
 * So the wrapper is stepped through. Only a wrapper: one sized child,
 * markedly smaller than its parent, the same shape as its parent, and
 * holding children of its own. A single large picture inside a section
 * is a full-bleed image and not a wrapper, which is what the last of
 * those four tests is for.
 */
/**
 * The view to PRINT, which is the page at its own size.
 *
 * `sheetOf` answers where to measure from, and for a section about the
 * size of its page it stops at the section. For printing, that is
 * wrong whenever the two differ: the viewer fits the 600 × 1000 page to
 * its section with a scale it computes itself — 0.99 into a 595 section,
 * 0.625 into a 375 one — and that number is in no file. Printed from
 * the section, the page stood at full size inside a smaller box: every
 * sheet zoomed in and cropped to its top-left corner.
 *
 * So: step into a lone child with children of its own, as long as it is
 * the same SHAPE — whatever its size. Our own fitting (`IncitoPage`)
 * then does what the viewer's does.
 */
function drawnSheet(view: View): View {
  let sheet = view;
  for (let depth = 0; depth < 4; depth += 1) {
    const children = (sheet.child_views ?? []).filter(sized);
    const child = children.length === 1 ? children[0]! : undefined;
    if (!child || (child.child_views?.length ?? 0) === 0) break;
    const parentAspect = px(sheet.layout_width) / px(sheet.layout_height);
    const aspect = px(child.layout_width) / px(child.layout_height);
    if (!Number.isFinite(parentAspect) || !Number.isFinite(aspect)) break;
    if (Math.abs(aspect / parentAspect - 1) > 0.02) break;
    sheet = child;
  }
  return sheet;
}

function sheetOf(section: View): View {
  let page = section;
  // Four is deeper than any wrapper seen; the cap is there so a
  // pathological tree cannot walk the reader off the page.
  for (let depth = 0; depth < 4; depth += 1) {
    const children = (page.child_views ?? []).filter(sized);
    const child = children.length === 1 ? children[0]! : undefined;
    if (!child || (child.child_views?.length ?? 0) === 0) break;

    const parentWidth = px(page.layout_width);
    const parentHeight = px(page.layout_height);
    const width = px(child.layout_width);
    const height = px(child.layout_height);
    if (parentWidth <= 0 || parentHeight <= 0 || width <= 0 || height <= 0) break;

    const across = width / parentWidth;
    const down = height / parentHeight;
    // Same size: this IS the page, and there is nothing to step through.
    if (across > 0.9 || down > 0.9) break;
    // Not a plain scale: a child that is half as wide and a third as
    // tall is a block on the page, not the page.
    if (Math.abs(across - down) > 0.02) break;
    page = child;
  }
  return page;
}

/**
 * One section of the tree as a page.
 *
 * The chrome is read before the offers and separately from them: a
 * sheet-sized view with a colour is the ground, a sheet-sized view with
 * a picture is what the page is printed on, and a wide strip at the top
 * is the headline. Everything under an offer belongs to that offer, and
 * `walk` stops there.
 */
function readPage(section: View, number: number): PublicationPage {
  /*
   * The view that is actually the page — see `sheetOf`.
   *
   * Measured against the section instead, every coordinate on some
   * publications comes back at half scale. Everything downstream is a
   * SHARE of this box: the offer rectangles the grid is fitted to, the
   * test for what counts as the sheet, the strip that counts as a
   * masthead. Get the box wrong and all three are wrong together.
   */
  const sheetView = sheetOf(section);
  const width = px(sheetView.layout_width);
  const height = px(sheetView.layout_height);
  const offers: PublicationOffer[] = [];

  let ground: string | null = null;
  let background: PublicationPage['background'] = null;
  let masthead: PublicationPage['masthead'] = null;
  const artwork: PageArtwork[] = [];
  const labels: PageLabel[] = [];

  /*
   * Started at the sheet's own origin, not the section's.
   *
   * `walk` adds each view's `layout_left`/`layout_top` as it descends,
   * so entering at the sheet with (0, 0) would count the sheet's own
   * offset inside the section — and every rectangle on the page would
   * be shifted by it. Cancelling it here makes the sheet's top-left
   * corner the origin, which is what a share of the page means.
   */
  walk(sheetView, -px(sheetView.layout_left), -px(sheetView.layout_top), (view, x, y) => {
    if (view.role === 'offer') {
      const offer = readOffer(view, x, y);
      if (offer) offers.push(offer);
      return false;
    }

    if (!sized(view)) return;
    const w = px(view.layout_width);
    const h = px(view.layout_height);
    const sheet = w >= width * 0.98 && h >= height * 0.98;

    if (sheet && !ground) ground = groundOf(view.style);

    /*
     * Words the page sets outside every offer, and flat bands of colour.
     * Taken whole, like an offer, so their lines keep their own sizes.
     */
    const onPaper = x < width && y < height && x + w > 0 && y + h > 0;
    if (!sheet && onPaper && textsUnder(view).length > 0 && !offerUnder(view)) {
      const holder = holderOf(view);
      labels.push({
        rect: { x, y, w, h },
        lines: linesOf(holder),
        stack: stackOf(holder.style),
        image: view.background_image ?? null,
        fill: groundOf(view.style),
      });
      return false;
    }
    if (!sheet && onPaper && !view.background_image && groundOf(view.style)
      && (view.child_views?.length ?? 0) === 0) {
      labels.push({ rect: { x, y, w, h }, lines: [], stack: { align: 'center', justify: 'center' }, image: null, fill: groundOf(view.style) });
      return false;
    }
    if (sheet && view.background_image && !background) {
      background = { imageUrl: view.background_image, opacity: opacityOf(view.style) };
      return;
    }
    /*
     * A headline, not a product: wide, short, near the top, and above
     * every offer on the sheet. Stated as a shape rather than as a
     * position in the tree because the tree's shape is the publisher's
     * business and changes between templates, while "the wide strip at
     * the top of the page" is what the reader sees.
     */
    if (!masthead && view.background_image && !sheet
      && w >= width * 0.4 && h <= height * 0.25 && y <= height * 0.3) {
      masthead = { imageUrl: view.background_image, rect: { x, y, w, h } };
      return;
    }
    /*
     * Any other picture on the sheet that is not part of an offer — the
     * splash of fries behind a hero, a sprig of basil. Only textless
     * ones: a badge with words set on it ("Storkøb min. 1,3 kg") would
     * come through as an empty blob. And only what is on the paper.
     */
    if (view.background_image && !sheet && textsUnder(view).length === 0
      && x < width && y < height && x + w > 0 && y + h > 0) {
      artwork.push({ imageUrl: view.background_image, rect: { x, y, w, h }, rotate: rotationOf(view.style) });
      return false;
    }
    return;
  });

  const exact = drawnSheet(sheetView);
  return {
    number, width, height, ground, background, masthead, artwork, labels, offers,
    view: exact as Record<string, unknown>,
  };
}

/**
 * The publication, or a stated reason it cannot be read.
 *
 * Throws rather than returning null: every caller of this is answering
 * a person who pasted a link, and "kunne ikke læses" with no reason is
 * the answer that wastes their afternoon.
 */
export function readIncito(data: unknown): Publication {
  if (typeof data !== 'object' || data === null) {
    throw new Error('incito-dokumentet er ikke et objekt');
  }
  const root = data as {
    id?: string;
    locale?: string;
    root_view?: View;
    font_assets?: Record<string, { src?: [string, string][] }>;
    theme?: { font_family?: string[]; text_color?: string; background_color?: string; line_spacing_multiplier?: number };
  };
  if (!root.root_view) throw new Error('incito-dokumentet har ingen root_view');

  const sections: View[] = [];
  walk(root.root_view, 0, 0, (view) => {
    if (view.role === 'section') {
      sections.push(view);
      // A section is a page; nothing inside one is another page.
      return false;
    }
    return;
  });

  if (sections.length === 0) throw new Error('udgivelsen indeholder ingen sider');

  const fonts: Record<string, string> = {};
  for (const [family, asset] of Object.entries(root.font_assets ?? {})) {
    const source = (asset.src ?? []).find(([format]) => format === 'woff2') ?? asset.src?.[0];
    if (source?.[1]) fonts[family] = source[1];
  }

  return {
    id: root.id ?? '',
    locale: root.locale ?? 'da-DK',
    pages: sections.map((section, index) => readPage(section, index + 1)),
    fonts,
    theme: {
      fontFamily: (root.theme?.font_family ?? ['incito-body', 'system-ui', 'sans-serif']).join(', '),
      color: root.theme?.text_color ?? '#000000',
      background: root.theme?.background_color ?? '#ffffff',
      lineHeight: root.theme?.line_spacing_multiplier ?? 1.4,
    },
  };
}
