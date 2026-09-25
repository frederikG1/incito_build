import { splitLabelPrice, type IncitoEditInput, type IncitoSource, type Offer } from '@incitio/schema';

/**
 * A publication page, drawn from its own layout tree — the way Tjek's
 * viewer draws it.
 *
 * Every rule here was read off the viewer itself: its stylesheet (the
 * `.tjek-incito*` rules below, copied as they are) and the inline style
 * it writes for each view. Three of them are the difference between
 * "close" and "the same page":
 *
 *   - every view scales from its top-left corner (`transform-origin:
 *     0 0`), so a price mark with `transform_scale: 1.36` grows down and
 *     to the right, not out from its middle;
 *   - every view clips unless it says `clip_children: false`;
 *   - a superscript span is 0.6em, lifted 0.5em — the "95" in "109⁹⁵".
 *
 * Output is an HTML string, not React elements: the tree carries raw
 * CSS in `style`, and handing it to the browser as written is the only
 * way to be sure nothing is re-interpreted on the way.
 */

interface View {
  view_name?: string;
  role?: string;
  id?: string;
  accessibility_label?: string;
  style?: string;
  text?: string;
  spans?: { start: number; end: number; name: string }[];
  max_lines?: number;
  src?: string;
  child_views?: View[];
  [key: string]: unknown;
}

/** The viewer's own stylesheet, scoped the way it scopes it. */
export const INCITO_CSS = `
.tjek-incito { position: relative; box-sizing: border-box; text-rendering: optimizelegibility; }
.tjek-incito ::before, .tjek-incito *, .tjek-incito ::after { box-sizing: inherit; }
.tjek-incito a { color: inherit; text-decoration: none; }
.tjek-incito__view { transform-origin: 0px 0px; overflow: hidden; margin: 0px; padding: 0px; display: block; background-repeat: no-repeat; border: 0px; }
.tjek-incito__view[data-gravity="center_horizontal"] { margin-left: auto !important; margin-right: auto !important; }
.tjek-incito__view[data-gravity="left_horizontal"] { margin-right: auto !important; }
.tjek-incito__view[data-gravity="right_horizontal"] { margin-left: auto !important; }
.tjek-incito__text-view { margin: 0px; font-family: inherit; word-break: break-word; overflow-wrap: break-word; text-overflow: ellipsis; }
.tjek-incito__text-view[data-single-line="true"] { white-space: nowrap; }
.tjek-incito__text-view [data-name="superscript"] { vertical-align: 0.5em; position: relative; font-size: 0.6em; }
.tjek-incito__image-view { border: none; box-shadow: none; }
`;

/** The chain's typefaces, as the viewer declares them. */
export function incitoFontCss(fonts: Record<string, string>): string {
  return Object.entries(fonts)
    .map(([family, url]) => `@font-face { font-family: ${family}; font-display: swap; src: url("${url}"); }`)
    .join('\n');
}

const escape = (text: string) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A length as the viewer writes it: numbers are pixels, 0 is bare, strings pass through. */
function length(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value === 0 ? '0' : `${value}px`;
  return String(value);
}

const SCALE_TYPE: Record<string, string> = {
  center_crop: 'cover',
  center_inside: 'contain',
};

/**
 * What an offer's cell shows: the product the publication printed
 * there, and the one the avis holds there now — the same product with a
 * corrected price, or a different product altogether, set in the old
 * one's layout.
 */
export interface IncitoBinding {
  /** The product's own id, when known — what tells a new product from a corrected one. */
  id?: string;
  name: string;
  price: number;
  description?: string;
  pack?: string;
  /** Several prices under one mark: the lowest, and "fra" in front of it. */
  priceFrom?: boolean;
  imageUrl?: string | null;
  /** A cell somebody assembled: every product's packshot, drawn side by side in the old one's box. */
  imagePack?: string[];
}

const plain = (text: string) => text.replace(/\s+/g, ' ').trim();

function binding(offer: Offer): IncitoBinding {
  return {
    id: offer.id,
    name: offer.name,
    price: offer.price,
    description: offer.description,
    pack: offer.pack,
    priceFrom: offer.priceFrom,
    imageUrl: offer.imageUrl,
    imagePack: offer.imagePack,
  };
}

/**
 * A price as its digits — the publication sets 109,95 as "10995" with
 * the last two raised, and 79 as "79,-". Comparing digits finds the
 * figure however it was typeset.
 */
function priceDigits(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', '');
}

/**
 * The figure for a new price, typeset like the old one.
 *
 * Same decimals rule, same trailing ",-", and the superscript span
 * moved to cover the øre of the new number. Returns null when the old
 * text was not a figure for the old price.
 */
