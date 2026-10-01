/**
 * The background picture for one page.
 *
 * Not a motif cut out and pinned in a corner — a whole picture the size
 * of the sheet, in the page's own flat colour, with the motif placed
 * around the space the products and the words take. Everything the
 * brief says is measured off the rendered page, not guessed: its shape,
 * its colour, where each product sits and where each line of type is.
 */

/** The aspect ratios the image model accepts. */
export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** The accepted ratio nearest to a card's own shape. */
export function nearestAspect(width: number, height: number): Aspect {
  const want = Math.log(width / Math.max(1e-6, height));
  let best: Aspect = '1:1';
  let gap = Infinity;
  for (const aspect of ASPECTS) {
    const [w, h] = aspect.split(':').map(Number) as [number, number];
    const off = Math.abs(Math.log(w / h) - want);
    if (off < gap) { gap = off; best = aspect; }
  }
  return best;
}

/** The nine parts of a card, as the brief names them. */
export const PARTS = [
  'top left', 'at the top', 'top right',
  'on the left', 'in the middle', 'on the right',
  'bottom left', 'at the bottom', 'bottom right',
] as const;
export type Part = (typeof PARTS)[number];

/** Which of the nine parts a point falls in, from shares of the card. */
export function partOf(x: number, y: number): Part {
  const col = x < 1 / 3 ? 0 : x < 2 / 3 ? 1 : 2;
  const row = y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2;
  return PARTS[row * 3 + col]!;
}

/** "a, b and c" — the parts in reading order. */
function listed(parts: Part[]): string {
  const sorted = [...new Set(parts)].sort((a, b) => PARTS.indexOf(a) - PARTS.indexOf(b));
  if (sorted.length <= 1) return sorted[0] ?? 'nowhere';
  return `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
}

/**
 * The colour a motif is painted on, and then cut away from.
 *
 * Not the page's own colour: a pale page blue is also the colour of the
 * "surface" the model likes to paint under food, and those patches could
 * not be told from the ground, so they stayed behind every motif. No
 * food is magenta, so everything magenta goes, and only the objects are
 * left to lay on the real page — see `keyOutMotifs`.
 */
export const KEY_COLOUR = '#ff00ff';

export const DEFAULT_BACKDROP_STYLE = 'Bright, appetising photography for a Danish supermarket leaflet: soft daylight from the top left, clean and modern, sparse, generous empty space, nothing cluttered.';

export interface BackdropBrief {
  aspect: Aspect;
  /** `#rrggbb`. */
  colour: string;
  /** Where products sit, each in percent of the page. */
  regions: { x0: number; x1: number; y0: number; y1: number }[];
  /** Where the words are printed. */
  text: Part[];
  /** What the page is about — its heading, or its leading offer. */
  offer: string;
  /** Up to eight offer names on the page. */
  products: string[];
  style?: string;
  /**
   * The free places on the page, measured — where nothing is printed
   * and nothing is laid. See `motifPrompt`.
   */
  spots?: { x0: number; x1: number; y0: number; y1: number }[];
}

/** The brief, as the leaflet's designer wrote it — for a whole page. */
export function backdropPrompt(brief: BackdropBrief): string {
  const round = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
  const products = brief.products.slice(0, 8);
  const more = brief.products.length > 8 ? ', …' : '';
  const style = brief.style?.trim() || DEFAULT_BACKDROP_STYLE;
  const regions = brief.regions.slice(0, 20).map((r) =>
    `from ${round(r.x0)} to ${round(r.x1)} percent of the width and from ${round(r.y0)} to ${round(r.y1)} percent of the height`);
  const where = regions.length === 1
    ? `in the region ${regions[0]}: leave that region empty`
    : `in these regions — ${regions.join('; ')}: leave those regions empty`;
  return [
    `Photograph a few food objects for one page of a Danish supermarket leaflet, ${brief.aspect}, as a cut-out: the objects alone on a pure, flat chroma-key magenta, exactly ${KEY_COLOUR}, identical in every pixel that is not an object. The magenta is not a surface and not a table — nothing is behind or under the objects: no plate unless it is part of the dish, no board, no cloth, no paper, no crumbs, no smudges, no gradient, no vignette, no lighter or darker patches, no panels, no bands, no lines. No shadows at all — not under the objects, not beside them — and no magenta reflected on them. Every object has a crisp, clean edge against the magenta.`,
    `The objects will be cut out and laid on the real page, where photographed products stand ${where}. The offers' names and prices will be printed ${listed(brief.text)}: leave those parts plain magenta too. Place the objects where they fit best in the remaining space, coming in from the edges and corners the way a leaflet does it; you decide which side. At least half of the picture stays plain magenta.`,
    `The objects fit the page "${brief.offer}"${products.length > 0 ? ` (${products.join(', ')}${more})` : ''}: photographed, not illustrated. Use very few elements: two or three objects at most, one kind of ingredient or one dish, in one place on the page. Less is more. Show ingredients, the finished dish or the raw material, never the packaged products themselves. Do not draw any boxes, frames, labels or placeholders.`,
    `No text, no letters, no numbers, no logos, no people, no packaging. Style: ${style}`,
  ].join('\n\n');
}

/** What an isolated motif needs: its frame's shape and what the page is about. */
export interface MotifBrief {
  aspect: Aspect;
  offer: string;
  products: string[];
  style?: string;
}

/**
 * One motif, drawn on its own — for the place the studio chose.
 *
 * The page brief above asked the model to lay a whole page out around
 * the products, and image models do not keep to coordinates: the motif
 * landed under the products and was thrown away, or there was "no room".
 * So the studio picks the place on the page itself (see `motifTarget` in
 * the studio), and the model is only asked for what it is good at — a
 * few objects, photographed, alone on the key colour, filling a frame of
 * exactly that place's shape. Nothing about the page reaches the model.
 */
export function motifPrompt(brief: MotifBrief): string {
  const products = brief.products.slice(0, 8);
  const more = brief.products.length > 8 ? ', …' : '';
  const style = brief.style?.trim() || DEFAULT_BACKDROP_STYLE;
  return [
    `A product photograph for a Danish supermarket leaflet, ${brief.aspect}: a cut-out of one small group of food objects, alone on a pure, flat chroma-key magenta, exactly ${KEY_COLOUR}, identical in every pixel that is not an object.`,
    `The group fills most of the frame — about four fifths of its width or height, centred, with a little plain magenta all round; nothing touches or crosses the edge of the picture.`,
    `What it shows fits the page "${brief.offer}"${products.length > 0 ? ` (${products.join(', ')}${more})` : ''}: the ingredients, the raw material or the finished dish — never the packaged products themselves. Two or three objects at most, one kind of ingredient or one dish, touching or overlapping so they read as one group. Photographed, not illustrated.`,
    `Nothing is behind or under the objects: the magenta is not a surface or a table — no board, no cloth, no paper, no plate unless it is part of the dish, no crumbs, no smudges, no gradient, no vignette, no patches, no lines. No shadows at all, and no magenta reflected on the objects. Every object has a crisp, clean edge against the magenta.`,
    `No text, no letters, no numbers, no logos, no people, no packaging. Style: ${style}`,
  ].join('\n\n');
}

