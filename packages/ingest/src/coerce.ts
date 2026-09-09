import type { Quantity } from '@incitio/schema';

/**
 * Feeds quote prices as "12,95", "12.95", "kr. 12,95" or "1.299,00".
 * Danish feeds use comma as the decimal separator and dot as the
 * thousands separator, which is the exact inverse of what parseFloat
 * assumes — so both separators are resolved explicitly rather than
 * stripped, or "1.299" silently becomes 1.299 instead of 1299.
 */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[^\d,.-]/g, '').trim();
  if (cleaned === '') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised: string;

  if (lastComma > lastDot) {
    // Comma is the decimal separator: dots are thousands separators.
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalised = cleaned.replace(/,/g, '');
  } else {
    normalised = cleaned;
  }

  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : null;
}

const UNIT_ALIASES: Record<string, Quantity['unit']> = {
  kg: 'kg', kilo: 'kg', kilogram: 'kg',
  g: 'g', gr: 'g', gram: 'g',
  l: 'l', ltr: 'l', liter: 'l', litre: 'l',
  ml: 'ml', cl: 'ml',
  stk: 'pcs', pcs: 'pcs', st: 'pcs', pk: 'pack', pack: 'pack', pakke: 'pack',
  m: 'm', meter: 'm',
};

/**
 * Pulls size and unit out of free-text quantity strings — "0,5 l",
 * "2 x 500 g", "500g", "3 stk." The multiplier form is common in grocery
 * feeds and its piece count matters for the comparison price, so it is
 * captured rather than discarded.
 */
export function parseQuantity(raw: unknown): Quantity {
  const fallback: Quantity = { size: null, unit: 'pcs', pieceCount: 1 };
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;

  const text = raw.toLowerCase().trim();

  const multi = text.match(/^(\d+)\s*[x×]\s*(.+)$/);
  if (multi?.[1] && multi[2]) {
    const inner = parseQuantity(multi[2]);
    return { ...inner, pieceCount: Number.parseInt(multi[1], 10) };
  }

  const match = text.match(/(\d+(?:[.,]\d+)?)\s*([a-zæøå]+)/);
  if (!match?.[1] || !match[2]) return fallback;

  const size = parsePrice(match[1]);
  const unit = UNIT_ALIASES[match[2].replace(/\.$/, '')];
  if (size === null || !unit) return fallback;

  // "3 stk." is three items, not a measurement of size 3 — a count belongs
  // in pieceCount, which is what the unit-price maths divides by.
  if (unit === 'pcs') {
    return { size: null, unit: 'pcs', pieceCount: Math.max(1, Math.round(size)) };
  }

  // Centilitres are stored as millilitres so comparison maths has one scale.
  if (match[2] === 'cl') return { size: size * 10, unit: 'ml', pieceCount: 1 };
  return { size, unit, pieceCount: 1 };
}

/**
 * Accepts ISO, Danish dd-mm-yyyy / dd.mm.yyyy, and epoch millis; returns
 * a plain ISO date. Ambiguous US-style mm/dd input is NOT guessed at —
 * it returns null so the mapping config has to state the format.
 */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return text.slice(0, 10);

  // Compact ISO basic format, e.g. "20260907". Guarded on a plausible
  // year so an 8-digit product code is not silently read as a date.
  const compact = text.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (compact?.[1] && compact[2] && compact[3]) {
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
  }

  const dk = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (dk?.[1] && dk[2] && dk[3]) {
    const day = dk[1].padStart(2, '0');
    const month = dk[2].padStart(2, '0');
    return `${dk[3]}-${month}-${day}`;
  }
  return null;
}
