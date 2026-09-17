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
  /** Certification marks and other badges printed inside the tile. */
  marks: string[];
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
  offers: PublicationOffer[];
}

export interface Publication {
  id: string;
  locale: string;
  pages: PublicationPage[];
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
  const found = /^(.*),\s*([A-Z]{3})\s*([0-9]+(?:[.,][0-9]+)?)\s*$/.exec(label.trim());
  if (!found) return { name: label.trim(), price: null, currency: 'DKK' };
  return {
    name: found[1]!.trim(),
    price: Number(found[3]!.replace(',', '.')),
    currency: found[2]!,
  };
}

/** A price as the page sets it: "49,-", "12,95". */
const PRICE_TEXT = /^\s*\d+([.,]\d+)?\s*,?-?\s*$/;

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
  const pack = before === name ? '' : before;

  const rest = texts.filter(
    (text, index) => text !== name && !PRICE_TEXT.test(text) && index !== at - 1,
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
  };
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
  const width = px(section.layout_width);
  const height = px(section.layout_height);
  const offers: PublicationOffer[] = [];

  let ground: string | null = null;
  let background: PublicationPage['background'] = null;
  let masthead: PublicationPage['masthead'] = null;

  walk(section, 0, 0, (view, x, y) => {
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
    }
    return;
  });

  return { number, width, height, ground, background, masthead, offers };
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
  const root = data as { id?: string; locale?: string; root_view?: View };
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

  return {
    id: root.id ?? '',
    locale: root.locale ?? 'da-DK',
    pages: sections.map((section, index) => readPage(section, index + 1)),
  };
}
