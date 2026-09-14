import type { Offer } from '@incitio/schema';
import { offerImportance } from '@incitio/compose';
import { generateJson, type GeminiOptions } from './gemini.js';

/**
 * What a page should depict, and whether it should depict anything.
 *
 * The "whether" is the load-bearing half. Given a page of offers a naive
 * rule would draw the biggest one, and on SuperBrugsen's own p05 that is
 * Lotus toiletpapir — a photograph of toilet paper is not atmosphere, it
 * is the opposite. Deciding that kitchen roll gets no motif while
 * almonds get a handful of almonds is editorial judgement, which is why
 * it is a model call and not a lookup table.
 *
 * Deliberately its own call rather than another field on the curator's
 * plan schema, even though that would be one request cheaper:
 *
 *   - it has to run on `--no-ai` catalogues, which never call a curator;
 *   - it has to be re-runnable on a document that is already built and
 *     edited, without re-curating and shuffling every page;
 *   - it keeps the Gemini key inside this one package.
 */

/*
 * OpenAPI-flavoured, not JSON Schema.
 *
 * Gemini's `responseSchema` takes a SUBSET of OpenAPI 3 and rejects the
 * request outright on anything outside it — `additionalProperties`,
 * which the curator's Anthropic schema uses to pin the shape, comes back
 * as a 400 naming the field. There is no way to forbid extra keys here,
 * so `chooseSubjects` ignores what it did not ask for instead.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          draw: {
            type: 'boolean',
            description: 'False when no offer on this page has an appetising or evocative subject.',
          },
          offerId: {
            type: 'string',
            description: 'The offer the motif comes from. Empty string when draw is false.',
          },
          subject: {
            type: 'string',
            description: 'Danish noun phrase naming the motif, e.g. "en håndfuld mandler". Empty when draw is false.',
          },
          motif: {
            type: 'string',
            description:
              'English, concrete, for an image generator: the bare subject only, '
              + 'no styling or lighting words. E.g. "a loose handful of whole almonds". '
              + 'Empty when draw is false.',
          },
        },
        required: ['pageId', 'draw', 'offerId', 'subject', 'motif'],
      },
    },
  },
  required: ['pages'],
} as const;

const SYSTEM = `You choose decorative motifs for a printed supermarket leaflet.

Each page already shows its products as packshots. Your motif is the
EXTRA artwork a designer paints in behind them to set a mood — a handful
of almonds, a sprig of rosemary, a scatter of coffee beans, a halved
orange. It is atmosphere, never a second picture of the product.

Rules:
- Draw the INGREDIENT or the RAW FOOD, not the package. "Coop mandler
  200 g" becomes a handful of loose almonds, never a bag.
- Choose the offer whose subject is most evocative, which is rarely the
  cheapest or the largest. A page of cleaning products, toiletries,
  paper goods, batteries or pet supplies gets NOTHING: set draw=false.
  Saying no is a correct and common answer.
- Non-food that is genuinely evocative is allowed — fresh flowers,
  candles, a folded wool blanket. Detergent is not.
- The motif must be a single simple subject that reads at a glance when
  it is small and partly off the edge of the page. No scenes, no people,
  no hands, no kitchens, no table settings, no text.
- "subject" is Danish and is shown to the person editing the leaflet.
  "motif" is English and is fed to an image generator.

Answer for every page you are given, in the same order.`;

export interface PageBrief {
  pageId: string;
  title: string;
  offers: Offer[];
}

export interface PageSubject {
  pageId: string;
  /** Null when this page should carry no decoration. */
  subject: { offerId: string | null; subject: string; motif: string } | null;
}

export interface SubjectResult {
  pages: PageSubject[];
  usage?: { input: number; output: number };
}

/** The few facts the choice actually turns on. */
function summarise(offer: Offer): string {
  const name = offer.brand ? `${offer.brand} ${offer.name}` : offer.name;
  return `${offer.id} | ${name} | ${offer.category} | vægt ${offerImportance(offer).toFixed(2)}`;
}

export async function chooseSubjects(
  pages: PageBrief[],
  options: GeminiOptions & { brief?: string } = {},
): Promise<SubjectResult> {
  if (pages.length === 0) return { pages: [] };

  const body = pages.map((page) => [
    `## side ${page.pageId} — "${page.title || 'uden overskrift'}"`,
    ...page.offers.map((o) => `- ${summarise(o)}`),
  ].join('\n')).join('\n\n');

  const prompt = [
    SYSTEM,
    options.brief ? `\nEditor's direction: ${options.brief}` : '',
    '\n---\n',
    body,
  ].join('\n');

  const { value, usage } = await generateJson<{ pages: SubjectRow[] }>(prompt, SCHEMA, options);

  return { pages: reconcile(pages, value.pages ?? []), ...(usage ? { usage } : {}) };
}

export interface SubjectRow {
  pageId: string;
  draw: boolean;
  offerId: string;
  subject: string;
  motif: string;
}

/**
 * Trust nothing it said about ids — same stance as the curator's
 * `validate`, and pure so it can be tested without a network.
 *
 * A motif hung on an invented offer id would render perfectly well and
 * then be impossible to trace back to why it is on the page, which is
 * the one question anybody asks about generated artwork. An unknown id
 * becomes `null`: the motif still gets drawn, it just stops claiming a
 * provenance it does not have.
 */
export function reconcile(pages: PageBrief[], rows: SubjectRow[]): PageSubject[] {
  const wanted = new Map(pages.map((p) => [p.pageId, p]));
  const answered = new Map<string, PageSubject>();

  for (const row of rows) {
    const page = wanted.get(row.pageId);
    // Unknown page, or a second answer for one already covered.
    if (!page || answered.has(row.pageId)) continue;
    const known = page.offers.some((o) => o.id === row.offerId);
    answered.set(row.pageId, {
      pageId: row.pageId,
      subject: row.draw && row.motif.trim()
        ? {
          offerId: known ? row.offerId : null,
          subject: row.subject.trim(),
          motif: row.motif.trim(),
        }
        : null,
    });
  }

  // A page the model skipped gets no decoration, not a guess.
  return pages.map((p) => answered.get(p.pageId) ?? { pageId: p.pageId, subject: null });
}
