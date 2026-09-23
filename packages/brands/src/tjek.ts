import type { OfferLabelInput, Quantity } from '@incitio/schema';
import { EMPTY_LABEL_DICTIONARY, resolveLabels, type FieldMapping, type LabelDictionary } from '@incitio/ingest';

/**
 * The Tjek offers API shape — a flat array of offer objects, which is
 * what a single store publishes and what most chains on the platform
 * deliver.
 *
 * Written once and parameterised by chain, because the shape is the
 * platform's, not the chain's: onboarding another retailer that
 * publishes here is `tjekOffers('netto')`, not another 200 lines.
 */

interface TjekQuantity {
  unit?: { symbol?: string; si?: { symbol?: string; factor?: number } };
  size?: { from?: number | null; to?: number | null };
  pieces?: { from?: number | null; to?: number | null };
}

const UNITS: Record<string, Quantity['unit']> = {
  kg: 'kg', g: 'g', l: 'l', ml: 'ml', cl: 'ml', dl: 'ml',
  pcs: 'pcs', stk: 'pcs', m: 'm', pack: 'pack',
};

/**
 * Size, unit and piece count from the feed's structured quantity.
 *
 * Ranges are common — "90-175 g", "15-18 x 33 cl" — because one offer
 * covers several pack sizes, and the LOWER bound is the one to carry.
 * The chain prints "Kg-pris maks." beside these, and a maximum unit
 * price is price divided by the SMALLEST pack: Taffel at 12 kr over
 * 90-175 g is quoted at 133,33/kg, which is 12/0.090. Taking the upper
 * bound would derive 68,57 and print a figure the chain does not
 * stand behind.
 */
export function tjekQuantity(raw: unknown): Quantity {
  const q = raw as TjekQuantity | undefined;
  const symbol = q?.unit?.symbol?.toLowerCase() ?? '';
  const unit = UNITS[symbol];
  const size = q?.size?.from ?? q?.size?.to ?? null;
  const pieces = q?.pieces?.from ?? 1;

  if (!unit || size === null || !Number.isFinite(size)) {
    return { size: null, unit: 'pcs', pieceCount: Math.max(1, Math.round(pieces || 1)) };
  }
  // Centilitres and decilitres are stored as millilitres so the
  // comparison maths downstream has one scale per dimension.
  const scale = symbol === 'cl' ? 10 : symbol === 'dl' ? 100 : 1;
  if (unit === 'pcs') {
    return { size: null, unit: 'pcs', pieceCount: Math.max(1, Math.round(pieces || 1)) };
  }
  return { size: size * scale, unit, pieceCount: Math.max(1, Math.round(pieces || 1)) };
}

/**
 * Editorial phrases the chain writes into the description.
 *
 * These are the chain's own words and are printed verbatim — "Frit
 * valg." is a promise about what the price covers and "Begrænset
 * parti." is a legal qualifier. They are lifted into labels so a tile
 * can set them as chips rather than burying them in fine print.
 */
const PHRASES: { pattern: RegExp; kind: OfferLabelInput['kind']; text: string }[] = [
  { pattern: /frit valg/i, kind: 'custom', text: 'Frit valg' },
  { pattern: /flere varianter/i, kind: 'custom', text: 'Flere varianter' },
  { pattern: /begrænset parti/i, kind: 'custom', text: 'Begrænset parti' },
  { pattern: /ugens køb/i, kind: 'new', text: 'Ugens køb' },
  { pattern: /dybfrost/i, kind: 'custom', text: 'Dybfrost' },
  { pattern: /ikke egnet til børn/i, kind: 'custom', text: 'Ikke egnet til børn' },
];

/**
 * Certification claims, read from the product itself.
 *
 * A separate table from `PHRASES` above, and the split is the point.
 * Those are editorial words the chain writes into the DESCRIPTION and
 * prints verbatim. These are claims about what the product IS, and a
 * chain writes them wherever it likes — measured on the shipped feeds,
 * every occurrence of "økologisk" is in the HEADING ("Änglamark
 * økologisk ingefær"), which is why the organic mark never appeared:
 * the rule was right and it was reading the wrong field.
 *
 * `text` is not a display string. It is the key the shipped label
 * dictionary matches on, and those patterns are fully ANCHORED — see
 * `data/labels/tjek-labels.json`, where organic is
 * `(^økologi$)|(^økologi logo$)|(^økologisk$)`. Change one of these
 * strings and the mark silently becomes a word again, so each one below
 * names the dictionary row it is aimed at.
 *
 * Deliberately short, and deliberately only the claims that are
 * explicit. A certification mark printed on a product that does not
 * carry it is worse than a missing one: "Dansk hvidkål" is a product
 * name and not a declaration that the Danish flag mark applies, so
 * there is no rule for the flag here. The chain's own `Logos` field on
 * the Coop export says which products carry the flag — see the
 * `coop-export` mapping — and where a feed states it, it is stated
 * rather than guessed.
 */
