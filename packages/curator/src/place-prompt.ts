/**
 * The words the placement is decided in — and nothing else.
 *
 * Its own file, with no imports at all, because three places need it
 * and one of them is a browser: the studio shows the prompt and lets
 * an editor rewrite it for the session, which is the fastest way
 * anybody has found to improve a tile. `place.ts` cannot be imported
 * there — it reaches two model SDKs — so what is shared is the part
 * that is only text.
 */
/**
 * The craft, stated as the rules a leaflet actually follows.
 *
 * Every line here is the same instruction `clusterPrompt` gives the
 * image model, turned from something to draw into something to state:
 * one baseline, one hero, honest relative sizes, overlap without
 * burial. Kept in one exported string so it can be read — this is
 * where the tile's quality is decided, and a prompt nobody can read is
 * a prompt nobody can fix.
 */
/**
 * The stand-ins a prompt leaves for the facts of this one call.
 *
 * Four, and every one of them is something that changes from tile to
 * tile: the cell's measurements, how many cutouts there are, what they
 * are called, and what the offer is called. A prompt that stated any
 * of them would be right for one tile and wrong for the rest — a model
 * asked for pixels inside an unstated box invents a scale, and two
 * products it meant to be the same size come back a few per cent
 * apart.
 *
 * They are left visible in the editable prompt, so somebody rewriting
 * it can move them, keep them, or drop the ones they do not want.
 */
export const CANVAS_TOKEN = '{canvas}';
export const COUNT_TOKEN = '{count}';
export const PRODUCTS_TOKEN = '{products}';
export const OFFER_TOKEN = '{offer}';

/** What this call is about, for the tokens above. */
export interface PlaceFacts {
  canvas: { width: number; height: number };
  /** Numbered as the model is shown them, first is 1. */
  products?: { name: string; aspect?: number | undefined }[];
  offerName?: string | undefined;
}

/** The canvas as a sentence — said in words as well as in figures. */
function canvasSaid(canvas: { width: number; height: number }): string {
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  const ratio = width / height;
  // "square" is the fact a model needs; "1.01:1" is a number it has to
  // interpret, and getting it wrong on a tall cell is how a group ends
  // up laid out sideways.
  const shape = Math.abs(ratio - 1) <= 0.05
    ? 'square'
    : ratio > 1 ? 'wider than it is tall' : 'taller than it is wide';
  return `The canvas is ${shape}, ${ratio.toFixed(2)}:1 (width:height), `
    + `${width} x ${height} pixels.`;
}

/**
 * The prompt with this call's facts written into it.
 *
 * A prompt with none of the tokens comes back untouched: an editor's
 * own version is theirs, and `placeCluster` states the same facts in
 * the brief either way.
 */
export function placeSystem(prompt: string, facts: PlaceFacts): string {
  const list = (facts.products ?? [])
    .map((product, index) => `${index + 1}. ${product.name}`
      + (product.aspect && product.aspect > 0 ? ` (aspect ${product.aspect.toFixed(2)})` : ''))
    .join('\n');

  return prompt
    .split(CANVAS_TOKEN).join(canvasSaid(facts.canvas))
    .split(COUNT_TOKEN).join(String(facts.products?.length ?? 0))
    .split(PRODUCTS_TOKEN).join(list)
    .split(OFFER_TOKEN).join(facts.offerName?.trim() || 'tilbuddet');
}

/** Whether a prompt names the products itself, so the brief need not. */
export function namesProducts(prompt: string): boolean {
  return prompt.includes(PRODUCTS_TOKEN);
}

export const PLACE_SYSTEM = `You lay out product cutouts for one offer in a Danish
supermarket leaflet (SuperBrugsen, Kvickly, føtex). You place; you never draw. What prints
is the chain's own cutouts, moved to the exact numbers you return.

THE CANVAS
{canvas} You must use the whole canvas efficiently.

1. SIZE RELATIVE TO EACH OTHER — THE FIRST RULE
The cutouts arrive not to scale: each was photographed to fill its own frame, so a lip balm
and a 1.5 l bottle arrive the same size. You must give every product the size it has in
real life beside the others, in BOTH dimensions, based on the stated pack size and what the
product plainly is. Two products of the same stated pack size must be within a few per cent
of the same height. This is what a printed page never gets wrong.

Height alone is not the rule. A flat 350 g cheese tub is a few centimetres tall and a hand
wide; a 1 l carton is four times its height and a third of its width. Drawn to the same
height they are honest about neither, and the wide one covers three times the area and
reads as the biggest thing in the offer. If two products come out the same height, at least
one of them is wrong — and if one is much wider than the rest, it must be correspondingly
shorter.

2. HOW THEY WERE PHOTOGRAPHED DECIDES THE SCENE
Side-shots: cutouts shot from the side stand on one shared floor.
Top-shots: cutouts shot from above — tubs, trays, pizzas, sweets — lie on one surface seen
from above: a flat lay spread across the whole canvas with slight turns, and no floor.
Choose the view most of the products were shot in and report it. A product photographed
from the other angle must be placed beside the main group, never overlapping it.

3. THE GROUP AND THE HERO
Create one compact group, not a queue and not a scatter. The hero — the product the offer
is named after, or else the most recognisable pack — stands in front and slightly larger
than its natural size. Standing products share one baseline: the same bottom edge, within
1 % of the canvas height, unless one is deliberately stepped back.

4. OVERLAP AND DEPTH
Products touch or overlap so the group reads as one composition with depth.
- No product is more than a quarter (25 %) covered.
- Keep labels readable: overlap falls on lids, edges and bottoms — never on a brand name or
  the front of a label.
- Depth follows the floor: of two standing products, the one whose feet sit lower on the
  canvas (higher Y-coordinate) is nearer to the viewer and in front. The covered_by array
  must strictly agree with this.

5. FILL THE CANVAS (PRIORITY ORDER)
1. Every label remains readable.
2. Honest relative sizes are maintained.
3. Nothing is clipped: every box lies completely inside the canvas.
4. Scale as large as those three allow — the group should span at least 90 % of the canvas
   width and 85 % of the height.

ANSWER FORMAT
One entry per product, every product exactly once, keyed by the number it was given.
Integers in canvas pixels, no prose, no colours, no advice:
  index         the product's number
  left, top     the top-left corner of the product's own bounding box
  width, height the whole product, including any covered parts, with the cutout's
                proportions kept: width = round(height × aspect)
  tilt_degrees  0 unless a small lean helps; larger turns only in a flat lay
  covered_by    the numbers of the products drawn in front of this one, e.g. [2, 3] or []
And once for the whole composition: view — "side" or "top".`;

