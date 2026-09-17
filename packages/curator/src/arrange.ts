/**
 * How several products share one cell.
 *
 * The page is already designed when this runs. The grid is fixed, the
 * cell is fixed, the price is fixed — what is decided here is the
 * inside of ONE cell: which product stands at the front, what shape the
 * group takes, and the two lines of Danish printed under it.
 *
 * It is the same bargain the rest of this repo makes with a model, at
 * the smallest scale it comes in. The model returns an ordering, one of
 * four arrangement names and two strings. It returns no coordinates, no
 * sizes, no colours and no CSS — those come from the stylesheet, which
 * is what keeps the page reproducible and hand-editable.
 *
 * It SEES the products. A cluster's shape is a fact about the
 * photographs — six upright bottles fan and six flat trays do not — and
 * that is not in the feed's text. The packshots go to the model as
 * images, which is the one thing here that could not have been decided
 * from the data.
 *
 * Never load-bearing. Every failure — no key, a refusal, a photograph
 * the API cannot fetch — falls back to the stylesheet's own answer, and
 * the editor's drop lands either way. A tile nobody could assemble
 * because an API was down would be a worse feature than no API at all.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { TILE_ARRANGEMENTS, type Offer, type SlotRole, type TileArrangement } from '@incitio/schema';

/**
 * Small, fast and structured, unlike the page planner above.
 *
 * This runs while somebody is waiting with the pointer still on the
 * page — one cell, a handful of products, a four-way choice — so it is
 * pinned to a quicker model than the curation call. The prompt is the
 * part that carries the quality here, not the reasoning budget.
 */
export const DEFAULT_ARRANGE_MODEL = 'claude-sonnet-5';

/** What the cell is, in the only terms that change the answer. */
export interface CellShape {
  role: SlotRole;
  /** Width over height on the printed page; 2 is twice as wide as tall. */
  aspect: number;
  /** The cell's width as a share of the sheet's. */
  width: number;
}

export interface ArrangeOptions {
  offers: Offer[];
  cell: CellShape;
  brandName: string;
  /** The editor's own steer, when they gave one. */
  note?: string;
  model?: string;
  apiKey?: string;
}

