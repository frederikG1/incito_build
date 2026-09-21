/**
 * Reading a composition back out of a picture of one.
 *
 * The image model composes beautifully and cannot be trusted with a
 * label. It redraws pixels rather than copying them, and what it is
 * worst at is exactly what matters here — a brand name, a fat
 * percentage, the small print on a lid. No prompt fixes that; it is
 * what the mechanism is.
 *
 * So the picture is not used as a picture. It is used as a LAYOUT: the
 * model is shown its own composition and asked where each product ended
 * up and how big it is, and those numbers are applied to the cutouts
 * the chain actually supplied. What prints is the original artwork,
 * pixel for pixel, standing where the composition put it.
 *
 * The answer is four numbers per product, all fractions of the picture,
 * and nothing else — no colours, no crops, no CSS. The same contract
 * every other model call in this repo makes, and the reason this one is
 * safe: a number that is wrong moves a product, and a person can see
 * that and drag it back. A redrawn logo looks right and is not.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';

/**
 * Vision, and the reading is fiddly — overlapping products, one of them
 * deliberately behind another — so this is the one call in the pair
 * that gets the stronger model. It runs once per composition, not per
 * page.
 */
export const DEFAULT_LAYOUT_MODEL = 'claude-opus-5';

/** Where one product sits in the composition, in fractions of the picture. */
export interface PlacedProduct {
  /** Which product, counting from 1 as the prompt numbered them. */
  index: number;
  /** Centre of the product, 0–1 across and down the picture. */
  cx: number;
  cy: number;
  /** Its width as a fraction of the picture's width. */
  width: number;
  /**
   * Where it stands: the product's lowest edge, 0–1 down the picture.
   *
   * Asked for rather than worked out, and that is the whole reason it
   * exists. The bottom used to be derived — centre plus half a height,
   * where the height came from the width and the cutout's own
   * proportions — so the one number this model is least sure about
   * (measured: ±6–9 % on width, ±1 % on position) decided where the
   * products stood. A row read a hair narrow stood a hair high, and a
   * leaflet's shared baseline dissolved into three products floating at
   * three heights. Measured directly it is as good as the centre is.
   */
  bottom: number;
  /** A few degrees, when the composition tilted it. */
  rotate: number;
}

export interface LayoutReading {
  products: PlacedProduct[];
  /** Products the model could not find, by index. Left where they were. */
  missing: number[];
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Which product, counting from 1.' },
          cx: { type: 'number', description: 'Centre across, 0–1.' },
          cy: { type: 'number', description: 'Centre down, 0–1.' },
          width: { type: 'number', description: 'Width as a fraction of the picture.' },
          bottom: {
            type: 'number',
            description: "The product's lowest edge, 0-1 down the picture.",
          },
          rotate: { type: 'number', description: 'Degrees, negative anticlockwise.' },
        },
        required: ['index', 'cx', 'cy', 'width', 'bottom', 'rotate'],
        additionalProperties: false,
      },
    },
  },
  required: ['products'],
  additionalProperties: false,
} as const;

export const LAYOUT_SYSTEM = `You are measuring a composed product photograph so the same
composition can be rebuilt from the original cutouts.

You are given one picture of several products standing together, and the list of which
product is which. For EVERY product in the list, report where it sits in that picture and
how big it is.

Report, per product:
  index   which product it is, counting from 1 in the list's own order
  cx, cy  the centre of the product's own bounding box, as fractions of the picture —
          0,0 is the top-left corner and 1,1 the bottom-right
  width   the width of that bounding box, as a fraction of the picture's width
  bottom  where the product STANDS: the lowest edge of that bounding box, as a fraction
          down the picture. Read it off the picture directly — do not work it out from the
          centre and the height. Products standing on the same invisible shelf must come
          back with the same number here, to the second decimal.
  rotate  how many degrees it is turned, negative anticlockwise. 0 for anything upright,
          which is almost everything.

The bounding box is the product ITSELF — the pack, the bottle, the bag — not the space
around it. Measure the whole product even where another one overlaps it: report where the
WHOLE pack would be, not only the visible part. That is the number that rebuilds the
composition; the part that is hidden is hidden by whatever is in front of it, and that
happens again by itself.

Measure to the edge of the PACKAGING, not to the contents. A clear bag, a film wrapper, a
transparent lid or a plastic tray is part of the product and belongs inside the box even
where you can see straight through it — a cheese in a clear vacuum bag is as wide as the
bag, not as wide as the cheese, and a punnet of pears is as wide as the punnet. What is
rebuilt from these numbers is the packshot, and the packshot includes the wrapper.

Identify the products by their labels and their shapes. If one of them is genuinely not in
the picture, leave it out of the list rather than guessing at a position — a product placed
where it is not is worse than one left where it already was.

Report numbers only. No colours, no crops, no descriptions, no advice.`;

