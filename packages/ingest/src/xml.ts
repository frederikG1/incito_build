/**
 * Flat XML feeds — DataFeedWatch, Google Shopping and the like.
 *
 * Faithful rather than clever: every child element becomes a string field
 * under its own tag name, nothing is renamed or coerced. What a field
 * MEANS is the FieldMapping's job, exactly as for JSON and CSV. Nested
 * records throw instead of being flattened: a reader that guessed would
 * hand the mapping fields that are not in the file.
 */

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** The record tag: the element that repeats most often directly under the root. */
function guessItemTag(xml: string): string | null {
  const counts = new Map<string, number>();
  for (const match of xml.matchAll(/<([a-zA-Z][\w:.-]*)\b[^>]*>/g)) {
    counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  for (const tag of ['product', 'item', 'entry', 'offer', 'record', 'row']) {
    if ((counts.get(tag) ?? 0) > 0) return tag;
  }
  return null;
}

export function parseXml(xml: string, itemTag?: string): Record<string, string>[] {
  const tag = itemTag ?? guessItemTag(xml);
  if (!tag) return [];
  const itemRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const fieldRe = /<([a-zA-Z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>|<([a-zA-Z][\w:.-]*)\b[^>]*\/>/g;
  const records: Record<string, string>[] = [];
  for (const match of xml.matchAll(itemRe)) {
    const record: Record<string, string> = {};
    for (const field of match[1]!.matchAll(fieldRe)) {
      const [, name, value, empty] = field;
      if (empty) { record[empty] = ''; continue; }
      if (/<[a-zA-Z]/.test(value!.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) {
        throw new Error(`nested XML in <${name}> — this reader only handles flat records`);
      }
      record[name!] = decode(value!);
    }
    records.push(record);
  }
  return records;
}

export function looksXml(text: string): boolean {
  return text.trimStart().startsWith('<');
}
