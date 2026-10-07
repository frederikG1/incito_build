import { Liquid, type TagToken, type Context, type Emitter } from 'liquidjs';
import type { Offer } from '@incitio/schema';

/**
 * The Liquid that incito's paragraphs are written in, and the offer as
 * the variables they read.
 *
 * Standard Liquid covers nearly all of it (`if`, `unless`, `assign`,
 * `remove`, `split`, `truncatewords` …). The one addition is incito's own
 * `{% format_price path:"offerPrice" thousand:".", postfix:",-" %}`,
 * which prints a number the way a Danish price mark does: whole kroner
 * with the postfix ("19,-"), anything else with a decimal comma
 * ("19,95"). `path` may name an offer field or a variable the paragraph
 * assigned itself — "29,95" out of a label, turned into "29.95".
 */
const engine = new Liquid({ cache: true, strictVariables: false, strictFilters: false });

function formatPrice(value: number, thousand: string, postfix: string): string {
  const whole = Math.round(value * 100) % 100 === 0;
  const int = Math.floor(Math.abs(value) + (whole ? 0.001 : 0));
  const grouped = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, thousand);
  const sign = value < 0 ? '-' : '';
  if (whole) return `${sign}${grouped}${postfix}`;
  const cents = String(Math.round((Math.abs(value) - int) * 100)).padStart(2, '0');
  return `${sign}${grouped},${cents}`;
}

engine.registerTag('format_price', {
  parse(token: TagToken) {
    const args: Record<string, string> = {};
    for (const match of token.args.matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) args[match[1]!] = match[2]!;
    (this as unknown as { args: Record<string, string> }).args = args;
  },
  render(ctx: Context, emitter: Emitter) {
    const args = (this as unknown as { args: Record<string, string> }).args;
    const raw = ctx.getSync([args['path'] ?? 'offerPrice']);
    const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.'));
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) return;
    emitter.write(formatPrice(value, args['thousand'] ?? '.', args['postfix'] ?? ',-'));
  },
});

/** One paragraph, rendered. Broken Liquid prints nothing rather than taking the page down. */
export function renderLiquid(text: string, vars: Record<string, unknown>): string {
  if (!text.includes('{')) return text;
  try {
    return engine.parseAndRenderSync(text, vars).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

const kr = (value: number) => (Math.round(value * 100) % 100 === 0 ? `${Math.round(value)},-` : value.toFixed(2).replace('.', ','));

/**
 * The offer as incito's variables. Names are the CMS's (`offerCustomLabel2`,
 * `offerLegalInfo` …); values come from our offer the way the Tjek
 * transformed-offers export writes them, so a design reads the same field
 * here as in the CMS.
 */
/*
 * A saving over 100 kr. is said without øre — "Spar 560,-", not
 * "Spar 560,70" — as the printed avis does: the figure has to fit the
 * disc, and the øre add nothing a shopper weighs. Rounded DOWN, so the
 * page never promises more than is saved.
 */
const WHOLE_FROM = 100;
const savingSaid = (value: number | null): number | null =>
  (value !== null && value > WHOLE_FROM ? Math.floor(value) : value);
/** The same, inside a label's own words: "Spar 29,95 - 149,95" → "Spar 29,95 - 149". */
const savingWords = (text: string): string => text.replace(/\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/g, (figure) => {
  const value = Number(figure.replace(/\./g, '').replace(',', '.'));
  return value > WHOLE_FROM && figure.includes(',') ? figure.slice(0, figure.indexOf(',')) : figure;
});

/** "fra" on the line over a lowest-of-several price, after the pack word when there is one. */
function fromSaid(from: boolean, head: string): string {
  if (!from) return head;
  return head ? `${head} fra` : 'fra';
}

export function incitoVars(offer: Offer, words: { name?: string | null; description?: string | null } = {}): Record<string, unknown> {
  const saving = offer.savings !== null && offer.savings > 0 ? offer.savings
    : offer.prePrice !== null && offer.prePrice > offer.price ? Math.round((offer.prePrice - offer.price) * 100) / 100 : null;
  const percent = offer.savingsPercent
    ?? (offer.prePrice !== null && offer.prePrice > offer.price ? Math.round(((offer.prePrice - offer.price) / offer.prePrice) * 100) : null);
  const member = offer.memberPrice;
  const memberSaving = member !== null && member < offer.price ? Math.round((offer.price - member) * 100) / 100 : null;
  const said = (kind: Offer['labels'][number]['kind']) => offer.labels.filter((l) => l.kind === kind && !l.image).map((l) => l.text).join(', ');
  const tags = offer.labels.filter((l) => !l.image && (l.kind === 'custom' || l.kind === 'new' || l.kind === 'organic')).map((l) => l.text);
  const description = words.description ?? offer.description;
  // The chain may already print its unit price in the fine print — then it is not said twice.
  const legal = offer.comparison && !/pris/i.test(description)
    ? `${kr(offer.comparison.value)}/${({ kg: 'kg', l: 'L', pcs: 'stk', m: 'm' } as const)[offer.comparison.unit]}`
    : '';
  const blank = (value: string) => (value.trim() === '' ? null : value);
  return {
    offerName: words.name ?? offer.name,
    offerDescription: description,
    offerPrice: offer.price > 0 ? offer.price : null,
    offerFromPrice: offer.priceFrom ? offer.price : null,
    offerPreprice: offer.prePrice,
    offerSavings: savingSaid(saving),
    offerRelativeSavings: percent,
    offerMembershipPrice: member,
    offerMembershipSavings: savingSaid(memberSaving),
    offerMembershipRelativeSavings: memberSaving !== null ? Math.round((memberSaving / offer.price) * 100) : null,
    /*
     * The line over the figure — "1 pakke", or "fra" when the products
     * under one price cost different amounts and the figure is the
     * lowest. The chain's designs print `offerFromPrice` as a bare
     * number, so without the word a "fra" price reads as everyone's.
     */
    offerCommentLabel1: blank(fromSaid(offer.priceFrom, offer.pack || (member !== null ? 'Medlemspris' : ''))),
    offerCommentLabel2: blank(said('multibuy')),
    offerCommentLabel3: blank(savingWords(said('saving'))),
    offerCustomLabel1: blank(tags.join(', ')),
    /*
     * Not the campaign. SuperBrugsen's designs print this field in the
     * sticker disc and read it as a price ("Spar" when it is set and the
     * offer is not a member price), so "Månedens køb" came out as a
     * broken sticker on every product of the campaign. A campaign is the
     * PAGE's headline; no field we have means what the chain puts here.
     */
    offerCustomLabel2: null,
    offerCustomLabel3: null,
    offerLegalInfo: blank(legal),
    offerBrand: blank(offer.brand),
  };
}