/** A number inside its range, or the fallback. */
function within(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback;
}

/**
 * Whatever the model said, made safe.
 *
 * Exported and tested, because this is where a bad answer becomes a
 * product in the wrong place: an index that names no product, two
 * readings of the same one, a width of zero that would make a packshot
 * vanish. None of those may reach a page.
 */
export function validateLayout(count: number, answer: unknown): Omit<LayoutReading, 'model' | 'usage'> {
  const said = (answer ?? {}) as { products?: unknown };
  const rows = Array.isArray(said.products) ? said.products : [];

  const seen = new Set<number>();
  const products: PlacedProduct[] = [];
  for (const row of rows) {
    const entry = (row ?? {}) as Record<string, unknown>;
    const index = typeof entry['index'] === 'number' ? Math.round(entry['index']) : 0;
    if (index < 1 || index > count || seen.has(index)) continue;
    seen.add(index);
    products.push({
      index,
      cx: within(entry['cx'], 0, 1, 0.5),
      cy: within(entry['cy'], 0, 1, 0.5),
      /*
       * A floor as well as a ceiling. Zero would make a packshot
       * disappear and a number over 1 would make one product the whole
       * cell — both are readings, not layouts.
       */
      width: within(entry['width'], 0.02, 1.5, 0.3),
      /*
       * Below the centre, always: a bottom edge above the middle of the
       * product it belongs to is a misread, not a layout, and left in
       * it would stand the product on its own head.
       */
      bottom: Math.max(
        within(entry['bottom'], 0, 1.5, within(entry['cy'], 0, 1, 0.5) + 0.2),
        within(entry['cy'], 0, 1, 0.5),
      ),
      rotate: within(entry['rotate'], -45, 45, 0),
    });
  }

  return {
    products: products.sort((a, b) => a.index - b.index),
    // Named rather than counted: the caller leaves these where they
    // were and has to be able to say which.
    missing: Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n)),
  };
}

export interface LayoutOptions {
  /** The composed picture. */
  image: Buffer;
  mimeType: string;
  /** The products, in the order the composition's own prompt numbered them. */
  products: { name: string }[];
  model?: string;
  apiKey?: string;
}

/**
 * Measure a composition. Throws: the caller asked for this on purpose
 * and a silent no-op would look like a button that does nothing.
 */
export async function readClusterLayout(options: LayoutOptions): Promise<LayoutReading> {
  const { products } = options;
  if (products.length < 2) throw new Error('en opstilling skal have mindst to varer');

  const model = options.model ?? DEFAULT_LAYOUT_MODEL;
  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const stream = client.messages.stream({
    model,
    max_tokens: 4000,
    system: LAYOUT_SYSTEM,
    output_config: { format: jsonSchemaOutputFormat(LAYOUT_SCHEMA) },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: options.mimeType as 'image/png',
            data: options.image.toString('base64'),
          },
        },
        {
          type: 'text',
          text: [
            'The picture above is a composition of these products:',
            ...products.map((product, index) => `${index + 1}. ${product.name}`),
            '',
            'Report where each of them sits in it.',
          ].join('\n'),
        },
      ],
    }],
  });

  const response = await stream.finalMessage();
  if (!response.parsed_output) throw new Error('modellen returnerede ingen opstilling');

  return {
    ...validateLayout(products.length, response.parsed_output),
    model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