function refigure(view: View, was: number, now: number): View | null {
  const text = view.text ?? '';
  if (text.replace(/\D/g, '') !== priceDigits(was) || /[a-zæøå]/i.test(text)) return null;
  if (was === now) return view;
  const whole = String(Math.trunc(now));
  const cents = Number.isInteger(now) ? '' : now.toFixed(2).slice(-2);
  const tail = /,-\s*$/.test(text) ? ',-' : '';
  const separated = /[.,]\d{2}\s*$/.exec(text)?.[0].charAt(0) ?? '';
  const raised = (view.spans ?? []).some((span) => span.name === 'superscript');
  // Whole kroner in a mark that set øre is written the chain's way: "89,-".
  const next = cents ? `${whole}${raised ? '' : separated || ','}${cents}` : `${whole}${tail || (raised ? ',-' : '')}`;
  return {
    ...view,
    text: next,
    spans: raised && cents
      ? [{ start: whole.length, end: next.length, name: 'superscript' }]
      : (view.spans ?? []).filter((span) => span.name !== 'superscript'),
  };
}

/** A line that states an amount: "84,95", "89,-", or a figure set as bare digits, "2595". */
const AMOUNT = /\d+[.,]\d{2}(?!\d)|\d+,-|^\s*\d{3,}\s*$/;

/** Whether the cell now holds another product than the one printed there. */
function replacedIn(scope: { was: IncitoBinding; now: IncitoBinding }): boolean {
  const { was, now } = scope;
  return was.id && now.id ? was.id !== now.id : plain(was.name) !== plain(now.name);
}

/**
 * Whether an element only states the old product's amounts — a
 * "Medlemsrabat op til 25,95" sticker, say. It goes as a whole, so no
 * empty disc is left on the new product. An element that also holds the
 * price mark, the name or the words is kept, and loses only the lines.
 */
function staleElement(view: View, scope: { was: IncitoBinding; now: IncitoBinding }): boolean {
  const texts: View[] = [];
  const collect = (node: View) => {
    if (node.view_name === 'TextView') texts.push(node);
    for (const child of node.child_views ?? []) collect(child);
  };
  collect(view);
  const { was, now } = scope;
  const known = (text: string) => text === plain(was.name)
    || (was.description !== undefined && text === plain(was.description))
    || (was.pack !== undefined && text === plain(was.pack));
  let stale = false;
  for (const node of texts) {
    const text = plain(node.text ?? '');
    if (!text) continue;
    if (known(text) || refigure(node, was.price, now.price)) return false;
    if (AMOUNT.test(text)) stale = true;
  }
  return stale;
}

function textHtml(view: View): string {
  const text = view.text ?? '';
  const spans = [...(view.spans ?? [])].sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const span of spans) {
    const start = Math.max(at, Math.min(span.start, text.length));
    const end = Math.max(start, Math.min(span.end, text.length));
    out += escape(text.slice(at, start));
    out += `<span style="font-family:inherit;color:inherit;" data-name="${escape(span.name)}">${escape(text.slice(start, end))}</span>`;
    at = end;
  }
  const html = (out + escape(text.slice(at))).replace(/\n/g, '<br>');
  if (!view['fra']) return html;
  // Small, at the top of the figure, like the raised øre — and the figure
  // gives up just the room it takes, so the mark keeps its size.
  const ems = text.length * 0.58;
  return `<span style="font-size:${(ems / (ems + 0.62)).toFixed(3)}em"><span data-name="fra" style="font-size:0.32em;vertical-align:1.75em;margin-right:0.15em;text-transform:none">fra</span>${html}</span>`;
}

