import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import type { Offer } from '@incitio/schema';
import {
  DEFAULT_MAX_OFFERS_PER_PAGE,
  offerImportance,
  paginateByCategory,
  type PageGroup,
} from '@incitio/layout';

/**
 * The editorial step: which offers share a page, which one leads it, and
 * what the page is called.
 *
 * The model outputs ASSIGNMENTS ONLY — offer ids and page titles. It
 * never emits coordinates, sizes or templates. Geometry comes from the
 * deterministic solver running against mined templates, which is what
 * keeps the output reproducible, testable and editable by hand. A model
 * that placed pixels directly would give up all three.
 */

/**
 * Declared as JSON Schema rather than Zod: the SDK's zod helper targets
 * Zod 4 and the rest of the workspace is on Zod 3. Two Zod versions in
 * one monorepo is a worse problem than a hand-written schema.
 */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: "Section heading, in the feed's own language. 1-3 words.",
          },
          subtitle: {
            type: 'string',
            description: 'Optional supporting line. Empty string if not needed.',
          },
          offerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Offer ids on this page, strongest first.',
          },
          heroOfferId: {
            type: 'string',
            description: 'The one offer that should lead the page.',
          },
          reasoning: {
            type: 'string',
            description: 'One short sentence on why these belong together.',
          },
        },
        required: ['title', 'subtitle', 'offerIds', 'heroOfferId', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['pages'],
  additionalProperties: false,
} as const;

export interface PlanOptions {
  /** Most offers any one page may carry. */
  maxPerPage?: number;
  model?: string;
  /** Language for the page titles, e.g. "Danish". */
  language?: string;
  /**
   * Free-text direction from the person running the catalog: "lead with
   * the meat offers", "this is the back-to-school week", "keep wine off
   * the first three pages". Appended after the standing rules so it can
   * steer without overriding them.
   */
  brief?: string;
  apiKey?: string;
}