/**
 * A whole word, in a language that has æ, ø and å in it.
 *
 * NOT `\b`. JavaScript's word boundary is defined against `\w`, which
 * is `[A-Za-z0-9_]` — so `ø` is a NON-word character, and `\bøkologisk\b`
 * never matches anything at all. It fails silently and looks correct,
 * which cost this rule its entire existence once already: the organic
 * mark was written, shipped, and matched zero products.
 *
 * `\p{L}` under the `u` flag is every letter in every script, so the
 * lookarounds below mean what `\b` is normally read to mean. It still
 * rejects "økonomi" for `øko` and "arkæologi" for `økologi`.
 */
const word = (body: string) => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');

const CERTIFICATIONS: { pattern: RegExp; kind: OfferLabelInput['kind']; text: string }[] = [
  // dictionary row `organic` → /labels/marks/organic.svg
  // Danish inflects: økologisk / økologiske / økologisk-. Änglamark is
  // Coop's own organic line and carries the mark on every product.
  { pattern: word('økologisk|økologiske|øko|änglamark'), kind: 'organic', text: 'Økologisk' },
  // dictionary row `noglehul` → /labels/marks/noglehul.svg
  { pattern: word('nøglehul|nøglehuls|nøglehullet'), kind: 'custom', text: 'Nøglehul' },
  // dictionary row `msc` → /labels/marks/msc.svg
  { pattern: word('msc'), kind: 'custom', text: 'MSC' },
  // dictionary row `svanemarke` → /labels/marks/svanemarke.svg
  { pattern: word('svanemærket|svanemærke'), kind: 'custom', text: 'Svanemærket' },
];

/**
 * The labels one offer carries.
 *
 * Two fields, because the two tables read different things: the chain's
 * editorial phrases are written into the description, and a
 * certification claim can be in either. Passing the heading for the
 * mechanics too would chip a product merely named "Dybfrost-noget".
 */
export function tjekLabels(
  description: string,
  heading = '',
  dictionary: LabelDictionary = EMPTY_LABEL_DICTIONARY,
): OfferLabelInput[] {
  const found = PHRASES.filter((p) => p.pattern.test(description));
  // "Frit valg" and "Flere varianter" say the same thing to a shopper;
  // published tiles print one of them, not both.
  const deduped = found.filter(
    (p) => !(p.text === 'Flere varianter' && found.some((o) => o.text === 'Frit valg')),
  );

  /*
   * A certification becomes the MARK, not the word for it.
   *
   * This lookup is the difference between the Ø-mark and a chip reading
   * "Økologisk", and forgetting it is how this feed printed words while
   * the Coop export next door printed marks — that mapping resolved its
   * `Logos` and this one resolved nothing. A caller that supplies no
   * dictionary still gets the label, just without artwork, and keeps the
   * kind declared above rather than being demoted to `custom`.
   */
  const product = `${heading} ${description}`;
  const certified = CERTIFICATIONS
    .filter((c) => c.pattern.test(product))
    .map(({ kind, text }) => {
      const [mark] = resolveLabels(dictionary, [text]);
      return mark?.image ? mark : { kind, text };
    });

  // Marks first: the tile gives the row above the name to whatever comes
  // first and a certification outranks a mechanic there.
  return [...certified, ...deduped.map(({ kind, text }) => ({ kind, text }))];
}

/**
 * The pack the price applies to — "1 pose", "1 bakke", "1 flaske/dåse".
 *
 * The chain writes it as the last sentence of the description and prints
 * it directly above the price, because it is what the number buys. The
 * same phrases are stripped from the fine print by `tjekFinePrint`
 * below; this is the other half of that — the words were already being
 * recognised and then thrown away.
 *
 * Only the leading "1", never a weight. "1 kg" is a quantity and belongs
 * in the fine print; "1 pose" is a unit, and the two look alike only
 * until a shopper wonders whether 12 kroner buys the bag or the kilo.
 */
const PACK = /\b1\s+(stk|pose|pakke|pk|flaske|flaske\/dåse|dåse|bakke|bæger|bundt|net|spand|ks)\.?/i;

export function tjekPack(description: string): string {
  const hit = PACK.exec(description);
  if (!hit) return '';
  return `1 ${hit[1]!.toLowerCase()}${/stk|pk/i.test(hit[1]!) ? '.' : ''}`;
}

