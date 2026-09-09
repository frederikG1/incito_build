import { ImageRef, type OfferLabel } from '@incitio/schema';

/**
 * A label dictionary maps the *label text* a feed carries — "økologi",
 * "fairtrade", "nøglehul" — onto the mark a retailer contractually
 * expects to see printed. Certification marks are not decoration: a
 * catalog that prints the word "Økologi" where the customer agreed the
 * Ø-mark would appear is a rendering the retailer will reject.
 *
 * The dictionary format is Tjek/ShopGun's label export: one anchored
 * regex per mark, plus artwork. Every pattern in the source data is
 * fully anchored (`^…$`, or an alternation of anchored branches), so
 * matching is exact-string, never a substring scan. That is deliberate —
 * unanchoring `^rocky$` would tag every "Rocky Road" ice cream.
 */

/** One row of the export, in either of the two spellings it ships with. */
interface RawLabelRow {
  id?: unknown;
  ID?: unknown;
  title?: unknown;
  'Title (optional)'?: unknown;
  link?: unknown;
  'Link (optional)'?: unknown;
  pattern?: unknown;
  Pattern?: unknown;
  positive_image?: unknown;
  'Positive Image URL'?: unknown;
  negative_image?: unknown;
  'Negative Image URL'?: unknown;
}

export interface LabelDefinition {
  id: string;
  /** Display text, falling back to the id when the export leaves it blank. */
  title: string;
  link: string | null;
  /** Compiled case-insensitively; see `compilePattern`. */
  pattern: RegExp;
  /** Artwork for a dark-on-light tile. Null when the row registers none. */
  image: string | null;
  /** Variant for a light-on-dark tile. Only ~1 row in 7 supplies one. */
  imageOnDark: string | null;
  kind: OfferLabel['kind'];
}

export interface LabelDictionary {
  /** Match order. First hit wins, so this is the tie-break for duplicates. */
  entries: LabelDefinition[];
  /** First definition per id. Ids are NOT unique in the source export. */
  byId: ReadonlyMap<string, LabelDefinition>;
}

export interface LabelDictionaryIssue {
  rowIndex: number;
  labelId: string | null;
  reason: string;
}

export interface LabelDictionaryResult {
  dictionary: LabelDictionary;
  issues: LabelDictionaryIssue[];
}

export const EMPTY_LABEL_DICTIONARY: LabelDictionary = { entries: [], byId: new Map() };

/**
 * Ids that map onto a first-class `OfferLabel.kind`. Everything else is
 * `custom`, which is the honest answer: `kind` models *price mechanics*
 * ("Medlemspris", "3 for 2"), and a brand mark like Birkenstock is not
 * one. Only the marks that genuinely change how layout should treat the
 * tile are promoted out of `custom`.
 */
const KIND_BY_ID: Record<string, OfferLabel['kind']> = {
  organic: 'organic',
  'økologi hvid': 'organic',
  '365 økologi': 'organic',
  anglamark: 'organic',
  'eu-ecolabel': 'organic',
  'eco cert': 'organic',
  'oeko-bomuld': 'organic',
  'øko bomuld friends': 'organic',
  'coop-medlem': 'member',
  'fast-lav-pris': 'saving',
  'maanedens-kup': 'saving',
  jackpot: 'saving',
  xtra: 'saving',
  'Coop Xtra': 'saving',
};