export interface PlanResult {
  groups: PageGroup[];
  /** Why the model grouped each page as it did — surfaced in the editor. */
  reasoning: string[];
  /** True when the model failed and category pagination was used instead. */
  fellBack: boolean;
  /** Why it fell back. Surfaced to the user — "invalid key" and "model
   *  returned nonsense" need different fixes, so they must read
   *  differently. */
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Compact one offer to what the editorial decision actually needs. */
function summarise(offer: Offer): string {
  const parts = [
    offer.id,
    offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
    `${offer.price} ${offer.currency}`,
  ];
  if (offer.prePrice) parts.push(`was ${offer.prePrice}`);
  parts.push(offer.category);
  parts.push(`weight ${offerImportance(offer).toFixed(2)}`);
  if (offer.labels.length) parts.push(offer.labels.map((l) => l.text).join('/'));
  return parts.join(' | ');
}

const SYSTEM = `You are a retail catalog editor for printed and digital leaflets.

You decide which offers share a page, which offer leads each page, and what
each page is called. You do NOT decide sizes, positions or templates — a
layout engine handles geometry.

What makes a good page:
- Offers on a page belong together for a shopper: a meal, an occasion, a
  category, a season. "Things that happen to be the same category" is the
  weakest version of this; look for the better reason when one exists.
- Every page has one offer that earns the lead. Usually the deepest
  discount or the strongest brand, but a page built around an occasion can
  lead with the offer that best expresses it.
- Not every page needs the same shape. Some pages carry one dominant offer;
  others show four things of equal weight. Vary it.
- Page titles are short and concrete, in the language of the feed. Name the
  thing, do not describe it.

Hard rules:
- Use every offer id you are given, exactly once. Never invent an id.
- Never exceed the stated maximum offers per page.
- heroOfferId must appear in that page's own offerIds.`;

export async function planCatalog(
  offers: Offer[],
  options: PlanOptions = {},
): Promise<PlanResult> {
  const maxPerPage = options.maxPerPage ?? DEFAULT_MAX_OFFERS_PER_PAGE;
  const language = options.language ?? 'the language the offers are written in';

  if (offers.length === 0) return { groups: [], reasoning: [], fellBack: false };

  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const catalogue = offers.map(summarise).join('\n');

  const brief = options.brief?.trim();
  const prompt = [
    `Plan the pages of a leaflet from these ${offers.length} offers.`,
    `Maximum ${maxPerPage} offers per page. Write titles in ${language}.`,
    ...(brief
      ? ['', 'Direction from the editor — follow it unless it breaks a hard rule:', brief]
      : []),
    '',
    'Each line is: id | name | price | previous price | category | editorial weight | labels',
    '',
    catalogue,
  ].join('\n');

  try {
    // Streamed, not a plain create: the SDK refuses non-streaming requests
    // at this max_tokens because they could exceed the 10-minute HTTP
    // timeout. `finalMessage()` still carries `parsed_output`.
    const stream = client.messages.stream({
      model: options.model ?? 'claude-opus-5',
      max_tokens: 32000,
      system: SYSTEM,
      // Adaptive thinking: grouping a few hundred offers into coherent
      // pages is exactly the kind of problem that benefits from it.
      thinking: { type: 'adaptive' },
      output_config: { format: jsonSchemaOutputFormat(PLAN_SCHEMA), effort: 'high' },
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

    const parsed = response.parsed_output;
    if (!parsed) throw new Error('model returned no parsable plan');

    const byId = new Map(offers.map((o) => [o.id, o]));
    const used = new Set<string>();
    const groups: PageGroup[] = [];
    const reasoning: string[] = [];

    for (const page of parsed.pages) {
      // Trust nothing: drop invented ids, drop repeats, enforce the cap.
      const pageOffers: Offer[] = [];
      for (const id of page.offerIds) {
        const offer = byId.get(id);
        if (!offer || used.has(id) || pageOffers.length >= maxPerPage) continue;
        used.add(id);
        pageOffers.push(offer);
      }
      if (pageOffers.length === 0) continue;

      // The hero leads the group; the solver reads position 0 as strongest.
      const heroIndex = pageOffers.findIndex((o) => o.id === page.heroOfferId);
      if (heroIndex > 0) {
        const [hero] = pageOffers.splice(heroIndex, 1);
        if (hero) pageOffers.unshift(hero);
      }

      groups.push({ title: page.title, subtitle: page.subtitle, offers: pageOffers });
      reasoning.push(page.reasoning);
    }

    // Anything the model forgot still has to reach the catalog.
    const missed = offers.filter((o) => !used.has(o.id));
    for (let i = 0; i < missed.length; i += maxPerPage) {
      const slice = missed.slice(i, i + maxPerPage);
      groups.push({ title: slice[0]?.category ?? 'Tilbud', subtitle: '', offers: slice });
      reasoning.push('added by the validator — the plan omitted these offers');
    }

    return {
      groups,
      reasoning,
      fellBack: false,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    // A catalog that ships beats a catalog that waits for the API.
    const message = describe(error);
    console.warn(`planner fell back to category pagination: ${message}`);
    return { groups: [], reasoning: [], fellBack: true, error: message };
  }
}

/**
 * Turn an SDK error into something a person can act on. The status code
 * is the whole story here: 401 means fix the key, 429 means wait, 400
 * means the request was wrong.
 */
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) return 'Invalid API key — check ANTHROPIC_API_KEY in .env';
    if (error.status === 403) return 'API key lacks permission for this model';
    if (error.status === 429) return 'Rate limited by the Anthropic API — try again shortly';
    if (error.status === 404) return `Unknown model: ${error.message}`;
    if (error.status && error.status >= 500) return 'Anthropic API is unavailable — try again shortly';
    return `Anthropic API error ${error.status ?? '?'}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Plan with Claude, or fall back to deterministic category pagination. */
export async function planOrPaginate(
  offers: Offer[],
  library: Parameters<typeof paginateByCategory>[1],
  options: PlanOptions = {},
): Promise<PlanResult> {
  const result = await planCatalog(offers, options);
  if (!result.fellBack && result.groups.length > 0) return result;
  return {
    groups: paginateByCategory(offers, library, options.maxPerPage),
    reasoning: [],
    fellBack: true,
  };
}