/** Where the walk is: the element it is inside, and that element's corrections. */
interface Walk {
  /** Offer view id → what it shows now; `null` for a cell taken off the page. */
  bind: Map<string, IncitoBinding | null>;
  /** Offer view id → what the publication printed there, when the avis still has it. */
  was: Map<string, IncitoBinding>;
  edits: Record<string, IncitoEditInput>;
  sheetArea: number;
  sheetWidth: number;
  path: string;
  /** Inside an element: its path, its size, and how many of its lines have been set. */
  block: { path: string; line: number; area: number } | null;
  parent: View | null;
  /** Where this view's parent stands on the sheet, in points — as the import measured offers. */
  at: { x: number; y: number };
  /** Offer view id → its cell's box before and now, in sheet points — see `cellFit`. */
  cells: Map<string, CellMove>;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * How an offer follows its cell.
 *
 * An imported page draws each offer where the publication put it, and
 * its cell in "Rediger layout" started as exactly that box. Moving or
 * resizing the cell moves and scales the whole offer into it — product,
 * words and price together — keeping its shape and centring it. A cell
 * nobody touched is where the offer already is, and nothing changes.
 */
function cellFit(own: Box, { base, cell }: CellMove): { dx: number; dy: number; scale: number } | null {
  if (base.w <= 0 || base.h <= 0 || cell.w <= 0 || cell.h <= 0) return null;
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  if (same(base.x, cell.x) && same(base.y, cell.y) && same(base.w, cell.w) && same(base.h, cell.h)) return null;
  // The move that takes the cell's old box to its new one, applied to the offer.
  const scale = Math.min(cell.w / base.w, cell.h / base.h);
  const x = cell.x + (cell.w - base.w * scale) / 2 + (own.x - base.x) * scale;
  const y = cell.y + (cell.h - base.h * scale) / 2 + (own.y - base.y) * scale;
  return { dx: x - own.x, dy: y - own.y, scale };
}

/** A cell's box before and after it was edited, in the same units as the offer's own box. */
interface CellMove { base: Box; cell: Box }

const inPoints = (box: Box, width: number, height: number): Box => ({
  x: box.x * width, y: box.y * height, w: box.w * width, h: box.h * height,
});

function viewHtml(view: View, walk: Walk, offer: { was: IncitoBinding; now: IncitoBinding } | null, root: boolean): string {
  let current = view;
  let scope = offer;
  const bind = walk.bind;
  // An element begins here — on the page, or nested inside another one.
  const starts = !root && (walk.block
    ? isNested(view, walk.block.area)
    : isBlock(view, walk.sheetArea, walk.parent));
  const block = starts ? { path: walk.path, line: 0, area: area(view) } : walk.block;

  // Entering an offer: learn what it printed, and what it shows now.
  let gone = false;
  if (view.role === 'offer' && view.id && bind.has(view.id)) {
    const now = bind.get(view.id);
    const label = splitLabelPrice(view.accessibility_label ?? '');
    /*
     * The price the tree printed is the one in its own label — not the
     * document's copy of the offer, which is exactly what a correction
     * changes. Read off the document, a price typed in by hand compared
     * equal to itself and the mark never moved.
     */
    const printed = walk.was.get(view.id);
    const was = printed
      ? { ...printed, ...(label && Number.isFinite(label.price) ? { price: label.price } : {}) }
      : label ? { id: view.id, name: label.name, price: label.price } : null;
    if (now === null) gone = true;
    else if (was && now) scope = { was, now };
    // Already drawn for what stands there now — see `boundIncito` — so
    // nothing inside is matched against the old words, or hidden.
    if (view['paged_cell']) {
      gone = false;
      scope = null;
    }
  }
  if (starts && scope && replacedIn(scope) && staleElement(view, scope)) current = { ...current, stale: true };
  if (scope && current.view_name === 'TextView') {
    const text = plain(current.text ?? '');
    const { was, now } = scope;
    if (text && text === plain(was.name)) {
      if (now.name !== was.name) current = { ...current, text: now.name, spans: [] };
    } else if (text && was.description && text === plain(was.description)) {
      if (now.description !== undefined && now.description !== was.description) current = { ...current, text: now.description, spans: [] };
    } else if (text && was.pack && text === plain(was.pack)) {
      if (now.pack !== undefined && now.pack !== was.pack) current = { ...current, text: now.pack, spans: [] };
    } else {
      const figure = refigure(current, was.price, now.price);
      /*
       * Another product's amounts are not this one's. A cell taken over
       * kept the old product's "Pris ikke-medlem op til 84,95" and
       * "Medlemsrabat op til 25,95" under the new product's price — a
       * price in print that nobody set. Any line with an amount in it
       * that is not the figure, the name or the words is dropped.
       */
      if (!figure && replacedIn(scope) && AMOUNT.test(text)) current = { ...current, stale: true };
      /*
       * "fra" in front of the lowest price, whenever the products under
       * one mark cost different amounts — the figure alone promises the
       * lowest price for all of them, and that is the complaint at the till.
       */
      if (figure) current = now.priceFrom ? { ...figure, fra: true } : figure;
    }
  }
  // The packshot the publication printed becomes the new product's —
  // or, for a cell somebody assembled, every product's, side by side.
  let packed = false;
  if (scope?.was.imageUrl && current['background_image'] === scope.was.imageUrl) {
    if ((scope.now.imagePack ?? []).length > 1) {
      packed = true;
      current = { ...current, background_image: undefined };
    } else if (scope.now.imageUrl && scope.now.imageUrl !== scope.was.imageUrl) {
      current = { ...current, background_image: scope.now.imageUrl };
    }
  }
  // A hand-written line beats both the publication and the feed.
  if (block && current.view_name === 'TextView') {
    const typed = walk.edits[block.path]?.texts?.[block.line];
    block.line += 1;
    if (typed !== undefined) current = { ...current, text: typed, spans: [] };
  }

  // Where this view stands, as the import measured it: offsets added up, scale ignored.
  const here = root ? { x: 0, y: 0 } : {
    x: walk.at.x + (Number(current['layout_left']) || 0),
    y: walk.at.y + (Number(current['layout_top']) || 0),
  };
  const cell = current.role === 'offer' && current.id ? walk.cells.get(current.id) : undefined;
  const fit = cell ? cellFit({
    x: here.x, y: here.y, w: Number(current['layout_width']) || 0, h: Number(current['layout_height']) || 0,
  }, cell) : null;

  const kind = current.view_name;
  const styles: string[] = [];
  if (current.style) styles.push(String(current.style).trim().replace(/;+$/, ''));
  if (kind === 'TextView' && (current.max_lines ?? 0) > 1) {
    styles.push(`display:-webkit-box;-webkit-line-clamp:${current.max_lines};-webkit-box-orient:vertical`);
  }
  const put = (css: string, value: string | null) => { if (value !== null) styles.push(`${css}:${value}`); };
  if (root) {
    // The sheet stands at the origin of its own box, as the viewer puts it.
    styles.unshift('position:relative');
  }
  put('width', length(current['layout_width']));
  put('height', length(current['layout_height']));
  if (!root) {
    put('top', length(current['layout_top']));
    put('left', length(current['layout_left']));
    put('right', length(current['layout_right']));
    put('bottom', length(current['layout_bottom']));
  }
  if (!root) put('margin-top', length(current['layout_margin_top']));
  if (!root) put('margin-left', length(current['layout_margin_left']));
  if (!root) put('margin-right', length(current['layout_margin_right']));
  if (!root) put('margin-bottom', length(current['layout_margin_bottom']));
  put('padding-top', length(current['padding_top']));
  put('padding-left', length(current['padding_left']));
  put('padding-right', length(current['padding_right']));
  put('padding-bottom', length(current['padding_bottom']));
  put('max-width', length(current['max_width']));
  put('max-height', length(current['max_height']));
  put('min-width', length(current['min_width']));
  put('min-height', length(current['min_height']));
  if (typeof current['background_color'] === 'string') put('background-color', current['background_color'] as string);
  if (typeof current['corner_radius'] !== 'undefined') put('border-radius', length(current['corner_radius']));
  if (typeof current['opacity'] === 'number') put('opacity', String(current['opacity']));
  if (current['clip_children'] === false) put('overflow', 'visible');
  if (current['clip_children'] === true) put('overflow', 'hidden');
  /*
   * The sheet's own scale, margins and origin are about fitting it into
   * the viewer's section — some Coop publications wrap a 600 × 1000
   * sheet in a 1200 × 2000 section and scale it by 2 to fill it. We fit
   * the sheet ourselves (see `IncitoPage`), so applying that scale as
   * well drew every page twice the size and cropped it to its top-left.
   */
  const origin = root ? undefined : current['transform_origin'];
  if (Array.isArray(origin)) put('transform-origin', origin.join(' '));
  const scale = root ? undefined : current['transform_scale'];
  const rotate = root ? undefined : current['transform_rotate'];
  // A hand move comes first, so it moves the element as published — its
  // own scale and turn still happen about its own corner.
  const moved = starts ? walk.edits[walk.path] : undefined;
  const transforms = [
    fit ? `translate(${fit.dx.toFixed(2)}px, ${fit.dy.toFixed(2)}px) scale(${fit.scale.toFixed(4)})` : '',
    moved && (moved.dx || moved.dy) ? `translate(${moved.dx ?? 0}px, ${moved.dy ?? 0}px)` : '',
    moved && moved.scale && moved.scale !== 1 ? `scale(${moved.scale})` : '',
    typeof scale === 'number' && scale !== 1 ? `scale(${scale})` : '',
    typeof rotate === 'number' && rotate !== 0 ? `rotate(${rotate}deg)` : '',
  ].filter(Boolean);
  if (transforms.length) put('transform', transforms.join(' '));
  // Something taken in hand and put down elsewhere lies on top, as a tile's moved box does.
  if (moved && (moved.dx || moved.dy || (moved.scale ?? 1) !== 1)) put('z-index', '50');
  const image = current['background_image'];
  if (typeof image === 'string' && image) {
    put('background-position', String(current['background_image_position'] ?? 'center_center').replace('_', ' '));
    put('background-size', typeof current['background_image_size'] === 'string'
      ? current['background_image_size'] as string
      : SCALE_TYPE[String(current['background_image_scale_type'])] ?? 'auto');
    put('background-image', `url("${image.replace(/"/g, '%22')}")`);
  }

  if ((starts && walk.edits[walk.path]?.hidden) || gone || current['stale']) put('display', 'none');
  /*
   * Every box around a moved element lets it out: the offer clips its
   * contents, and a price mark dragged past the edge of its own offer
   * was cut in half — on screen and in the PDF.
   */
  if (!starts && !block && movedWithin(walk.edits, walk.path)) put('overflow', 'visible');
  const style = styles.length ? ` style="${escape(styles.join(';'))};"` : '';
  const blockAttr = starts ? ` data-incito-block="${escape(walk.path)}"` : '';
  const gravity = typeof current['layout_gravity'] === 'string' ? ` data-gravity="${escape(current['layout_gravity'] as string)}"` : '';
  const offerAttr = current.role === 'offer' && current.id ? ` data-offer-view="${escape(current.id)}"` : '';

  if (kind === 'ImageView') {
    return `<img class="tjek-incito__view tjek-incito__image-view"${blockAttr}${style} src="${escape(current.src ?? '')}" alt="">`;
  }
  if (kind === 'TextView') {
    const single = current.max_lines === 1 ? ' data-single-line="true"' : '';
    return `<p class="tjek-incito__view tjek-incito__text-view"${blockAttr}${single}${style}>${textHtml(current)}</p>`;
  }
  // Its products are the chain's own tile over the sheet — see `incitoPacks`.
  if (packed) {
    return `<div class="tjek-incito__view"${gravity}${offerAttr}${blockAttr}${style}></div>`;
  }
  const children = (current.child_views ?? [])
    .map((child, index) => viewHtml(child, { ...walk, path: root ? keyOf(child, index) : `${walk.path}.${keyOf(child, index)}`, block, parent: current, at: here }, scope, false))
    .join('');
  return `<div class="tjek-incito__view"${gravity}${offerAttr}${blockAttr}${style}>${children}</div>`;
}

/**
 * An element's place in the tree, as its edits are keyed.
 *
 * Its index among its siblings — except where the tree names it: the
 * cells of a sheet made from a page picture are made from the page's
 * layout, and a cell added or taken away would otherwise hand every
 * later cell's corrections to its neighbour.
 */
function keyOf(view: View, index: number): string {
  return typeof view['path_key'] === 'string' ? view['path_key'] : String(index);
}

/** Whether an element at or under this path has been moved or resized. */
function movedWithin(edits: Record<string, IncitoEditInput>, path: string): boolean {
  return Object.entries(edits).some(([at, edit]) => (path === '' || at.startsWith(`${path}.`))
    && (Boolean(edit.dx) || Boolean(edit.dy) || (edit.scale ?? 1) !== 1));
}

const containsOffer = new WeakMap<View, boolean>();

/** Whether an offer lives somewhere under this view. */
function holdsOffer(view: View): boolean {
  const known = containsOffer.get(view);
  if (known !== undefined) return known;
  const found = view.role === 'offer' || (view.child_views ?? []).some(holdsOffer);
  containsOffer.set(view, found);
  return found;
}

const area = (view: View) => (Number(view['layout_width']) || 0) * (Number(view['layout_height']) || 0);

/** Placed by coordinates — by the tree's own fields, or by its CSS. */
const positioned = (view: View) => view['layout_top'] !== undefined || view['layout_left'] !== undefined
  || /position\s*:\s*absolute/.test(String(view.style ?? ''));

const hasWords = (view: View): boolean => view.view_name === 'TextView'
  || (view.child_views ?? []).some(hasWords);

/**
 * A thing inside a thing: the "Storkøb min. 1,3 kg" roundel set inside
 * the packshot's box, a line of words inside a price mark's panel.
 * Pointed at directly, it is taken on its own — the element around it
 * stays. Only when it is clearly smaller than what holds it, so a
 * roundel's inner box the same size as the roundel is not a second one.
 */
function isNested(view: View, outerArea: number): boolean {
  // Placed by coordinates or laid out in a column — a roundel stacked
  // under a packshot's marks is still one thing to point at.
  if (view.view_name === 'TextView' || view.view_name === 'ImageView') return false;
  const size = area(view);
  if (size <= 0 || size >= outerArea * 0.7) return false;
  return hasWords(view) || Boolean(view['background_image']);
}

/**
 * Whether a view is one thing a person would point at on the page.
 *
 * The roundel with "Storkøb min. 1,3 kg", a price mark, the words under
 * a product, a packshot, a column of certification marks, the section
 * headline. Not the offer around them and not the boxes that only hold
 * offers — those are furniture — and not a sheet-sized ground or
 * texture, which would answer every click on an empty patch of paper.
 */
function isBlock(view: View, sheetArea: number, parent: View | null): boolean {
  if (holdsOffer(view)) return false;
  // A box that fills its parent and holds several things is a frame
  // around them — the inset inside every offer — not one of them.
  if (parent && (view.child_views?.length ?? 0) >= 2) {
    const across = (Number(view['layout_width']) || 0) / (Number(parent['layout_width']) || Infinity);
    const down = (Number(view['layout_height']) || 0) / (Number(parent['layout_height']) || Infinity);
    if (across >= 0.85 && down >= 0.85) return false;
  }
  if (!positioned(view)) return false;
  const size = area(view);
  if (size <= 0) return false;
  // A large box holding several things is a layer of the page — the
  // strip that carries a page's roundels — not one thing on it.
  if ((view.child_views?.length ?? 0) >= 2 && size >= sheetArea * 0.4) return false;
  return size < sheetArea * 0.9;
}

/** One element of a published page, as the editor lists it. */
export interface IncitoBlock {
  path: string;
  kind: 'skilt' | 'tekst' | 'billede' | 'mærker';
  /** Its lines, as published, in the order they are set. */
  texts: string[];
  /** The offer it belongs to, when it belongs to one. */
  offerId: string | null;
  /** Where it stands on the sheet, in the sheet's own points. */
  rect: { x: number; y: number; w: number; h: number };
  /**
   * Elements that are the same thing on paper: the white disc drawn
   * behind a roundel's words is its own box in the tree, and taking
   * the words away left the disc standing. Deleting one deletes these.
   */
  companions: string[];
}

/** Every element of a published page, in reading order — see `isBlock`. */
export function incitoBlocks(source: IncitoSource): IncitoBlock[] {
  const sheet = incitoSheet(source);
  const sheetArea = sheet.width * sheet.height;
  const found: IncitoBlock[] = [];
  // An element's own lines — not those of an element nested inside it.
  const texts = (view: View, outer = area(view)): string[] => (view.view_name === 'TextView'
    ? [view.text ?? '']
    : (view.child_views ?? []).filter((child) => !isNested(child, outer)).flatMap((child) => texts(child, outer)));
  const images = (view: View): number => (view.view_name === 'ImageView' ? 1 : 0)
    + (view.child_views ?? []).reduce((sum, child) => sum + images(child), 0);
  const drawn = (view: View): boolean => Boolean(view['background_image'])
    || (view.child_views ?? []).some(drawn);
  const visit = (
    view: View, path: string, offerId: string | null, parent: View | null,
    at: { x: number; y: number; k: number; outer: number | null },
  ) => {
    const owner = view.role === 'offer' && view.id ? view.id : offerId;
    const x = at.x + (Number(view['layout_left']) || 0) * at.k;
    const y = at.y + (Number(view['layout_top']) || 0) * at.k;
    const k = at.k * (typeof view['transform_scale'] === 'number' ? view['transform_scale'] as number : 1);
    const inside = at.outer;
    if (path && (inside !== null ? isNested(view, inside) : isBlock(view, sheetArea, parent))) {
      const lines = texts(view);
      found.push({
        path,
        kind: lines.length && drawn(view) ? 'skilt'
          : lines.length ? 'tekst'
            : images(view) > 0 ? 'mærker' : 'billede',
        texts: lines,
        offerId: owner,
        rect: { x, y, w: (Number(view['layout_width']) || 0) * k, h: (Number(view['layout_height']) || 0) * k },
        companions: [],
      });
      // Keep looking inside it, for what is nested there.
      (view.child_views ?? []).forEach((child, index) => visit(
        child, `${path}.${keyOf(child, index)}`, owner, view, { x, y, k, outer: area(view) },
      ));
      return;
    }
    (view.child_views ?? []).forEach((child, index) => visit(
      child, path ? `${path}.${keyOf(child, index)}` : keyOf(child, index), owner, view,
      path ? { x, y, k, outer: inside } : { x: 0, y: 0, k: 1, outer: null },
    ));
  };
  visit(sheet.view, '', null, null, { x: 0, y: 0, k: 1, outer: null });

  /*
   * Pair words with the plain shape standing right behind them: two
   * boxes, one with no words, covering the same patch of paper. "The
   * same patch" is measured against the LARGER box, so a price mark
   * lying over a packshot is not paired with the packshot.
   */
  const overlap = (a: IncitoBlock['rect'], b: IncitoBlock['rect']) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.max(a.w * a.h, b.w * b.h) : 0;
  };
  for (const a of found) {
    for (const b of found) {
      if (a === b || (a.texts.length > 0) === (b.texts.length > 0)) continue;
      // Or words set inside a disc a little larger than they are.
      const [words, shape] = a.texts.length ? [a.rect, b.rect] : [b.rect, a.rect];
      const cx = words.x + words.w / 2;
      const cy = words.y + words.h / 2;
      const inside = cx > shape.x && cx < shape.x + shape.w && cy > shape.y && cy < shape.y + shape.h
        && shape.w * shape.h <= words.w * words.h * 3;
      if (overlap(a.rect, b.rect) >= 0.5 || inside) a.companions.push(b.path);
    }
  }
  return found;
}

