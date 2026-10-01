import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { TILE_ARRANGEMENTS, TILE_PARTS, type Brand, type CatalogDocument } from '@incitio/schema';
import { EditOp } from './ops.js';
import { outline, outlineText } from './outline.js';

/**
 * A sentence in, edit ops out — "gør osten større", "byt de to øl",
 * "sæt Lurpak forrest på side 3".
 *
 * The model is handed the page as an outline and answers in `EditOp`s,
 * never in coordinates it has to invent or a document it could corrupt.
 * Nothing lands until the caller applies the ops — the studio shows them
 * first — and `applyOps` still refuses any id the model made up.
 * Called only when someone presses the button; nothing calls it on its own.
 */
export const DEFAULT_INSTRUCT_MODEL = 'claude-opus-5';

const OPS = EditOp.options.map((option) => option.shape.op.value);
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const str = nullable({ type: 'string' });
const num = nullable({ type: 'number' });

/*
 * One flat op shape with every field present, rather than a union of
 * thirteen: structured output holds a flat object reliably, and
 * `EditOp` decides afterwards whether the fields make an op. Strings use
 * "" for "not used" — the API caps a schema at 16 union-typed fields —
 * so only the numbers, the booleans and `text` (where null means "back
 * to the feed's words" and "" means "remove the line") are nullable.
 */
const FIELDS = {
  op: { type: 'string', enum: OPS },
  offerId: { type: 'string' }, withOfferId: { type: 'string' }, pageId: { type: 'string' }, slotId: { type: 'string' },
  part: { type: 'string', enum: ['', ...TILE_PARTS] },
  text: str,
  offsetX: num, offsetY: num, scale: num,
  hidden: nullable({ type: 'boolean' }),
  arrangement: { type: 'string', enum: ['', 'auto', ...TILE_ARRANGEMENTS], description: '"auto" lets the page decide; "" when not used.' },
  pinned: nullable({ type: 'boolean' }),
  price: num, prePrice: num,
  title: { type: 'string' }, subtitle: { type: 'string' }, templateId: { type: 'string' },
  to: num,
} as const;

const SCHEMA = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      items: { type: 'object', properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false },
    },
    explanation: { type: 'string', description: 'One or two sentences in Danish: what the ops do.' },
    unclear: { type: 'string', description: 'When the request cannot be done with these ops or is ambiguous: why, in Danish. Otherwise "".' },
  },
  required: ['ops', 'explanation', 'unclear'],
  additionalProperties: false,
} as const;

function vocabulary(): string {
  return EditOp.options.map((option) => {
    const fields = Object.entries(option.shape)
      .filter(([key]) => key !== 'op')
      .map(([key, value]) => `${key}${(value as { isOptional(): boolean }).isOptional() ? '?' : ''}`);
    return `- ${option.shape.op.value}(${fields.join(', ')}): ${option.description ?? ''}`;
  }).join('\n');
}

const SYSTEM = `You edit a supermarket's weekly offer leaflet (a Danish "tilbudsavis") by emitting edit operations.

You are given the leaflet as an outline: its pages, each page's slots with the offer standing in each, the offers waiting in reserve, and the layouts the chain owns. You answer with a list of operations from this vocabulary:

${vocabulary()}

Rules:
- Use only ids that appear in the outline. Never invent an offer, page, slot or layout id.
- Values are absolute, not deltas: "20% bigger" on a box at scale 1 is scale 1.2. A box nobody touched is at offset 0, scale 1.
- Use the fewest operations that do what was asked. Do not tidy up anything else.
- "This", "it", "denne", "den her" refer to the selection, when one is given.
- Leave every field an operation does not take as "" (strings) or null (numbers, booleans, text).
- Write the explanation in Danish, plainly, for store staff.
- If the request cannot be expressed with these operations, return no operations and say why in "unclear".`;

export interface InstructOptions {
  apiKey?: string;
  model?: string;
  /** What the person has selected in the studio, so "denne" means something. */
  selection?: { offerId?: string | null; pageId?: string | null };
}

export interface InstructResult {
  ops: EditOp[];
  explanation: string;
  unclear: string | null;
  /** Ops the model wrote that did not make valid ops, with why — dropped. */
  rejected: { op: unknown; reason: string }[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** The model's flat op, with the unused fields taken out, as an `EditOp` or a reason it is not one. */
export function readFlatOp(flat: Record<string, unknown>): { op: EditOp } | { reason: string } {
  const present: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value === null || (value === '' && key !== 'text')) continue;
    present[key] = value;
  }
  if (present['arrangement'] === 'auto') present['arrangement'] = null;
  // A text op with null text means "back to the feed's words".
  if (flat['op'] === 'text' && !('text' in present)) present['text'] = null;
  // Only a text op takes text; elsewhere a stray "" is just unused.
  if (flat['op'] !== 'text') delete present['text'];
  const parsed = EditOp.safeParse(present);
  return parsed.success
    ? { op: parsed.data }
    : { reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; ') };
}

export async function instruct(
  document: CatalogDocument,
  brand: Brand,
  instruction: string,
  options: InstructOptions = {},
): Promise<InstructResult> {
  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const selection = options.selection;
  const selected = [
    selection?.offerId ? `offer ${selection.offerId}` : '',
    selection?.pageId ? `page ${selection.pageId}` : '',
  ].filter(Boolean).join(', ');

  const response = await client.beta.messages.parse({
    model: options.model ?? DEFAULT_INSTRUCT_MODEL,
    max_tokens: 16000,
    // A declined request is re-run on the fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    // Interactive: someone is waiting at the page, and the ops are small.
    output_config: { format: betaJSONSchemaOutputFormat(SCHEMA), effort: 'medium' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        `The leaflet (${brand.name}):`,
        '',
        outlineText(outline(document, brand)),
        '',
        `Selection: ${selected || 'nothing'}`,
        '',
        `Request: ${instruction.trim()}`,
      ].join('\n'),
    }],
  });

  if (response.stop_reason === 'refusal') {
    return { ops: [], explanation: '', unclear: 'Modellen ville ikke udføre ændringen.', rejected: [] };
  }
  const answer = response.parsed_output as { ops: Record<string, unknown>[]; explanation: string; unclear: string } | null;
  if (!answer) throw new Error('model returned no parsable answer');

  const ops: EditOp[] = [];
  const rejected: InstructResult['rejected'] = [];
  for (const flat of answer.ops) {
    const read = readFlatOp(flat);
    if ('op' in read) ops.push(read.op);
    else rejected.push({ op: flat, reason: read.reason });
  }
  return {
    ops,
    explanation: answer.explanation,
    unclear: answer.unclear.trim() || null,
    rejected,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