export interface Arrangement {
  /** The offers left to right as printed. A permutation of what went in. */
  order: string[];
  arrangement: TileArrangement;
  /** What the page calls this offer. */
  heading: string;
  /** The fine print under it. */
  support: string;
  /** The model's own reason, shown in the editor and never printed. */
  why: string;
  /** Which model answered, or null when the fallback did. */
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Declared as JSON Schema rather than Zod, for the same reason the plan
 * schema above is: the SDK's Zod helper targets Zod 4 and this
 * workspace is on Zod 3.
 */
const ARRANGE_SCHEMA = {
  type: 'object',
  properties: {
    order: {
      type: 'array',
      items: { type: 'string' },
      description: 'Every product id given, left to right as printed.',
    },
    arrangement: { type: 'string', enum: [...TILE_ARRANGEMENTS] },
    heading: { type: 'string', description: 'Danish. At most 45 characters.' },
    support: { type: 'string', description: 'Danish fine print. At most 60 characters.' },
    why: { type: 'string', description: 'One short sentence, for the editor.' },
  },
  required: ['order', 'arrangement', 'heading', 'support', 'why'],
  additionalProperties: false,
} as const;

/**
 * What a printed group looks like, written down.
 *
 * Every paragraph is a rule read off published pages rather than a
 * preference: the overlap, the front-most item, which shapes suit which
 * products, and the two sentences a Danish leaflet actually prints
 * under a "frit valg" tile. The four arrangement names are the four the
 * stylesheet draws — see `TILE_ARRANGEMENTS` — so there is nothing to
 * translate on the way back.
 */
export const ARRANGE_SYSTEM = `You set ONE cell of a printed Danish supermarket leaflet — a tilbudsavis.

The page is already designed. The grid, the cell and the price are fixed and none of
them is yours. What is yours is the inside of one cell: several products that share one
price, arranged so the cell reads as ONE offer rather than as a list of products.

WHAT A PRINTED GROUP LOOKS LIKE

A leaflet never lines products up with air between them — that is a web shop. Printed
groups touch and overlap, and they have a FRONT: one product nearest the reader, whole
and unobstructed, the others tucked behind it to the left and right. The front product
is the one a shopper recognises — the best known brand, the largest pack, or the
variant the headline names first.

THE FOUR ARRANGEMENTS, AND WHAT EACH IS FOR

row      An overlapping line. Two or three products of similar height and width. The
         calmest shape: use it when the products are near-identical and the point is
         "same thing, several flavours".
stagger  An overlapping line where the neighbours ride lower and smaller and one item
         stands forward. The workhorse of a Danish leaflet — trays of pålæg, bags of
         sweets, packets. Use it when the products differ in shape, or when one clearly
         leads. The stylesheet brings the MIDDLE item forward, so put the leading
         product in the middle of "order".
grid     A block of two or more rows. Four or more products, or products that are boxy
         and flat — cartons, tubs, trays — where one line would make each a sliver.
fan      Spread like a hand of cards, the outer items tilted. ONLY for tall upright
         packs that read well leaning: bottles, cans, cartons, wine. Never for anything
         wide or flat; its corners leave the cell.

The cell's shape decides as much as the products do. A wide, short band cannot hold a
block. A tall, narrow panel cannot hold a line of six. When the two disagree, the cell
wins — a product printed too small to recognise has stopped selling anything.

THE WORDS

heading — what the page calls this offer, in Danish, in the chain's own plain voice.
  · Name the goods, not the marketing: "Thise økologisk ost", "Klovborg eller Riberhus".
  · Two products: "A eller B". Three or more sharing a brand or a kind: that shared
    name, singular and plain, never a list of five.
  · Never a price, never a weight, never "tilbud", never an exclamation mark.
  · At most 45 characters. A leaflet headline is set large; a long one is set small,
    which is the same as not being set at all.

support — the fine print under the heading.
  · Only what is true of ALL of them. Say "Frit valg." when the price covers any of them.
  · Never a price and never a unit price: the page prints those itself, from the data.
  · At most 60 characters.

RULES YOU MAY NOT BREAK

  · Use exactly the product ids given — every one, none invented, none dropped.
  · Say nothing about colour, size, position, pixels or CSS. You choose an arrangement,
    an order and two lines of Danish. The page draws itself.`;

/** What the vision step will accept. Anything else is not a packshot. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** Long enough for a slow image host, short enough not to hold up a drop. */
const FETCH_MS = 8000;
/** Past this a packshot is a poster, and the API has its own 5 MB limit. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface Picture {
  type: 'image';
  source: { type: 'base64'; media_type: ImageType; data: string };
}

/**
 * The photographs, fetched here and sent as bytes.
 *
 * Not as URLs, which is the obvious thing and does not work: measured
 * against this repo's own feeds, the API answers
 * `Unable to download the file` for the Republica image service every
 * time — those URLs are signed for a browser, not for somebody else's
 * server. Fetching them from here is also the honest arrangement, since
 * this server is already the one that knows the chain's image hosts.
 *
 * A photograph that will not come is simply left out. Five packshots
 * and a gap still answers the question better than no packshots at all,
 * and this call must never be the reason a drop does not land.
 */
async function packshots(offers: Offer[]): Promise<Picture[]> {
  const urls = offers
    .map((offer) => offer.imageUrl)
    .filter((url): url is string => Boolean(url) && /^https?:/.test(url ?? ''))
    .slice(0, 8);

  const fetched = await Promise.all(urls.map(async (url): Promise<Picture | null> => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
      if (!response.ok) return null;
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!IMAGE_TYPES.includes(type as ImageType)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
      return {
        type: 'image',
        source: { type: 'base64', media_type: type as ImageType, data: bytes.toString('base64') },
      };
    } catch {
      return null;
    }
  }));

  return fetched.filter((picture): picture is Picture => picture !== null);
}

/** One line per product: what the model needs, and nothing else. */
function describe(offer: Offer, index: number): string {
  const size = offer.quantity.size
    ? `${offer.quantity.size} ${offer.quantity.unit}`
    : offer.pack;
  return [
    `${index + 1}. id=${offer.id}`,
    offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
    size,
    `${offer.price} ${offer.currency}`,
    offer.description.slice(0, 80),
  ].filter(Boolean).join(' | ');
}

/**
 * The shape to use when nobody chose one.
 *
 * The same rule the stylesheet applies on its own — four or more is a
 * block, fewer is a staggered line — with the one exception a compact
 * cell needs: at that size anything but a plain row is mush.
 */
