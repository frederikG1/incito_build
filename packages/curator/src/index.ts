import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import type { Brand, Offer } from '@incitio/schema';
import { templateCapacity } from '@incitio/schema';
import { brandCapacities } from '@incitio/brands';
import {
  DEFAULT_MAX_PAGES,
  maxOffersPerPage,
  offerImportance,
  planByCategory,
  type CataloguePlan,
  type PlannedPage,
} from '@incitio/compose';

/**
 * Step 2 of the pipeline: curation.
 *
 * The model decides which offers share a page, which one leads it, what
 * the page is called, and which of the BRAND'S OWN layouts holds it. It
 * emits assignments only — ids, titles and a template id — never
 * coordinates, sizes or CSS. Geometry comes from the template, which is
 * what keeps the output reproducible, diffable and editable by hand.
 *
 * The brand is a hard boundary here, not a preference: the prompt lists
 * only that chain's templates, and the validator below rejects any id
 * outside them. A Netto run cannot produce a SuperBrugsen page.
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
          templateId: {
            type: 'string',
            description: 'One of the listed template ids. Must hold exactly this many offers.',
          },
          offerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Offer ids on this page, strongest first.',
          },
          rationale: {
            type: 'string',
            description: 'One short sentence on why these belong together.',
          },
        },
        required: ['title', 'subtitle', 'templateId', 'offerIds', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['pages'],
  additionalProperties: false,
} as const;

export interface CurateOptions {
  /** Most pages the plan may contain. Defaults to DEFAULT_MAX_PAGES. */
  maxPages?: number;
  model?: string;
  /**
   * Free-text direction from the person running the catalogue: "lead
   * with the meat offers", "this is the back-to-school week", "keep wine
   * off the first three pages". Appended after the standing rules so it
   * can steer without overriding them.
   */
  brief?: string;
  apiKey?: string;
}