/**
 * The page at its own size, stepping through a section wrapped around it.
 *
 * Pages imported before the importer learned this (see `drawnSheet` in
 * `@incitio/publication`) stored the viewer's section — say 375 wide —
 * with the 600-wide page inside it, and drew every sheet zoomed in and
 * cropped. Done again here, at print time, so those pages heal without
 * being imported again.
 */
export function incitoSheet(source: IncitoSource): { view: View; width: number; height: number } {
  let view = source.view as View;
  const size = (node: View) => [Number(node['layout_width']), Number(node['layout_height'])] as const;
  for (let depth = 0; depth < 4; depth += 1) {
    const sized = (view.child_views ?? []).filter((child) => {
      const [w, h] = size(child);
      return w > 0 && h > 0;
    });
    const child = sized.length === 1 ? sized[0]! : undefined;
    if (!child || (child.child_views?.length ?? 0) === 0) break;
    const [pw, ph] = size(view);
    const [cw, ch] = size(child);
    if (!(pw > 0 && ph > 0) || Math.abs((cw / ch) / (pw / ph) - 1) > 0.02) break;
    view = child;
  }
  const [w, h] = size(view);
  return { view, width: w > 0 ? w : source.width, height: h > 0 ? h : source.height };
}

/**
 * The page's HTML, with each offer showing what the avis says today.
 *
 * `offers` binds by the publication's own offer id: an offer whose name
 * or price has since changed — a corrected feed — prints the new words
 * in the old typography. Everything else is exactly as published.
 */
