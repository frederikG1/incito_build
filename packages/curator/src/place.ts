/**
 * The composition, asked for as numbers instead of drawn as a picture.
 *
 * The other way to fill a cell with several products, and the cheap
 * one. `composeCluster` pays an image model to PHOTOGRAPH the products
 * standing together and then pays a second model to measure where they
 * ended up — a beautiful arrangement and a long way round, and the
 * image models have no free tier, so the whole feature sits behind a
 * billing account. This asks a vision model to look at the cutouts and
 * say directly where each one should stand. One call, no drawing, no
 * picture to throw away afterwards.
 *
 * It answers in exactly the shape `readClusterLayout` answers in — see
 * `PlacedProduct` — because everything downstream is already
 * coordinate-driven: the same planner turns the numbers into moves for
 * the chain's own cutouts, and the same review complains when one
 * product buries another. Only the source of the numbers differs.
 *
 * What the round trip buys that this does not: an image model has seen
 * a million photographs of products standing together and composes
 * like one, while this is a model reasoning about boxes. Where it
 * matters most is the thing a leaflet gets wrong most visibly — a
 * roll-on deodorant printed the size of a shower gel — so the pack
 * sizes are handed over and the rule about them is stated first.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { generateJson } from '@incitio/decor/gemini';
import { type PlacedProduct, type LayoutReading, validateLayout } from './layout.js';
import {
  PLACE_SCHEMA, PLACE_SYSTEM, namesProducts, placeSystem,
} from './place-prompt.js';

/**
 * Gemini, and not by accident.
 *
 * The whole point of placing by numbers was to get out from under the
 * image models' billing gate, and the text and vision models on this
 * API do have a free tier — so the cheap way should not quietly need
 * a second paid account to work. It is also the key an editor already
 * has: `GEMINI_API_KEY`, or the one they pasted into the studio.
 *
 * A flash model rather than a pro one. Measured on a three-product
 * tile, this is seconds where the reasoning models were half a
 * minute, and the job is reading six pictures and reporting boxes —
 * not a problem more thinking solves.
 */
export const DEFAULT_PLACE_MODEL = 'gemini-3.8-flash';

/**
 * Where to go when the chosen model is busy.
 *
 * Not a preference — a queue. This API answers 503 "experiencing high
 * demand" for a model under load, and that is a fact about the minute
 * rather than about the key: measured within one minute, 3.8-flash
 * answered nothing and 3.7-flash answered the same request with the
 * same pictures in 7.7 s. Retrying the busy one four times, which is
 * what the transport does on its own, spends a minute and a half to
 * arrive at the same 503.
 *
 * So a busy model is stepped over rather than waited out, and the
 * answer says which one actually replied — see `LayoutReading.model`.
 */
const WHEN_BUSY = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  // Last and always: measured 0.5–1.2 s for a trivial prompt in the
  // same minute the big flash models needed 28–42 s. When the front
  // of the queue is under load, an answer from here beats no answer.
  'gemini-3.5-flash-lite',
];

/**
 * Which house a model id belongs to.
 *
 * One function rather than a provider field, because the id already
 * says: nobody picks "opus" and means Gemini. Claude stays reachable
 * for a comparison — the prompt is the same either way — but it is no
 * longer what runs.
 */
function isClaude(model: string): boolean {
  return /^claude/i.test(model);
}

/** One product going into the arrangement. */
export interface PlaceProduct {
  /** What it is called, so the answer can name it back. */
  name: string;
  /** The pack size as the label states it — "500 g", "6 x 33 cl". */
  size?: string;
  /** The cutout's own proportions, width over height. */
  aspect?: number;
}

/** A cutout, as the model is shown it. */
export interface PlaceImage {
  base64: string;
  mimeType: string;
}

