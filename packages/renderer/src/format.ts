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
