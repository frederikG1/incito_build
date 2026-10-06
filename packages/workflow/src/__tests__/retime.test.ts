import { describe, expect, it } from 'vitest';
import { retimeDates, staleDates } from '../print.js';

const week40 = { year: 2026, week: 40 }; // 28. sep – 4. okt

describe('retimeDates', () => {
  it('moves a span by whole weeks, so the weekdays stay', () => {
    const line = 'Gælder fra fredag d. 18. september til torsdag d. 24. september';
    const out = retimeDates(line, week40)!;
    // Fri 25 sep is three days from Monday 28 sep; Fri 2 okt four.
    expect(out).toBe('Gælder fra fredag d. 25. september til torsdag d. 1. oktober');
    expect(staleDates(out, week40)).toBeNull();
  });

  it('keeps numeric dates numeric', () => {
    expect(retimeDates('Tilbud 18/9–24/9', week40)).toBe('Tilbud 25/9–1/10');
  });

  it('keeps a capitalised month capitalised', () => {
    expect(retimeDates('Fra 11. September', week40)).toBe('Fra 25. September');
    expect(retimeDates('Fra 11. SEPTEMBER til 4. Oktober', { year: 2026, week: 43 })).toBe('Fra 16. OKTOBER til 8. November');
  });

  it('leaves a line that is already this week alone', () => {
    expect(retimeDates('Gælder 28. september – 4. oktober', week40)).toBeNull();
    expect(retimeDates('Ingen datoer her', week40)).toBeNull();
  });
});