export function incitoHtml(
  source: IncitoSource,
  offers: Map<string, Offer | null> = new Map(),
  edits: Record<string, IncitoEditInput> = {},
  printed: Map<string, Offer> = new Map(),
  /** Offer view id → its cell before and now, in shares of the sheet — see `incitoCellBoxes`. */
  cells: Map<string, CellMove> = new Map(),
): string {
  const bind = new Map<string, IncitoBinding | null>();
  for (const [id, offer] of offers) bind.set(id, offer ? binding(offer) : null);
  const was = new Map<string, IncitoBinding>();
  for (const [id, offer] of printed) was.set(id, binding(offer));
  const sheet = incitoSheet(source);
  const moves = new Map([...cells].map(([id, move]) => [id, {
    base: inPoints(move.base, sheet.width, sheet.height),
    cell: inPoints(move.cell, sheet.width, sheet.height),
  }]));
  return viewHtml(sheet.view, {
    bind, was, edits, sheetArea: sheet.width * sheet.height, sheetWidth: sheet.width, path: '', block: null, parent: null,
    at: { x: 0, y: 0 }, cells: moves,
  }, null, true);
}

/**
 * Which product each of a published page's offers shows now.
 *
 * By cell: `IncitoSource.slots` says which of the publication's offers
 * stood in which cell, and the page's placements say what stands there
 * now. A cell with nobody in it hides its offer — taking a product off
 * a published page takes it off the page. A page imported before slots
 * were recorded is read by id, which is right until a cell is refilled.
 *
 * `null` when some product stands in a cell the publication never had —
 * a grown grid — which is the one thing its tree cannot draw.
 */
