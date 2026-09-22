import { describe, expect, it } from 'vitest';
import {
  CatalogDocument, coversWeek, nextWeek, weekDates, weekName, weekOf,
  weekRange, weeksInYear, weekSaid,
} from '../index.js';

describe('weekDates', () => {
  it('runs Monday to Sunday', () => {
    // Week 39 of 2026 is the week the brief names.
    expect(weekDates({ year: 2026, week: 39 })).toEqual({
      from: '2026-09-21', to: '2026-09-27',
    });
  });

  it('puts week 1 on the week holding 4 January', () => {
    // 2026 starts on a Thursday, so week 1 opens in December.
    expect(weekDates({ year: 2026, week: 1 })).toEqual({
      from: '2025-12-29', to: '2026-01-04',
    });
    // 2024 starts on a Monday, so week 1 opens on New Year's Day.
    expect(weekDates({ year: 2024, week: 1 }).from).toBe('2024-01-01');
  });
});

describe('weekOf', () => {
  it('reads the week back off a day in it', () => {
    expect(weekOf(new Date('2026-09-22T00:00:00Z'))).toEqual({ year: 2026, week: 39 });
  });

  it('gives December days the following year when the week is week 1', () => {
    expect(weekOf(new Date('2025-12-30T00:00:00Z'))).toEqual({ year: 2026, week: 1 });
  });

  it('agrees with weekDates for every week of a long year', () => {
    for (let week = 1; week <= weeksInYear(2026); week += 1) {
      const { from, to } = weekDates({ year: 2026, week });
      expect(weekOf(new Date(`${from}T00:00:00Z`))).toEqual({ year: 2026, week });
      expect(weekOf(new Date(`${to}T00:00:00Z`))).toEqual({ year: 2026, week });
    }
  });
});

describe('weeksInYear', () => {
  it('knows the long years', () => {
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2020)).toBe(53);
    expect(weeksInYear(2025)).toBe(52);
  });
});

describe('nextWeek', () => {
  it('wraps past the last week of the year', () => {
    expect(nextWeek({ year: 2026, week: 53 })).toEqual({ year: 2027, week: 1 });
    expect(nextWeek({ year: 2025, week: 52 })).toEqual({ year: 2026, week: 1 });
    expect(nextWeek({ year: 2026, week: 39 })).toEqual({ year: 2026, week: 40 });
  });
});

describe('weekRange', () => {
  it('says the month once when both ends share it', () => {
    expect(weekRange({ year: 2026, week: 39 })).toBe('21.–27. september');
  });

  it('says both months when the week straddles them', () => {
    expect(weekRange({ year: 2026, week: 40 })).toBe('28. september – 4. oktober');
  });

  it('says the years when the week straddles those', () => {
    expect(weekRange({ year: 2026, week: 1 }))
      .toBe('29. december 2025 – 4. januar 2026');
  });
});

describe('weekSaid and weekName', () => {
  it('are what the toolbar and the picker show', () => {
    expect(weekSaid({ year: 2026, week: 39 })).toBe('uge 39 · gælder 21.–27. september');
    expect(weekName('SuperBrugsen', { year: 2026, week: 39 }))
      .toBe('SuperBrugsen · uge 39');
  });
});

describe('coversWeek', () => {
  const week = { year: 2026, week: 39 };

  it('takes anything that overlaps the week', () => {
    // Thursday to Wednesday, which is how a Danish grocery week runs.
    expect(coversWeek({ validFrom: '2026-09-24', validTo: '2026-09-30' }, week)).toBe(true);
    // A fortnight around it.
    expect(coversWeek({ validFrom: '2026-09-14', validTo: '2026-10-04' }, week)).toBe(true);
    // One day, the Sunday.
    expect(coversWeek({ validFrom: '2026-09-27', validTo: '2026-09-27' }, week)).toBe(true);
  });

  it('leaves out last week and next week', () => {
    expect(coversWeek({ validFrom: '2026-09-14', validTo: '2026-09-20' }, week)).toBe(false);
    expect(coversWeek({ validFrom: '2026-09-28', validTo: '2026-10-04' }, week)).toBe(false);
  });
});

describe('CatalogDocument.week', () => {
  const base = {
    id: 'c1',
    schemaVersion: 2 as const,
    name: 'avis',
    brandId: 'superbrugsen',
    pages: [],
    createdAt: '2026-09-22T00:00:00Z',
    updatedAt: '2026-09-22T00:00:00Z',
  };

  it('is null on a catalogue saved before anyone asked', () => {
    expect(CatalogDocument.parse(base).week).toBeNull();
  });

  it('survives a round trip', () => {
    const parsed = CatalogDocument.parse({ ...base, week: { year: 2026, week: 39 } });
    expect(parsed.week).toEqual({ year: 2026, week: 39 });
  });
});
