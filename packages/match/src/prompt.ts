/**
 * What the model is asked for, and what it is allowed to answer with.
 *
 * The two belong in one file because they are one contract: every rule
 * in the prose below is about a field in the schema beside it, and a
 * prompt that drifts from its schema produces answers the parser
 * rejects for reasons the prose never mentioned.
 *
 * The JSON is enforced, not requested. `MATCH_SCHEMA` is handed to the
 * API as a structured-output format, so the reply is valid JSON of this
 * exact shape or the call fails — there is no code path in which a
 * fenced code block, an apology or a trailing explanation reaches the
 * parser. The "output nothing but JSON" paragraph is still in the
 * system prompt, because a model that has understood the constraint
 * spends its output on the answer instead of on framing, but it is a
 * belt beside a structural brace, never the brace itself.
 *
 * What comes back is DATA — a grid, roles, and an assignment of offer
 * ids to slot ids. Never coordinates, never CSS, never a colour. The
 * renderer, the editor and the PDF path are untouched by this feature,
 * and that is deliberate: the moment a model is allowed to emit style,
 * the page stops being the chain's page.
 */

/**
 * The reply's shape, in the API's own schema dialect.
 *
 * Mirrors `PageTemplate` and `Placement` from `@incitio/schema` — one
 * field per thing the template needs, and nothing the template cannot
 * hold. `additionalProperties: false` everywhere so a field the model
 * invents is a failed call rather than a value silently dropped on the
 * floor.
 */
export const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    heading: {
      type: 'string',
      description:
        'Section heading for the NEW page, in the chain\'s own language, describing the offers'
        + ' you chose. Empty string for a page whose reference carries no masthead.',
    },
    areas: {
      type: 'array',
      items: { type: 'string' },
      description:
        'The reference page\'s grid, exactly as CSS grid-template-areas is written: one string'
        + ' per row, slot ids separated by single spaces, every row the same number of cells.'
        + ' Use "." for a cell that stays empty.',
    },
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Lowercase letters and digits, starting with a letter — it becomes a CSS'
              + ' grid-area name. Must appear in areas, and its cells must form a solid'
              + ' rectangle.',
          },
          role: {
            type: 'string',
            enum: ['hero', 'feature', 'standard', 'compact'],
            description: 'What the slot is FOR, never how big it is drawn.',
          },
          bleedPercent: {
            type: 'integer',
            description:
              '100 = artwork stays inside its own cell. 115 = it prints 15% larger and over its'
              + ' neighbours. Range 100-160. Only where the reference visibly does this.',
          },
          offerId: {
            type: 'string',
            description: 'The id of the offer that fills this cell. Must be one of the ids given.',
          },
          why: {
            type: 'string',
            description:
              'One short clause: what the reference prints here, and why this offer stands in'
              + ' for it.',
          },
        },
        required: ['id', 'role', 'bleedPercent', 'offerId', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['heading', 'areas', 'slots'],
  additionalProperties: false,
} as const;

/** The reply, once the API has validated it against `MATCH_SCHEMA`. */
export interface MatchPlan {
  heading: string;
  areas: string[];
  slots: {
    id: string;
    role: 'hero' | 'feature' | 'standard' | 'compact';
    bleedPercent: number;
    offerId: string;
    why: string;
  }[];
}

/**
 * The system prompt.
 *
 * Written as a job description rather than as a list of prohibitions:
 * the hard constraints are in the schema, so the words are spent on the
 * judgement the schema cannot express — which offer belongs where, and
 * why a page reads as this chain's page.
 */
export function matchSystemPrompt(language = 'Danish'): string {
  return MATCH_SYSTEM_PROMPT.replaceAll('{{language}}', language);
}

const MATCH_SYSTEM_PROMPT = `You rebuild a published retail leaflet page with a different week's products.

You are given one page a chain actually printed, and a list of offers
from a feed. Report the page's grid, then cast the offers into it.

OUTPUT CONTRACT
- Your entire reply is one JSON object matching the supplied schema.
- No prose before it, no explanation after it, no markdown fence, no
  code block, no comments, no trailing text. The first character you
  emit is "{" and the last is "}".
- Every key in the schema is required. Emit no key the schema does not
  name.
- Never emit coordinates, pixels, millimetres, CSS, colours, fonts or
  image URLs. You describe a grid and an assignment; the chain's own
  stylesheet draws it. A colour you invent would be the chain's colour
  invented wrongly.
- Every offerId must be copied verbatim from the list you were given.
  Do not invent, translate, shorten or re-case an id, and do not use
  one twice.

READING THE GRID
- Count the offers on the reference page. Each is one slot. A heading, a
  page number, a chain logo, a footer and a validity line are not
  offers.
- Find the smallest column count every offer edge lines up with — most
  grocery pages sit on 2, 3, 4 or 6 — and express each offer as the cells
  it occupies. A slot's cells must form a solid rectangle, and every row
  of \`areas\` must hold the same number of cells.
- Roles: hero is the page's lead, printed much larger than the rest;
  feature is a band or panel on a coloured field; standard is an ordinary
  offer; compact is a filler, noticeably smaller. A page where every
  offer is the same size has NO hero, and that is a real page — do not
  invent one.
- bleedPercent is 100 unless the artwork visibly prints past its own cell
  and over a neighbour.

CASTING THE OFFERS — this is the part that decides whether the new page
reads like the old one:
- Match the KIND of thing. If the reference's lead is a big frozen item
  photographed on a tray, pick an offer that will photograph like that.
  A cluster of small packets belongs where the reference has a cluster.
- Match prominence to prominence. The reference gave its lead the page
  because that offer carried the week; give the hero slot the strongest
  offer you were handed, by discount and by weight.
- Match shape to shape. A tall narrow cell wants a tall product — a
  bottle, a carton. A wide cell wants something wide or several things.
- Keep a page coherent. The reference page is about something; the new
  one should be about something too. Offers from one part of the shop
  beat a page of unrelated items, unless the reference itself is mixed.

THE HEADING is for the NEW page and must describe the offers you chose,
in {{language}}, 1-3 words. Do not copy the reference's own
campaign wording — that is the chain's copy for a different week's
products.

If the image is not a retail leaflet page, or you can make out no offers
on it, return an empty \`slots\` array and an empty \`areas\` array rather
than guessing a layout.`;