export function incitoCells(
  page: { placements: { offerId: string; slotId: string; overrides?: { displayName?: string | null; description?: string | null } }[]; incito: IncitoSource },
  offers: Map<string, Offer>,
): { now: Map<string, Offer | null>; printed: Map<string, Offer> } | null {
  // A sheet made from a page picture has its cells in the layout, not in
  // the tree — see `boundIncito` — and can always draw what stands in them.
  if ((page.incito.view as View)['paged']) return { now: new Map(), printed: new Map() };
  const views = offerViewIds(page.incito.view as View);
  const slots = page.incito.slots ?? {};
  const now = new Map<string, Offer | null>();
  const printed = new Map<string, Offer>();
  for (const id of views) {
    now.set(id, null);
    // The avis's copy first; else what the page itself remembers printing.
    const remembered = page.incito.printed?.[id];
    const original = offers.get(id)
      ?? (remembered ? { ...remembered, id, description: remembered.description ?? '', pack: remembered.pack ?? '', imageUrl: remembered.imageUrl ?? null } as unknown as Offer : undefined);
    if (original) printed.set(id, original);
  }
  for (const placement of page.placements) {
    const viewId = slots[placement.slotId] ?? (views.has(placement.offerId) ? placement.offerId : undefined);
    if (!viewId || !views.has(viewId)) return null;
    const offer = offers.get(placement.offerId);
    if (!offer) continue;
    // The tile's own rewording, when somebody gave one.
    const name = placement.overrides?.displayName ?? null;
    const description = placement.overrides?.description ?? null;
    now.set(viewId, {
      ...offer,
      ...(name !== null ? { name } : {}),
      ...(description !== null ? { description } : {}),
    });
  }
  return { now, printed };
}