/**
 * The same craft, told rather than listed.
 *
 * A second standing prompt, kept beside the first instead of replacing
 * it. The rules are the same ones — one floor, one hero, honest sizes,
 * overlap that falls on lids and not on labels — and the difference is
 * the shape they are said in: numbered clauses there, a few sentences
 * here. That is not a cosmetic difference to a model, and which shape
 * produces the better tile is a question only a tile can answer. So
 * both ship, the studio switches between them per call, and neither
 * can be lost by trying the other.
 *
 * Written by the editor and kept WORD FOR WORD. The only things filled
 * in are the four facts no prompt can state in advance — how many
 * cutouts, what they are, what the offer is called, and how big the
 * cell is — and they sit exactly where the sentences already put them.
 * Nothing has been added: this prompt does not say "you place, you
 * never draw", because the one it was written as did not either.
 * Because it names the products itself, `placeCluster` leaves them out
 * of the brief rather than listing them twice.
 */
export const PLACE_SCENE = `The attached images are {count} product cutouts for one
supermarket offer, image 1 to {count} in this order:
{products}
The offer is called "{offer}".

{canvas} The products must fill as much of it as possible and still make a good-looking
composition, the way a Danish leaflet (SuperBrugsen, Kvickly, føtex) shows an offer next to
its price: overlapping a little, the hero in front and slightly larger, the same pack size
at the same height. Give every product the height AND the width it has in real life beside
the others: a flat 350 g cheese tub is a few centimetres tall and a hand wide, a 1 l carton
is four times its height and a third of its width, and drawn to the same height the wide
one covers three times the area and reads as the biggest thing in the offer. A product much
wider than the rest must be correspondingly shorter. Look at how the products were
photographed: cutouts shot from the side
stand on one shared floor; cutouts shot from above (tubs, trays, pizzas, sweets seen from
the top) lie on one flat surface seen from above, a flat lay spread over the whole canvas
with slight turns, and have no floor. Products photographed from different angles go side
by side, never on top of each other. Where products overlap, keep the labels readable: let
the overlap fall on lids, edges and bottoms, never on the brand name or the front of a
label, and no product is more than a quarter (25 %) covered. Depth follows the floor: of
two standing products, the one whose feet are lower on the canvas is nearer to the viewer
and in front.

Return for every product its place on the canvas in pixels: left, top, width and height of
the whole product (also where another product will cover it), with the cutout's aspect
ratio kept, so width = height x aspect; tilt_degrees (0 unless a small lean helps, larger
turns in a flat lay); covered_by, the numbers of the products in front of it (nearer
products, whose feet are lower). Use the whole canvas. view: side when the products stand
on a floor, top when they lie on a surface seen from above.`;

/** Which standing prompt a run used. */
export type PlacePromptId = 'regler' | 'beskrivelse';

/**
 * The prompts the studio offers, in the order it shows them.
 *
 * A list rather than two constants, so adding a third is one entry
 * and the picker needs no edit. `said` is what the button's tooltip
 * says: the difference is a shape, and a person choosing between them
 * deserves to be told which shape they are choosing.
 */
export const PLACE_PROMPTS: {
  id: PlacePromptId;
  name: string;
  said: string;
  text: string;
}[] = [
  {
    id: 'regler',
    name: 'Regler',
    said: 'Nummererede regler, én ad gangen, med prioriteret rækkefølge til sidst.',
    text: PLACE_SYSTEM,
  },
  {
    id: 'beskrivelse',
    name: 'Beskrivelse',
    said: 'Samme håndværk fortalt i sammenhængende sætninger i stedet for punkter.',
    text: PLACE_SCENE,
  },
];

/** The chosen prompt's words, falling back to the first one. */
export function placePrompt(id: string): string {
  return (PLACE_PROMPTS.find((entry) => entry.id === id) ?? PLACE_PROMPTS[0]!).text;
}

export const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    view: {
      type: 'string',
      enum: ['side', 'top'],
      description: 'side when the products stand on a floor, top for a flat lay.',
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Which product, counting from 1.' },
          left: { type: 'number', description: 'Left edge in canvas pixels.' },
          top: { type: 'number', description: 'Top edge in canvas pixels.' },
          width: { type: 'number', description: 'Width in canvas pixels.' },
          height: { type: 'number', description: 'Height in canvas pixels.' },
          tilt_degrees: { type: 'number', description: 'Degrees, negative anticlockwise.' },
          covered_by: {
            type: 'array',
            items: { type: 'integer' },
            description: 'The products drawn in front of this one.',
          },
        },
        required: ['index', 'left', 'top', 'width', 'height', 'tilt_degrees', 'covered_by'],
        additionalProperties: false,
      },
    },
  },
  required: ['view', 'products'],
  additionalProperties: false,
} as const;

