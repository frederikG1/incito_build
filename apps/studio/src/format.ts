/**
 * Numbers, money and times as the boards print them — one spelling each.
 *
 * Godkend, Pladser and Live each had their own `kr` and `when`, and two
 * of them disagreed about how a time yesterday reads.
 */

/** A shelf price: "25,-", "37,95". */
export const kr = (value: number): string =>
  (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

/** A sum of money: "kr. 1.750.000". */
export const sum = (value: number): string => `kr. ${value.toLocaleString('da-DK')}`;

/** A count: "523.000". */
export const n = (value: number): string => value.toLocaleString('da-DK');

/** A rate: "3,2 %". */
export const pct = (value: number): string => `${(value * 100).toFixed(1).replace('.', ',')} %`;

/** "i dag 09:14", "i går 16:02", "3. sep. 11:30". */
export function when(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = then.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `i dag ${time}`;
  if (days === 1) return `i går ${time}`;
  return `${then.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${time}`;
}

/** "1 ændring", "3 ændringer". */
export const count = (value: number, one: string, many: string): string => `${value} ${value === 1 ? one : many}`;