export interface PlaceOptions {
  products: PlaceProduct[];
  /** The cutouts, in the same order as `products`. */
  references: PlaceImage[];
  /**
   * The cell, in pixels as the page actually draws it.
   *
   * Pixels rather than a ratio, because the answer is in pixels: a
   * model told "1.01:1" has to invent a scale before it can place
   * anything, and two products it wanted the same size come back a few
   * per cent apart. Given the real box it answers in the box's own
   * numbers.
   */
  canvas: { width: number; height: number };
  /** What the offer is called, so the hero can be the product it names. */
  offerName?: string;
  /** The editor's own steer — "flaskerne i én række", "den store bagest". */
  note?: string;
  /**
   * The standing prompt, rewritten for this call.
   *
   * `PLACE_SYSTEM` is the default and the one to edit for good; this
   * is the studio's session override, so a change can be tried on one
   * tile before it is written down.
   */
  system?: string;
  model?: string;
  /**
   * Refuse to answer with anything but the model that was asked for.
   *
   * The queue below is what happens otherwise — a busy model is
   * stepped over and a lesser one answers, which is the right default
   * for a batch nobody is watching. It is the wrong one for somebody
   * judging a model: measured here, two runs asking for
   * `gemini-3.8-flash` came back in 49 s and 67 s and BOTH were
   * answered by `gemini-3.5-flash-lite`, so every tile being compared
   * had been made by the same model and the comparison was of
   * nothing. Strict makes that impossible: the named model answers,
   * or the run fails and says so.
   */
  strict?: boolean;
  /** The key for whichever house `model` names. */
  apiKey?: string;
}

/** How a product is named in the list the model reads. */
function named(product: PlaceProduct, index: number): string {
  const size = product.size?.trim();
  // The cutout's own proportions: "tall and narrow" is a fact about the
  // photograph rather than about the product, and the answer has to
  // keep it — width = height × aspect.
  const shape = product.aspect && product.aspect > 0
    ? ` — aspect ${product.aspect.toFixed(2)}`
    : '';
  return `${index + 1}. ${product.name.trim()}${size ? ` — ${size}` : ''}${shape}`;
}

/**
 * Where each product should stand, in fractions of the cell.
 *
 * Throws, like `readClusterLayout` and unlike `arrangeGroup`: the
 * editor pressed a button to get this arrangement and already had a
 * working tile, so a silent fallback would leave them wondering
 * whether anything happened.
 */
export async function placeCluster(options: PlaceOptions): Promise<LayoutReading> {
  const { products, references } = options;
  if (products.length < 2) throw new Error('en opstilling skal have mindst to varer');
  if (references.length !== products.length) {
    throw new Error(`${products.length} varer, men ${references.length} billeder`);
  }

  const model = options.model ?? DEFAULT_PLACE_MODEL;

  /*
   * The prompt, with this call's facts written into whichever
   * stand-ins it left for them — see `placeSystem`.
   */
  const system = placeSystem(options.system?.trim() || PLACE_SYSTEM, {
    canvas: options.canvas,
    products: products.map((product) => ({ name: product.name, aspect: product.aspect })),
    offerName: options.offerName,
  });

  /*
   * What the prompt has not already said.
   *
   * A prompt that names the products itself — see `namesProducts` —
   * gets no list here, because a model shown the same six cutouts
   * twice under two different numberings is being invited to answer
   * about twelve. The editor's own steer is the one thing that always
   * belongs at the end, wherever it is going.
   */
  const brief = namesProducts(options.system?.trim() || PLACE_SYSTEM)
    ? (options.note?.trim() ?? '')
    : [
      `${options.offerName?.trim() ? `Offer: "${options.offerName.trim()}". ` : ''}`
      + `Canvas ${Math.round(options.canvas.width)} × `
      + `${Math.round(options.canvas.height)} px `
      + `(${(options.canvas.width / options.canvas.height).toFixed(2)}:1).`,
      `${products.length} cutouts, in this order.`
      + " Aspect is the cutout's width ÷ height.",
      '',
      ...products.map(named),
      ...(options.note?.trim() ? ['', options.note.trim()] : []),
    ].join('\n');

  const said = isClaude(model)
    ? await fromClaude(model, system, options, brief)
    : await fromGemini(model, system, options, brief);

  return {
    ...toReading(
      products.length,
      options.canvas,
      (said.answer ?? {}) as { products?: unknown },
    ),
    view: ((said.answer ?? {}) as { view?: unknown }).view === 'top' ? 'top' : 'side',
    // The model that answered, which is the honest one to report.
    model: said.model,
    ...(said.insteadOf ? { insteadOf: said.insteadOf } : {}),
    usage: said.usage,
  };
}