/**
 * What is left of the description once the chips and the unit price
 * have been taken out of it.
 *
 * Printing the raw string under a tile that already shows "Frit valg."
 * as a chip and "133,33 / kg" as a comparison repeats both. What
 * remains — "Danmark, kl. I.", "Sælges i hele forpakninger" — is the
 * part a leaflet actually sets as fine print.
 */
export function tjekFinePrint(description: string): string {
  return description
    .replace(/(kg|liter|stk\.?|meter)-?pris\s*(?:maks\.?)?\s*[\d.,]+/gi, '')
    .replace(/\b(frit valg|flere varianter|begrænset parti|ugens køb|dybfrost|ikke egnet til børn)\b\.?/gi, '')
    .replace(/\+\s*pant/gi, '')
    .replace(/\b\d+[\d,.\s–-]*\s*(g|kg|ml|cl|dl|l|stk\.?)\b\.?/gi, '')
    .replace(/\b1\s+(stk|pose|pakke|flaske|dåse|bakke|bæger|bundt)\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,]+|[\s.,]+$/g, '')
    .trim();
}

/**
 * Coarse category from the product heading.
 *
 * The Tjek payload carries `category_ids`, and on these feeds it is
 * empty on every offer — so without this every product lands in one
 * bucket and the deterministic planner produces a single section
 * called "Uncategorised". Keyword matching is crude, but it is honest
 * about being crude and it is only ever a FALLBACK: when the curator
 * runs it groups by meaning and never reads this.
 */
const CATEGORIES: { pattern: RegExp; name: string }[] = [
  { pattern: /øl|vin|cider|spiritus|whisky|gin|rom|cognac|tequila|breezer|somersby/i, name: 'Øl og vin' },
  { pattern: /sodavand|kondi|pepsi|cola|juice|saft|drik|vand|energy|red bull|kaffe|te\b/i, name: 'Drikkevarer' },
  { pattern: /chips|nødder|slik|chokolade|lakrids|bolche|kage|is\b|dessert|snack|m&m|malteser/i, name: 'Snacks og slik' },
  { pattern: /mælk|yoghurt|ost|smør|fløde|hytteost|skyr|æg\b|mejeri/i, name: 'Mejeri' },
  { pattern: /brød|rugbrød|boller|knækbrød|wraps|toast/i, name: 'Brød' },
  { pattern: /kød|kylling|gris|okse|kalv|bacon|pølse|hakket|filet|fisk|laks|rejer/i, name: 'Kød og fisk' },
  { pattern: /frugt|grønt|salat|tomat|agurk|kartof|løg|æble|blomme|banan|bær|blomst|dahlia/i, name: 'Frugt og grønt' },
  { pattern: /pizza|frost|dybfrost|færdigret|suppe|sauce|dressing|ketchup|mayonnaise|pasta|ris\b/i, name: 'Kolonial' },
  { pattern: /vask|rengør|papir|toilet|ble|shampoo|tandpasta|batteri/i, name: 'Husholdning' },
];

export function tjekCategory(heading: string, description: string): string {
  const text = `${heading} ${description}`;
  return CATEGORIES.find((c) => c.pattern.test(text))?.name ?? 'Øvrige tilbud';
}

/** Field mapping for one chain's Tjek offers feed. */
export function tjekOffers(retailerId: string, sourceName: string): FieldMapping {
  const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? '').trim();

  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    fields: {
      id: 'id',
      name: 'heading',
      description: (row) => tjekFinePrint(text(row, 'description')) || null,
      brand: () => null,
      category: (row) => tjekCategory(text(row, 'heading'), text(row, 'description')),
      price: (row) => (row['pricing'] as { price?: number })?.price ?? null,
      prePrice: (row) => (row['pricing'] as { pre_price?: number })?.pre_price ?? null,
      // The feed states no saving; ingest derives one when a previous
      // price is present and leaves it null otherwise.
      quantityValue: (row) => tjekQuantity(row['quantity']),
      validFrom: 'run_from',
      validTo: 'run_till',
      // `zoom` is the 1000px render. The tiles are printed at A4, so the
      // largest available is the right default; `view` is the fallback.
      imageUrl: (row) => {
        const images = row['images'] as Record<string, string> | undefined;
        return images?.['zoom'] ?? images?.['view'] ?? images?.['thumb'] ?? null;
      },
      /*
       * Position in the chain's own printed book, as editorial weight.
       *
       * A retailer puts its drivers on the first pages, so page 1 is a
       * strong signal and page 36 a weak one. Absent — every offer on
       * page 0 — this returns null and importance falls back to
       * discount depth.
       */
      priority: (row) => {
        const page = Number(row['catalog_page']);
        if (!Number.isFinite(page) || page <= 0) return null;
        return Math.max(0.15, Math.min(1, 1 - (page - 1) / 40));
      },
      pack: (row) => tjekPack(text(row, 'description')),
      labels: (row, dictionary) => tjekLabels(
        text(row, 'description'), text(row, 'heading'), dictionary,
      ),
    },
  };
}