/** A cluster standing in one of the publication's cells, and the box its packshot was printed in. */
export interface IncitoPack {
  slotId: string;
  offerId: string;
  /** In shares of the sheet. */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * The clusters on a published page, and where each is drawn.
 *
 * The tree can print one packshot in a cell; a cluster is several, each
 * moved, scaled and stood up on its own. So the tree leaves the printed
 * packshot's box empty (see `viewHtml`) and the chain's own tile draws
 * the products there — with every tool a tile has, and the model's.
 */
export function incitoPacks(
  page: { placements: { offerId: string; slotId: string }[]; incito: IncitoSource; incitoEdits?: Record<string, IncitoEditInput> },
  offers: Map<string, Offer>,
  template?: { slots: { id: string; rect?: Box | null }[] } | null,
): IncitoPack[] {
  const cellBoxes = incitoCellBoxes(page, template);
  const cells = incitoCells(page, offers);
  if (!cells) return [];
  const sheet = incitoSheet(page.incito);
  const edits = page.incitoEdits ?? {};
  const slots = page.incito.slots ?? {};
  const views = offerViewIds(page.incito.view as View);
  const found: IncitoPack[] = [];
  for (const placement of page.placements) {
    const offer = offers.get(placement.offerId);
    if (!offer || offer.imagePack.length <= 1) continue;
    const viewId = slots[placement.slotId] ?? (views.has(placement.offerId) ? placement.offerId : undefined);
    const shot = viewId ? cells.printed.get(viewId)?.imageUrl : null;
    if (!viewId || !shot) continue;
    type Box = { x: number; y: number; w: number; h: number };
    const moves: { at: Box; dx: number; dy: number; scale: number }[] = [];
    let offerBox: Box | null = null;
    const walk = (view: View, path: string, x0: number, y0: number, k0: number, inside: boolean): Box | null => {
      // The sheet stands at its own origin, at its own size — as `viewHtml` draws it.
      const root = view === sheet.view;
      const x = root ? 0 : x0 + (Number(view['layout_left']) || 0) * k0;
      const y = root ? 0 : y0 + (Number(view['layout_top']) || 0) * k0;
      const k = root ? 1 : k0 * (typeof view['transform_scale'] === 'number' ? view['transform_scale'] as number : 1);
      const box = { x, y, w: (Number(view['layout_width']) || 0) * k, h: (Number(view['layout_height']) || 0) * k };
      const within = inside || (view.role === 'offer' && view.id === viewId);
      if (!inside && within) offerBox = box;
      const edit = path ? edits[path] : undefined;
      const moved = edit && (edit.dx || edit.dy || (edit.scale ?? 1) !== 1);
      if (moved) moves.push({ at: box, dx: edit.dx ?? 0, dy: edit.dy ?? 0, scale: edit.scale ?? 1 });
      if (within && view['background_image'] === shot) return box;
      for (const [index, child] of (view.child_views ?? []).entries()) {
        const hit = walk(child, path ? `${path}.${keyOf(child, index)}` : keyOf(child, index), x, y, k, within);
        if (hit) return hit;
      }
      if (moved) moves.pop();
      return null;
    };
    let box = walk(sheet.view, '', 0, 0, 1, false);
    if (!box || box.w <= 0 || box.h <= 0) continue;
    // A packshot taken in hand and put down elsewhere stays where it was put.
    for (const move of moves.reverse()) {
      box = {
        x: move.at.x + move.dx + (box.x - move.at.x) * move.scale,
        y: move.at.y + move.dy + (box.y - move.at.y) * move.scale,
        w: box.w * move.scale,
        h: box.h * move.scale,
      };
    }
    // The offer follows its cell — see `cellFit`.
    const move = cellBoxes.get(viewId);
    const own = offerBox as Box | null;
    const fit = move && own ? cellFit(own, {
      base: inPoints(move.base, sheet.width, sheet.height),
      cell: inPoints(move.cell, sheet.width, sheet.height),
    }) : null;
    if (fit && own) {
      box = {
        x: own.x + fit.dx + (box.x - own.x) * fit.scale,
        y: own.y + fit.dy + (box.y - own.y) * fit.scale,
        w: box.w * fit.scale,
        h: box.h * fit.scale,
      };
    }
    found.push({
      slotId: placement.slotId,
      offerId: placement.offerId,
      rect: { x: box.x / sheet.width, y: box.y / sheet.height, w: box.w / sheet.width, h: box.h / sheet.height },
    });
  }
  return found;
}

/**
 * Each of the publication's offers and the cell it stands in now, in
 * shares of the sheet — what `incitoHtml` fits the offer into.
 */
export function incitoCellBoxes(
  page: { placements: { offerId: string; slotId: string }[]; incito: IncitoSource },
  template: { slots: { id: string; rect?: Box | null }[] } | null | undefined,
): Map<string, CellMove> {
  const boxes = new Map<string, CellMove>();
  if (!template || (page.incito.view as View)['paged']) return boxes;
  const bases = page.incito.cellBase ?? {};
  /*
   * A page edited before the boxes were recorded: a cell that has
   * plainly left its offer's printed box started from that box.
   */
  const printed = page.incito.cellBase ? null : incitoOfferBoxes(page.incito);
  const apart = (a: Box, b: Box) => Math.abs(a.x - b.x) > 0.03 || Math.abs(a.y - b.y) > 0.03
    || Math.abs(a.w - b.w) > 0.03 || Math.abs(a.h - b.h) > 0.03;
  const views = offerViewIds(page.incito.view as View);
  const slots = page.incito.slots ?? {};
  for (const slot of template.slots) {
    if (!slot.rect) continue;
    const placed = page.placements.find((entry) => entry.slotId === slot.id)?.offerId;
    const viewId = slots[slot.id] ?? (placed && views.has(placed) ? placed : undefined);
    if (!viewId || !views.has(viewId)) continue;
    const drawn = printed?.get(viewId);
    const base = bases[slot.id] ?? (drawn && apart(drawn, slot.rect) ? drawn : undefined);
    if (base) boxes.set(viewId, { base, cell: slot.rect });
  }
  return boxes;
}

/** Where each of the publication's offers is drawn, in shares of the sheet — as the import measured it. */
export function incitoOfferBoxes(source: IncitoSource): Map<string, Box> {
  const sheet = incitoSheet(source);
  const found = new Map<string, Box>();
  const walk = (view: View, x0: number, y0: number, root: boolean) => {
    const x = root ? 0 : x0 + (Number(view['layout_left']) || 0);
    const y = root ? 0 : y0 + (Number(view['layout_top']) || 0);
    if (view.role === 'offer' && typeof view.id === 'string') {
      found.set(view.id, {
        x: x / sheet.width, y: y / sheet.height,
        w: (Number(view['layout_width']) || 0) / sheet.width, h: (Number(view['layout_height']) || 0) / sheet.height,
      });
      return;
    }
    for (const child of view.child_views ?? []) walk(child, x, y, false);
  };
  walk(sheet.view, 0, 0, true);
  return found;
}

const viewIds = new WeakMap<View, Set<string>>();

/** The publication's own offer ids on a page, read once per tree. */
export function offerViewIds(view: View): Set<string> {
  const known = viewIds.get(view);
  if (known) return known;
  const found = new Set<string>();
  const walk = (node: View) => {
    if (node.role === 'offer' && typeof node.id === 'string') found.add(node.id);
    for (const child of node.child_views ?? []) walk(child);
  };
  walk(view);
  viewIds.set(view, found);
  return found;
}