export interface CurateResult {
  plan: CataloguePlan;
  /** True when the model failed and category planning was used instead. */
  fellBack: boolean;
  /** Why it fell back. "Invalid key" and "model returned nonsense" need
   *  different fixes, so they must read differently. */
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

const SYSTEM = `You are a retail catalogue editor for printed and digital leaflets.

You decide which offers share a page, which offer leads each page, what
the page is called, and which page layout it uses. You do NOT decide
sizes, positions or styling — each layout is a fixed grid and the chain's
stylesheet draws it.

What makes a good page:
- Offers on a page belong together for a shopper: a meal, an occasion, a
  category, a season. "Things that happen to be the same category" is the
  weakest version of this; look for the better reason when one exists.
- Every page has one offer that earns the lead. Usually the deepest
  discount or the strongest brand, but a page built around an occasion
  can lead with the offer that best expresses it. Put it first.
- Not every page looks the same, and the number of offers on a page is
  the main thing that makes it look different. Vary it deliberately: a
  two-offer page is a showcase, a nine-offer page is a value page, and a
  leaflet where every page holds the same count reads as a spreadsheet.
  Spend the page budget unevenly across the capacities available.
- Do not use the same template on two consecutive pages. Since a
  template's capacity fixes how many offers it holds, that means
  consecutive pages should differ in size.
- Page titles are short and concrete, in the language of the feed. Name
  the thing, do not describe it.

Hard rules:
- Use every offer id you are given, at most once. Never invent an id.
- templateId must be one of the listed ids for this chain, and the number
  of offers on the page must equal that template's capacity exactly.
- Never use a template belonging to another chain.`;

/** The brand's layouts, as the prompt sees them. */
function templateCatalogue(brand: Brand): string {
  return brand.templates
    .map((t) => `${t.id} | holds ${templateCapacity(t)} | ${t.name}`)
    .join('\n');
}

export async function curateCatalogue(
  brand: Brand,
  offers: Offer[],
  options: CurateOptions = {},
): Promise<CurateResult> {
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const capacities = brandCapacities(brand);

  if (offers.length === 0) {
    return { plan: { pages: [], dropped: [] }, fellBack: false };
  }

  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const brief = options.brief?.trim();

  const prompt = [
    `Plan the pages of a ${brand.name} leaflet from these ${offers.length} offers.`,
    `Produce at most ${maxPages} pages. Write titles in ${brand.language}.`,
    '',
    `Layouts available to ${brand.name} — id | capacity | description:`,
    templateCatalogue(brand),
    '',
    `A page holds exactly its template's capacity. The capacities on offer`
    + ` are ${capacities.join(', ')} — use a mix of them, not one repeated.`,
    ...(brief
      ? ['', 'Direction from the editor — follow it unless it breaks a hard rule:', brief]
      : []),
    '',
    'Each line is: id | name | price | previous price | category | editorial weight | labels',
    '',
    offers.map(summarise).join('\n'),
  ].join('\n');

  try {
    // Streamed, not a plain create: the SDK refuses non-streaming
    // requests at this max_tokens because they could exceed the
    // 10-minute HTTP timeout. `finalMessage()` still carries
    // `parsed_output`.
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
    if (!response.parsed_output) throw new Error('model returned no parsable plan');

    const plan = validate(brand, offers, response.parsed_output.pages, maxPages);
    return {
      plan,
      fellBack: false,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    // A catalogue that ships beats a catalogue that waits for the API.
    const message = describe(error);
    return {
      plan: planByCategory(brand, offers, maxPages),
      fellBack: true,
      error: message,
    };
  }
}

/**
 * Trust nothing the model said about ids.
 *
 * The prompt states the rules; this is what enforces them. Invented
 * offer ids are dropped, repeats are dropped, templates outside the
 * brand are dropped, and the page ceiling is applied here rather than
 * merely requested. Composition then handles the remaining mismatch —
 * a valid template that is the wrong size for its page — because that
 * is a layout question, not a validation one.
 */
function validate(
  brand: Brand,
  offers: Offer[],
  proposed: { title: string; subtitle: string; templateId: string; offerIds: string[]; rationale: string }[],
  maxPages: number,
): CataloguePlan {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const owned = new Set(brand.templates.map((t) => t.id));
  const perPage = maxOffersPerPage(brand);
  const used = new Set<string>();
  const pages: PlannedPage[] = [];

  for (const page of proposed) {
    if (pages.length >= maxPages) break;

    const offerIds: string[] = [];
    for (const id of page.offerIds) {
      if (!byId.has(id) || used.has(id) || offerIds.length >= perPage) continue;
      used.add(id);
      offerIds.push(id);
    }
    if (offerIds.length === 0) continue;

    pages.push({
      title: page.title,
      subtitle: page.subtitle,
      // An id from another chain, or a hallucinated one, is replaced with
      // the empty string; composition then picks a fitting layout from
      // this brand and reports the substitution.
      templateId: owned.has(page.templateId) ? page.templateId : '',
      offerIds,
      rationale: page.rationale,
    });
  }

  /*
   * Anything the model forgot still has to reach the catalogue — but
   * without breaking the page ceiling.
   *
   * Leftovers fill the existing pages first, and only open a new page
   * while there is budget for one. Surplus beyond that is reported as
   * dropped rather than vanishing: with a deliberate page cap, having
   * more offers than fit is the expected case, not an error.
   */
  const missed = offers.filter((o) => !used.has(o.id));
  let cursor = 0;

  for (const page of pages) {
    while (cursor < missed.length && page.offerIds.length < perPage) {
      page.offerIds.push(missed[cursor]!.id);
      cursor += 1;
    }
  }
  while (cursor < missed.length && pages.length < maxPages) {
    const slice = missed.slice(cursor, cursor + perPage);
    cursor += slice.length;
    pages.push({
      title: slice[0]?.category ?? 'Tilbud',
      subtitle: '',
      templateId: '',
      offerIds: slice.map((o) => o.id),
      rationale: 'tilføjet af validatoren — planen udelod disse tilbud',
    });
  }

  return { pages, dropped: missed.slice(cursor).map((o) => o.id) };
}

/**
 * Turn an SDK error into something a person can act on. The status code
 * is the whole story: 401 means fix the key, 429 means wait, 400 means
 * the request was wrong.
 */
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) return 'Ugyldig API-nøgle — tjek ANTHROPIC_API_KEY i .env';
    if (error.status === 403) return 'API-nøglen har ikke adgang til denne model';
    if (error.status === 429) return 'Rate limit hos Anthropic — prøv igen om lidt';
    if (error.status === 404) return `Ukendt model: ${error.message}`;
    if (error.status && error.status >= 500) return 'Anthropics API er nede — prøv igen om lidt';
    return `Anthropic API-fejl ${error.status ?? '?'}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