function readString(row: RawLabelRow, ...keys: (keyof RawLabelRow)[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * The export is inconsistent about case — 85 of 354 patterns carry
 * capitals (`^Birkenstock$`, `^Mads Stage$`) while the feed text they are
 * matched against is conventionally lowercased. Compiling case-sensitively
 * would silently retire a quarter of the dictionary, so the `i` flag is
 * not optional here. The `u` flag is deliberately omitted: the source
 * contains escapes that are legal in non-unicode mode and would throw
 * under it.
 */
function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

function isRenderableImage(value: string): boolean {
  return value !== '' && ImageRef.safeParse(value).success;
}

/**
 * Builds a dictionary from the parsed export. Bad rows are collected
 * rather than thrown on, matching how `normalizeRows` treats bad offers:
 * a dictionary of 352 usable marks is worth more than an exception over
 * the two blank rows the export happens to contain.
 *
 * Accepts the raw JSON text or an already-parsed payload.
 */
export function parseLabelDictionary(source: string | unknown): LabelDictionaryResult {
  let payload: unknown = source;
  if (typeof source === 'string') {
    try {
      payload = JSON.parse(source);
    } catch (error) {
      return {
        dictionary: EMPTY_LABEL_DICTIONARY,
        issues: [{ rowIndex: -1, labelId: null, reason: `unparseable JSON: ${String(error)}` }],
      };
    }
  }

  if (!Array.isArray(payload)) {
    return {
      dictionary: EMPTY_LABEL_DICTIONARY,
      issues: [{ rowIndex: -1, labelId: null, reason: 'expected an array of label rows' }],
    };
  }

  const entries: LabelDefinition[] = [];
  const byId = new Map<string, LabelDefinition>();
  const issues: LabelDictionaryIssue[] = [];

  payload.forEach((raw: unknown, rowIndex) => {
    if (!raw || typeof raw !== 'object') {
      issues.push({ rowIndex, labelId: null, reason: 'row is not an object' });
      return;
    }
    const row = raw as RawLabelRow;

    const id = readString(row, 'id', 'ID');
    const patternText = readString(row, 'pattern', 'Pattern');

    if (patternText === '') {
      // No pattern means nothing can ever select this mark. Two rows in
      // the shipped export are blank placeholders of exactly this shape.
      issues.push({ rowIndex, labelId: id || null, reason: 'empty pattern, row unusable' });
      return;
    }
    if (id === '') {
      issues.push({ rowIndex, labelId: null, reason: 'missing id' });
      return;
    }

    const pattern = compilePattern(patternText);
    if (!pattern) {
      issues.push({ rowIndex, labelId: id, reason: `invalid regex: ${patternText}` });
      return;
    }

    const rawImage = readString(row, 'positive_image', 'Positive Image URL');
    const rawImageOnDark = readString(row, 'negative_image', 'Negative Image URL');
    if (rawImage !== '' && !isRenderableImage(rawImage)) {
      issues.push({ rowIndex, labelId: id, reason: `unusable image URL: ${rawImage}` });
    }

    const definition: LabelDefinition = {
      id,
      title: readString(row, 'title', 'Title (optional)') || id,
      link: readString(row, 'link', 'Link (optional)') || null,
      pattern,
      image: isRenderableImage(rawImage) ? rawImage : null,
      imageOnDark: isRenderableImage(rawImageOnDark) ? rawImageOnDark : null,
      kind: KIND_BY_ID[id] ?? 'custom',
    };

    // Ids repeat in the export — the same mark re-uploaded with fresh
    // artwork, or a variant pattern filed under its parent's id. Both
    // definitions stay matchable (the variant pattern is real coverage);
    // only the id lookup has to pick one, and it picks the first.
    if (byId.has(id)) {
      issues.push({ rowIndex, labelId: id, reason: 'duplicate id, first definition kept for lookup' });
    } else {
      byId.set(id, definition);
    }
    entries.push(definition);
  });

  return { dictionary: { entries, byId }, issues };
}

/**
 * Feeds pad label text with markup whitespace far more often than they
 * get the word wrong, and every pattern is anchored, so a stray newline
 * is the difference between a mark and no mark.
 */
function normalizeCandidate(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Per-retailer wording for a mark the dictionary already knows. The
 * dictionary's patterns are exact-match, and every retailer spells the
 * same certification differently — nemlig writes "Øko (dansk)" and
 * "Nøglehulsmærket" where the dictionary has "økologi" and "nøglehul".
 * Rather than loosen the patterns (which would make "Rocky Road" match
 * the Rocky brand), each retailer declares its own wording.
 *
 * Keys are matched case-insensitively after whitespace normalisation.
 * Values are dictionary ids; an id that is not in the dictionary is
 * ignored, so an alias file cannot invent a mark.
 */
export type LabelAliases = Record<string, string>;

function lookupAlias(
  dictionary: LabelDictionary,
  aliases: LabelAliases | undefined,
  text: string,
): LabelDefinition | null {
  if (!aliases) return null;
  const wanted = text.toLowerCase();
  for (const [alias, id] of Object.entries(aliases)) {
    if (alias.toLowerCase() === wanted) return dictionary.byId.get(id) ?? null;
  }
  return null;
}

/**
 * The single best mark for one candidate string, or null.
 *
 * A retailer alias wins over a pattern match. The alias is a deliberate
 * statement about this retailer's wording; the pattern is a general
 * guess, and where they disagree the specific one should carry.
 */
export function matchLabel(
  dictionary: LabelDictionary,
  candidate: string,
  aliases?: LabelAliases,
): LabelDefinition | null {
  const text = normalizeCandidate(candidate);
  if (text === '') return null;

  const aliased = lookupAlias(dictionary, aliases, text);
  if (aliased) return aliased;

  for (const entry of dictionary.entries) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

/**
 * Resolves many candidates at once, de-duplicated by label id and in the
 * order the candidates were supplied — a feed listing "økologi" twice
 * should not print the Ø-mark twice.
 *
 * Pass the strings a feed actually nominates as labels (a `labels`,
 * `badges` or `marks` column). Do not pass product names or descriptions:
 * the patterns are exact-match by construction and prose will simply
 * never hit, which looks like a broken dictionary rather than a misuse.
 */
export function matchLabels(
  dictionary: LabelDictionary,
  candidates: Iterable<string>,
  aliases?: LabelAliases,
): LabelDefinition[] {
  const found: LabelDefinition[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const entry = matchLabel(dictionary, candidate, aliases);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      found.push(entry);
    }
  }
  return found;
}

export function toOfferLabel(definition: LabelDefinition): OfferLabel {
  return {
    kind: definition.kind,
    text: definition.title,
    image: definition.image,
    imageOnDark: definition.imageOnDark,
  };
}

/**
 * The form a `FieldMapping.labels` hook wants. Unmatched candidates are
 * kept as plain text labels rather than dropped — a retailer's own
 * "Nyhed" badge is still worth printing even though no logo is
 * registered for it, and silently losing feed content is the one
 * failure mode that is invisible in the finished catalog.
 */
export function resolveLabels(
  dictionary: LabelDictionary,
  candidates: Iterable<string>,
  aliases?: LabelAliases,
): OfferLabel[] {
  const labels: OfferLabel[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const text = normalizeCandidate(candidate);
    if (text === '') continue;

    const entry = matchLabel(dictionary, text, aliases);
    const key = entry ? `id:${entry.id}` : `text:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    labels.push(entry ? toOfferLabel(entry) : { kind: 'custom', text, image: null, imageOnDark: null });
  }

  return labels;
}
