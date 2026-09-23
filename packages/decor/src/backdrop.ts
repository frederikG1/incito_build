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
    `Paint the background picture for one page of a Danish supermarket leaflet, ${brief.aspect}, filling the whole page. The background is one flat colour, exactly ${brief.colour}, identical everywhere: no gradient, no vignette, no surface texture, no lighter or darker regions, no panels, no bands. The objects lie directly on that colour.`,
    `Photographed products will be laid on top of your picture ${where}. The offers' names and prices will be printed ${listed(brief.text)}: leave those parts empty too. Place the motif where it fits best in the remaining space, coming in from the edges and corners the way a leaflet does it; you decide which side. At least half of the picture stays the plain colour.`,
    `The motif fits the page "${brief.offer}"${products.length > 0 ? ` (${products.join(', ')}${more})` : ''}: photographed, not illustrated, with only a soft shadow directly under each object. Use very few elements: two or three objects at most, one kind of ingredient or one dish, in one place on the page. Less is more. Show ingredients, the finished dish or the raw material, never the packaged products themselves. Do not draw any boxes, frames, labels or placeholders.`,
    `No text, no letters, no numbers, no logos, no people, no packaging. Style: ${style}`,
  ].join('\n\n');
}