export function defaultArrangement(count: number, role: SlotRole): TileArrangement {
  if (role === 'compact') return 'row';
  return count >= 4 ? 'grid' : 'stagger';
}

/** The stylesheet's own answer, for when the model has none. */
function fallback(offers: Offer[], cell: CellShape): Arrangement {
  return {
    order: offers.map((offer) => offer.id),
    arrangement: defaultArrangement(offers.length, cell.role),
    // Empty rather than invented: the caller's own draft heading stands
    // when the model did not write one, and a blank string is how the
    // studio tells "the model said nothing" from "the model said this".
    heading: '',
    support: '',
    why: '',
    model: null,
    usage: null,
  };
}

/**
 * Whatever the model said, made safe.
 *
 * The ordering is rebuilt from the ids that actually exist rather than
 * trusted: a model that repeats one id and drops another would
 * otherwise print one product twice and lose one, which is a tile that
 * charges for something it does not show. Unknown ids are dropped and
 * missing ones appended in their original order, so the result is
 * always a permutation of the input.
 */
export function validate(
  offers: Offer[],
  answer: unknown,
  role: SlotRole = 'standard',
): Omit<Arrangement, 'model' | 'usage'> {
  const said = (answer ?? {}) as Partial<Record<keyof Arrangement, unknown>>;
  const wanted = new Set(offers.map((offer) => offer.id));

  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of Array.isArray(said.order) ? said.order : []) {
    if (typeof id === 'string' && wanted.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const offer of offers) if (!seen.has(offer.id)) order.push(offer.id);

  const arrangement = TILE_ARRANGEMENTS.includes(said.arrangement as TileArrangement)
    ? said.arrangement as TileArrangement
    : defaultArrangement(offers.length, role);

  const line = (value: unknown, limit: number) =>
    (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '').slice(0, limit);

  return {
    order,
    arrangement,
    // Capped here as well as asked for in the prompt: a heading that
    // overruns is set smaller by the stylesheet until it fits, and a
    // tile whose type is half the size of its neighbours' is the same
    // bug wearing different clothes.
    heading: line(said.heading, 60),
    support: line(said.support, 90),
    why: line(said.why, 200),
  };
}

/**
 * Ask the model how this group should sit, or answer without it.
 *
 * Never throws. The caller is an editor's drag-and-drop, and the tile
 * has to land whatever the network did.
 */
export async function arrangeGroup(options: ArrangeOptions): Promise<Arrangement> {
  const { offers, cell } = options;
  if (offers.length < 2) return fallback(offers, cell);
  if (!(options.apiKey ?? process.env['ANTHROPIC_API_KEY'])) return fallback(offers, cell);

  const shape = cell.aspect >= 1.6 ? 'a wide, short band'
    : cell.aspect <= 0.7 ? 'an upright panel' : 'a roughly square panel';

  const prompt = [
    `Chain: ${options.brandName}.`,
    `The cell is ${shape} — ${cell.aspect.toFixed(2)} wide for every 1 tall — and takes up`
    + ` ${Math.round(cell.width * 100)}% of the sheet's width. Its role on the page is`
    + ` "${cell.role}".`,
    '',
    `${offers.length} products share this cell and one price.`
    + ' Their photographs follow in the same order:',
    ...offers.map(describe),
    ...(options.note ? ['', `The editor says: ${options.note}`] : []),
  ].join('\n');

  const pictures = await packshots(offers);

  try {
    const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    // Streamed for the same reason the planner is: `parsed_output` is
    // the stream helper's, and it is what turns the structured reply
    // into an object rather than a string somebody has to parse.
    const stream = client.messages.stream({
      model: options.model ?? DEFAULT_ARRANGE_MODEL,
      max_tokens: 2000,
      system: ARRANGE_SYSTEM,
      output_config: { format: jsonSchemaOutputFormat(ARRANGE_SCHEMA) },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...pictures] }],
    });
    const response = await stream.finalMessage();
    if (!response.parsed_output) return fallback(offers, cell);

    return {
      ...validate(offers, response.parsed_output, cell.role),
      model: options.model ?? DEFAULT_ARRANGE_MODEL,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch {
    // Deliberately silent to the caller: the tile lands either way, and
    // the reason belongs in the reply's `model: null`, which is what
    // the editor is shown.
    return fallback(offers, cell);
  }
}
