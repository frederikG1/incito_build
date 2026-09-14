/**
 * Leaflet price typography splits kroner from øre and raises the øre —
 * "12,⁹⁵". Returning the parts rather than a formatted string lets the
 * tile style them independently, which is the entire visual signature of
 * a discount price.
 */
export function splitPrice(value: number): { major: string; minor: string } {
  const rounded = Math.round(value * 100);
  const major = Math.floor(rounded / 100);
  const minor = rounded % 100;
  return { major: String(major), minor: String(minor).padStart(2, '0') };
}

export function formatPrice(value: number, currency = 'DKK'): string {
  const locale = currency === 'DKK' ? 'da-DK' : 'en-GB';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatQuantity(size: number | null, unit: string, pieceCount: number): string {
  const parts: string[] = [];
  if (pieceCount > 1) parts.push(`${pieceCount} ×`);
  if (size !== null) {
    const nice = Number.isInteger(size) ? String(size) : size.toFixed(1).replace('.', ',');
    parts.push(`${nice} ${unit}`);
  } else if (pieceCount > 1) {
    parts.push('stk.');
  }
  return parts.join(' ');
}

export function formatValidity(from: string, to: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

/**
 * A section heading split into the two faces it is set in.
 *
 * SuperBrugsen prints "Kronemarked" as "Krone" in the heavy grotesk
 * followed by "marked" in a red marker script, and it is the single
 * most recognisable thing about its section headings. The chain splits
 * a compound word; a heading taken from a category name has no compound
 * to split, but it almost always has a conjunction — "Vin og spiritus",
 * "Brød og mejeri", "Frugt, grønt og blomster" — and breaking there
 * produces the same two-face line out of the feed's own words.
 *
 * The conjunction travels with the TAIL, because that is where the
 * reference puts the weight: the grotesk states the subject and the
 * script qualifies it. A heading with no conjunction is returned whole
 * in the grotesk rather than split at an arbitrary word, which is what
 * "Bolig" and "Elektronik" want.
 */
export function splitHeading(title: string): { head: string; tail: string } {
  const trimmed = title.trim();
  // Danish "og"/"&", and the "eller" that a few category names carry.
  // Anchored to whole words so "Bolig" is not cut after "Bol".
  const match = /^(.*?\S)\s+((?:og|eller|&)\s+\S.*)$/i.exec(trimmed);
  if (!match) return { head: trimmed, tail: '' };
  return { head: match[1]!, tail: match[2]! };
}