/**
 * The Tjek "transformed offers" export — the platform's own offer rows
 * as the publication builder holds them: a flat array, snake_case,
 * `price`/`membership_price` at the top level, the pack in
 * `comment_label_1` and every variant's packshot under `products[]`.
 *
 * Not the public offers API above (`heading`, `pricing`, `run_from`)
 * and not the chain's own export — a third shape of the same week, and
 * the one a campaign is handed over in once it has been through Tjek.
 */
const TRANSFORMED_UNITS: Record<string, string> = {
  gram: 'g', kilogram: 'kg', milliliter: 'ml', centiliter: 'cl', deciliter: 'dl',
  liter: 'l', piece: 'pcs', meter: 'm',
};

/** A pack mark in `comment_label_1`, or nothing when it holds a price word. */
function transformedPack(row: Record<string, unknown>): string {
  const label = String(row['comment_label_1'] ?? '').trim();
  if (!label || /^(medlemspris|pris)$/i.test(label)) return '';
  return label;
}

/** The value most rows agree on, for rows that leave it out. */
function commonest(rows: Record<string, unknown>[], key: string): unknown {
  const counts = new Map<unknown, number>();
  for (const row of rows) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function tjekTransformed(retailerId: string, sourceName: string): FieldMapping {
  const text = (row: Record<string, unknown>, key: string) =>
    String(row[key] ?? '').replace(/\s+/g, ' ').trim();
  const signed = (image: unknown) => (image as { signed?: string } | null)?.signed ?? null;

  return {
    retailerId,
    sourceName,
    currency: 'DKK',
    /*
     * A handful of rows run "until further notice" and leave the dates
     * out — the daily bake-off and the Friday steak among them. Dropped
     * for want of a date they would vanish from the week they are in,
     * so they take the week the rest of the file agrees on.
     */
    extractRows: (payload) => {
      if (!Array.isArray(payload)) return [];
      const rows = payload as Record<string, unknown>[];
      const from = commonest(rows, 'valid_from');
      const until = commonest(rows, 'valid_until');
      return rows.map((row) => ({
        ...row,
        valid_from: row['valid_from'] ?? from,
        valid_until: row['valid_until'] ?? until,
      }));
    },
    fields: {
      id: (row) => text(row, 'id') || null,
      name: (row) => text(row, 'name') || null,
      description: (row) => text(row, 'description') || null,
      brand: () => null,
      category: (row) => tjekCategory(text(row, 'name'), text(row, 'description')),
      price: 'price',
      prePrice: 'preprice',
      savings: (row) => (row['savings'] ?? row['membership_savings'] ?? null) as number | null,
      quantityValue: (row) => tjekQuantity({
        unit: { symbol: TRANSFORMED_UNITS[String(row['unit_symbol'] ?? '')] },
        size: { from: row['unit_size_from'] as number | null, to: row['unit_size_to'] as number | null },
        pieces: { from: row['piece_count_from'] as number | null, to: row['piece_count_to'] as number | null },
      }),
      pack: transformedPack,
      validFrom: 'valid_from',
      validTo: 'valid_until',
      imageUrl: (row) => signed(row['image']),
      /*
       * Every variant's own packshot, for a "Frit valg" tile — and then
       * NOT the offer's own image. On a several-variant offer `image` is
       * the chain's composed shot of all of them, so adding it to the
       * variants printed every pack twice: once in the group, once alone.
       */
      imagePack: (row) => {
        const products = Array.isArray(row['products']) ? row['products'] : [];
        const variants = [...new Set(products
          .map((p) => signed((p as { image?: unknown }).image))
          .filter((url): url is string => Boolean(url)))];
        if (variants.length > 1) return variants;
        const own = signed(row['image']);
        return own ? [own] : variants;
      },
      labels: (row, dictionary) => {
        const logos = Array.isArray(row['logos']) ? row['logos'] : [];
        const labels: OfferLabelInput[] = resolveLabels(
          dictionary,
          logos.map((logo) => String((logo as { name?: unknown }).name ?? '')),
        );
        if (Number(row['membership_price']) > 0) {
          labels.push({ kind: 'member', text: `Medlemspris ${row['membership_price']}` });
        }
        // "Bjælke: Under halv pris" — the banner the chain asks for.
        const banner = /Bjælke:\s*([^\n¤]+)/.exec(String(row['comment_label_2'] ?? ''));
        if (banner) labels.push({ kind: 'custom', text: banner[1]!.trim() });
        return labels;
      },
    },
  };
}