interface Answered {
  answer: unknown;
  /** Which model actually replied — not always the one that was asked. */
  model: string;
  /** The one that was asked for, when it was busy and another answered. */
  insteadOf?: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Gemini, which is what runs.
 *
 * The pictures go in front of the prompt in one turn — see
 * `generateJson` — and the schema is the same object the other house
 * is handed, because it is plain JSON Schema and both read it. The
 * system prompt is prepended rather than passed apart: this API takes
 * a `system_instruction`, but folding it in keeps one string to read
 * when a layout comes out wrong.
 */
async function fromGemini(
  model: string,
  system: string,
  options: PlaceOptions,
  brief: string,
): Promise<Answered> {
  const pictures = options.references.map((image) => ({
    bytes: Buffer.from(image.base64, 'base64'),
    mimeType: image.mimeType,
  }));
  /*
   * The chosen model, and then the others — unless the caller asked
   * for that one and no other. See `PlaceOptions.strict`.
   */
  const queue = options.strict
    ? [model]
    : [model, ...WHEN_BUSY.filter((entry) => entry !== model)];

  let last: unknown = null;
  for (const [at, candidate] of queue.entries()) {
    try {
      const { value, usage } = await generateJson<unknown>(
        brief ? `${system}\n\n${brief}` : system,
        PLACE_SCHEMA,
        {
          model: candidate,
          /*
           * Once each. The queue IS the retry — asking a busy model a
           * second time costs the whole payload again (a megabyte of
           * cutouts) to be told the same thing, and the next model in
           * the list is usually answering fine.
           */
          attempts: 1,
          /*
           * Forty seconds, not three minutes. The transport's default
           * is sized for an image model DRAWING; this one reads six
           * pictures and returns forty numbers — measured at 4–8 s
           * when the model is free — so an attempt still silent at
           * forty is a queue to step out of, and a timeout counts as
           * busy for exactly that reason.
           */
          /*
           * The first one gets longer than the rest.
           *
           * It is the model the editor chose, and a busy model on this
           * API queues rather than refuses — measured at 28 s for the
           * word "ok" on 3.8-flash in the same minute a lite model
           * answered in half a second. Worth waiting for; not worth
           * waiting for four times over.
           */
          // The chosen model gets the long wait; the ones behind it in
          // the queue get a short one, because the point of a queue is
          // not to wait. Strict has no queue, so there is only the
          // long wait.
          timeoutMs: (at === 0 || options.strict) ? 45_000 : 20_000,
          ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        },
        pictures,
      );
      return {
        answer: value,
        model: candidate,
        ...(at > 0 ? { insteadOf: model } : {}),
        usage: usage ? { inputTokens: usage.input, outputTokens: usage.output } : null,
      };
    } catch (error) {
      // Only a busy model is stepped over. A bad request, a refused
      // key or an invalid schema would fail the same way on all three
      // and must be reported as itself.
      if (!busy(error)) throw error;
      last = error;
    }
  }
  /*
   * Strict and busy: say which model, and what the two ways out are.
   *
   * The alternative — the bare transport error — reads as a broken
   * studio, when what happened is that one named model is under load
   * and the person asked for no other.
   */
  if (options.strict) {
    throw new Error(
      `${model} svarede ikke. Slå reserven til, eller vælg en anden model. `
      + `(${last instanceof Error ? last.message : 'optaget'})`,
    );
  }
  throw last;
}

/**
 * Whether this is the API saying "later", rather than "no".
 *
 * A timeout counts. It is the same condition wearing a different
 * coat — a model under load accepts the request and then does not
 * answer — and treating it as fatal is how one busy model took the
 * other two down with it.
 */
function busy(error: unknown): boolean {
  const said = error instanceof Error ? error.message : String(error);
  return /høj|demand|nede|503|overbelast|svarede ikke inden for/i.test(said);
}

/**
 * Claude, kept for a comparison and no longer the default.
 *
 * Same prompt, same schema, same answer shape — so switching houses
 * is a model id and nothing else, and a tile that comes out wrong can
 * be tried in the other one without changing a line.
 */
async function fromClaude(
  model: string,
  system: string,
  options: PlaceOptions,
  brief: string,
): Promise<Answered> {
  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const stream = client.messages.stream({
    model,
    max_tokens: 4000,
    system,
    output_config: { format: jsonSchemaOutputFormat(PLACE_SCHEMA) },
    messages: [{
      role: 'user',
      content: [
        ...options.references.flatMap((image, index) => ([
          {
            type: 'text' as const,
            text: `Image ${index + 1}: ${options.products[index]!.name}`,
          },
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: image.mimeType as 'image/png',
              data: image.base64,
            },
          },
        ])),
        ...(brief ? [{ type: 'text' as const, text: brief }] : []),
      ],
    }],
  });

  const response = await stream.finalMessage();
  if (!response.parsed_output) throw new Error('modellen returnerede ingen opstilling');
  return {
    answer: response.parsed_output,
    model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/**
 * The answer, in the numbers the rest of the pipeline speaks.
 *
 * Two translations, and both are arithmetic rather than judgement:
 *
 *   pixels → fractions   The prompt asks for a box in canvas pixels
 *                        because that is what a model places well. The
 *                        planner works in fractions of the cell, and
 *                        has since the reader was the only source.
 *   covered_by → depth   `PackOverride.depth` is a step forward or
 *                        back among the products in the cell, not an
 *                        absolute layer. A product nobody covers is at
 *                        the front; one covered by three is three
 *                        steps behind it.
 *
 * Everything else goes through `validateLayout`, exactly as the
 * reader's answer does: an index naming no product, a width of zero, a
 * bottom above the centre. None of those may reach a page, whichever
 * model said it and however it was asked.
 */
export function toReading(
  count: number,
  canvas: { width: number; height: number },
  said: { products?: unknown },
): Omit<LayoutReading, 'model' | 'usage' | 'view'> {
  const rows = Array.isArray(said.products) ? said.products : [];
  const width = canvas.width > 0 ? canvas.width : 1;
  const height = canvas.height > 0 ? canvas.height : 1;

  /*
   * Some models count from zero, whatever the prompt says.
   *
   * Measured: one flash model answered a list numbered 1..n with
   * products 0..n-1, and every one of them was then thrown away by
   * `validateLayout`, which refuses an index naming no product — so a
   * perfectly good arrangement came back as "none of the products
   * could be placed". Told apart by the set itself rather than by the
   * model's name: a list that starts at 0 and ends one short is
   * zero-based, and nothing else is.
   */
  const numbers = rows
    .map((row) => Math.round(Number((row as Record<string, unknown>)?.['index'])))
    .filter((value) => Number.isFinite(value));
  const zeroBased = numbers.length > 0
    && Math.min(...numbers) === 0
    && Math.max(...numbers) === count - 1;
  const asGiven = (value: number) => (zeroBased ? value + 1 : value);

  /*
   * How many products cover each one, counted from every list rather
   * than from its own.
   *
   * Both directions are read: a model that says "3 covers 1" in 1's
   * `covered_by` and forgets to leave 3's empty still stacks
   * correctly, because what is counted is how often an index appears
   * as somebody's coverer versus how often it is covered.
   */
  const covering = new Map<number, number>();
  for (const row of rows) {
    const entry = (row ?? {}) as Record<string, unknown>;
    const over = Array.isArray(entry['covered_by']) ? entry['covered_by'] : [];
    covering.set(
      asGiven(Math.round(Number(entry['index']))),
      over.filter((value) => typeof value === 'number').length,
    );
  }
  const deepest = Math.max(0, ...covering.values());

  const fractions = rows.map((row) => {
    const entry = (row ?? {}) as Record<string, unknown>;
    const number = (key: string) => (typeof entry[key] === 'number' ? entry[key] as number : 0);
    const left = number('left');
    const top = number('top');
    const boxWidth = number('width');
    const boxHeight = number('height');
    const index = asGiven(Math.round(number('index')));
    const behind = covering.get(index) ?? 0;
    return {
      index,
      cx: (left + boxWidth / 2) / width,
      cy: (top + boxHeight / 2) / height,
      width: boxWidth / width,
      bottom: (top + boxHeight) / height,
      rotate: number('tilt_degrees'),
      /*
       * Zero for whatever is most covered, and a step forward for
       * everything less covered than it — so the front of the group
       * is at the top of the range rather than the middle, and a
       * cluster of eight cannot ask for more steps than the schema
       * allows.
       */
      depth: deepest > 0 ? Math.min(4, deepest - behind) : 0,
    };
  });

  return validateLayout(count, { products: fractions });
}

export type { PlacedProduct };
