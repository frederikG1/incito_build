import { z } from 'zod';

/**
 * Which week a catalogue is for.
 *
 * The one fact the studio never asked for, and the reason fifteen saved
 * catalogues were all called "Hentet udgivelse": a leaflet is not a
 * document that happens to exist, it is week 39's paper, and almost
 * everything a person wants to know about one follows from that. The
 * name follows from it, the validity dates follow from it, and whether
 * an offer in the feed belongs in it at all follows from it.
 *
 * Stored as the ISO week rather than as two dates, because the two
 * dates ARE the week — derived by `weekDates` below — and a document
 * carrying both could be saved with a Monday that is not in week 39.
 * One fact, one field.
 *
 * ISO 8601, which is what a Danish retail calendar means by "uge 39":
 * weeks start on Monday, and week 1 is the one holding 4 January.
 */
export const CatalogWeek = z.object({
  /** The ISO week-numbering year, which is not always the calendar year. */
  year: z.number().int().min(2000).max(2100),
  week: z.number().int().min(1).max(53),
});
export type CatalogWeek = z.infer<typeof CatalogWeek>;

const DAY = 86_400_000;

/** A UTC date, so a machine in Copenhagen and one in UTC agree. */
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Monday = 1 … Sunday = 7, the way ISO counts. */
function isoDay(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/** A date as `YYYY-MM-DD`, which is what `Offer.validFrom` is. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * How many weeks an ISO year has.
 *
 * 53 when it starts on a Thursday, or on a Wednesday in a leap year.
 * Needed because "uge 53" is a real week in some years and a typo in
 * the rest, and the field has to be able to tell them apart.
 */
export function weeksInYear(year: number): 52 | 53 {
  const long = isoDay(utc(year, 1, 1)) === 4 || isoDay(utc(year, 12, 31)) === 4;
  return long ? 53 : 52;
}

/** The Monday a week starts on. */
export function weekStart(week: CatalogWeek): Date {
  // 4 January is in week 1 by definition, so the Monday of week 1 is
  // however many days before it that week's Monday falls.
  const fourth = utc(week.year, 1, 4);
  const monday = new Date(fourth.getTime() - (isoDay(fourth) - 1) * DAY);
  return new Date(monday.getTime() + (week.week - 1) * 7 * DAY);
}

/** The Monday and the Sunday, as the dates an offer is checked against. */
export function weekDates(week: CatalogWeek): { from: string; to: string } {
  const monday = weekStart(week);
  return { from: isoDate(monday), to: isoDate(new Date(monday.getTime() + 6 * DAY)) };
}

/** The ISO week a given day falls in. */
export function weekOf(date: Date): CatalogWeek {
  const day = utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  // Thursday decides the year: the week belongs to whichever year its
  // Thursday is in, which is the whole of the ISO rule in one line.
  const thursday = new Date(day.getTime() + (4 - isoDay(day)) * DAY);
  const year = thursday.getUTCFullYear();
  const first = utc(year, 1, 4);
  const firstMonday = new Date(first.getTime() - (isoDay(first) - 1) * DAY);
  return { year, week: Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * DAY)) + 1 };
}

/** The week after this one, wrapping into the next year. */
export function nextWeek(week: CatalogWeek): CatalogWeek {
  return week.week >= weeksInYear(week.year)
    ? { year: week.year + 1, week: 1 }
    : { year: week.year, week: week.week + 1 };
}

const MONTHS = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
] as const;

/**
 * The week as a person reads it — "22.–28. september".
 *
 * The month is said once when both ends share it, which is what makes
 * this short enough to sit in a toolbar. A week straddling two months
 * says both and spaces the dash, because "29. september–5. oktober"
 * reads as one date; a week straddling two years says the years, which
 * is the one case where leaving them out could mean the wrong paper.
 */
export function weekRange(week: CatalogWeek): string {
  const monday = weekStart(week);
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const day = (date: Date) => date.getUTCDate();
  const month = (date: Date) => MONTHS[date.getUTCMonth()]!;

  if (monday.getUTCFullYear() !== sunday.getUTCFullYear()) {
    return `${day(monday)}. ${month(monday)} ${monday.getUTCFullYear()} – `
      + `${day(sunday)}. ${month(sunday)} ${sunday.getUTCFullYear()}`;
  }
  if (monday.getUTCMonth() !== sunday.getUTCMonth()) {
    return `${day(monday)}. ${month(monday)} – ${day(sunday)}. ${month(sunday)}`;
  }
  return `${day(monday)}.–${day(sunday)}. ${month(sunday)}`;
}

/**
 * What the catalogue is called.
 *
 * The chain and the week, and nothing else. Fifteen saved catalogues
 * called "Hentet udgivelse" is what a name made of the machinery looks
 * like; this is the name the people who make the paper already use for
 * it, so the picker can be read without opening anything.
 */
export function weekName(brandName: string, week: CatalogWeek): string {
  return `${brandName} · uge ${week.week}`;
}

/**
 * Whether an offer is on sale during the week.
 *
 * Any overlap counts, not containment: a feed carries offers that run
 * Thursday to Wednesday and offers that run a fortnight, and a paper
 * for week 39 prints both. String comparison is exact here — both ends
 * are `YYYY-MM-DD`, which sorts as text the way it sorts as time.
 */
export function coversWeek(
  offer: { validFrom: string; validTo: string },
  week: CatalogWeek,
): boolean {
  const { from, to } = weekDates(week);
  return offer.validFrom <= to && offer.validTo >= from;
}
