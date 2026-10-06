import { isImagePage, weekDates } from '@incitio/schema';
import type { Brand, CatalogDocument, CatalogWeek, Offer } from '@incitio/schema';
import { departmentOf } from '@incitio/compose';
import { resolveTemplate } from '@incitio/brands';
import { freeSlots } from './slots.js';
import type { Finding } from './stop.js';
import { bySeverity } from './sort.js';

/**
 * What is wrong with the avis, as a line somebody can act on.
 *
 * The measurements existed already and were scattered: `npm run check`
 * knows about clipped type in a terminal, `reviewCluster` knows about
 * products covering each other at the moment a cluster is stood up,
 * `benched` knows which products never got a cell. None of them was
 * anywhere near the page they were about, so the way to find out
 * whether an avis was printable was to look through six sheets and
 * hope. This is the one list — and every line in it knows which tile
 * it means, so it can be clicked.
 */

/** The products behind a grouped offer, in the order it lists them. */
function membersOf(offer: Offer, document: CatalogDocument): Offer[] {
  return offer.members
    .map((id) => document.offers.find((entry) => entry.id === id))
    .filter((entry): entry is Offer => Boolean(entry));
}

/** What a tile is called in a list of complaints. */
function tileSaid(offer: Offer | undefined, document: CatalogDocument): string {
  if (!offer) return 'en vare';
  if (offer.members.length > 1) {
    const members = membersOf(offer, document);
    return members[0] ? `${members[0].name} m.fl.` : offer.name;
  }
  return offer.brand && !offer.name.startsWith(offer.brand)
    ? `${offer.brand} ${offer.name}`
    : offer.name;
}

/**
 * Everything the DOCUMENT itself can say is missing.
 *
 * Pure, and deliberately so: this is the half of the checklist that
 * needs no browser, runs on every keystroke for nothing, and can be
 * tested. What it cannot see is anything about how the page actually
 * came out — a price sitting on a name, a line clipped in half — and
 * that is `measureFindings` below, which reads the real rendered page.
 */
const kroner = (value: number) => (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

export function readFindings(
  document: CatalogDocument | null,
  brand: Brand | null,
  week: CatalogWeek | null,
): Finding[] {
  if (!document) return [];
  const found: Finding[] = [];
  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));

  document.pages.forEach((page, index) => {
    const number = index + 1;
    const at = { pageId: page.id, pageNumber: number };

    if (isImagePage(page)) {
      if (!page.background?.imageUrl) {
        found.push({
          id: `${page.id}:tom-billedside`,
          kind: 'billede',
          said: `Side ${number}: billedsiden har intet billede`,
          ...at,
          offerId: null,
          weight: 'stop',
        });
      }
      return;
    }

    const template = (brand ? resolveTemplate(brand, page.templateId) : null)
      ?? document.templates.find((entry) => entry.id === page.templateId);

    if (!template) {
      found.push({
        id: `${page.id}:ukendt-skabelon`,
        kind: 'skabelon',
        said: `Side ${number}: skabelonen "${page.templateId}" findes ikke`,
        ...at,
        offerId: null,
        weight: 'stop',
      });
      return;
    }

    /*
     * A cell with nothing in it.
     *
     * Counted off the TEMPLATE rather than off the placements, because
     * that is the hole a reader sees: a six-up layout with five offers
     * on it prints a grey rectangle saying "Tom plads", and nothing in
     * the document itself is wrong.
     */
    // Filled, or — on a page picture — still showing what was printed.
    const empty = freeSlots(page, template);
    if (empty.length > 0) {
      found.push({
        id: `${page.id}:tomme-pladser`,
        kind: 'plads',
        said: `Side ${number}: ${empty.length === 1 ? 'én plads er tom' : `${empty.length} pladser er tomme`}`,
        ...at,
        offerId: null,
        weight: 'stop',
      });
    }

    /*
     * Words on the page that name another week's dates.
     *
     * The band "Gælder fra fredag d. 18. september" is typed once and
     * then carried from week to week with the design — which is exactly
     * what makes it the easiest thing on the page to print wrong.
     */
    if (week) {
      const lines = [page.title, page.subtitle, ...page.notes.map((note) => note.text)];
      for (const line of lines) {
        const stale = staleDates(line, week);
        if (!stale) continue;
        found.push({
          id: `${page.id}:dato:${line.slice(0, 24)}`,
          kind: 'uge',
          said: `Side ${number}: "${line.replace(/\s+/g, ' ').trim().slice(0, 40)}…" nævner ${stale} — ugen er ${weekSpan(week)}`,
          ...at,
          offerId: null,
          weight: 'stop',
        });
      }
    }

    // A page whose headline is printed artwork has one, even with no title.
    const drawnHeadline = page.decorations.some((decor) => decor.rect);
    // A page read off a publication has the headline it was printed with — often none.
    const published = Boolean(page.incito) || page.templateId.startsWith('pub/');
    if (!page.title.trim() && !drawnHeadline && !published) {
      found.push({
        id: `${page.id}:uden-overskrift`,
        kind: 'tekst',
        said: `Side ${number}: ingen overskrift`,
        ...at,
        offerId: null,
        weight: 'se',
      });
    }

    for (const placement of page.placements) {
      const offer = offers.get(placement.offerId);
      if (!offer) {
        found.push({
          id: `${page.id}:${placement.offerId}:ukendt`,
          kind: 'plads',
          said: `Side ${number}: en plads peger på en vare avisen ikke har`,
          ...at,
          offerId: null,
          weight: 'stop',
        });
        continue;
      }

      /*
       * No photograph.
       *
       * The single most common reason a page is not printable, and the
       * one the studio was worst at saying: the tile renders, it is
       * simply empty where the product should be. A cluster is asked
       * about member by member — one of six missing is still a hole.
       */
      const members = offer.members.length > 1 ? membersOf(offer, document) : [offer];
      const blind = members.filter((member) => !member.imageUrl);
      if (blind.length > 0) {
        found.push({
          id: `${page.id}:${offer.id}:uden-billede`,
          kind: 'billede',
          said: members.length > 1
            ? `Side ${number}: ${tileSaid(offer, document)} mangler ${blind.length} af ${members.length} billeder`
            : `Side ${number}: ${tileSaid(offer, document)} har intet billede`,
          ...at,
          offerId: offer.id,
          weight: 'stop',
        });
      }

      /*
       * The price-marking rules, as the checks a proof-reader runs.
       *
       * Goods sold by weight or volume must print a unit price, and a
       * bottle or can with a deposit must say "+ pant". Both are the
       * sort of line that is right in the feed and lost on the way to
       * the page — a hand-edited underline, a tile made by hand.
       */
      if (offer.members.length === 0) {
        const text = `${offer.description} ${offer.pack}`.toLowerCase();
        const byMeasure = ['g', 'kg', 'ml', 'l'].includes(offer.quantity.unit) && offer.quantity.size !== null;
        const saysUnit = /(kg|liter|stk|l)-?pris|pr\.?\s?(kg|l|liter|stk)/u.test(text);
        if (byMeasure && !offer.comparison && !saysUnit) {
          found.push({
            id: `${page.id}:${offer.id}:enhedspris`,
            kind: 'regler',
            said: `Side ${number}: ${tileSaid(offer, document)} mangler enhedspris (kg-/literpris)`,
            ...at,
            offerId: offer.id,
            weight: 'stop',
          });
        }
        const department = departmentOf(offer);
        const bottled = department === 'drikke'
          ? !/kaffe|kapsl|kakao|(?<![a-zæøå])te(?![a-zæøå])|bønner|instant|espresso/u.test(offer.name.toLowerCase())
          : department === 'vin' && /øl|pilsner|cider|tuborg|carlsberg|breezer|smirnoff|pepsi|cola|faxe/u.test(offer.name.toLowerCase());
        const inBottles = /\d\s*(cl|l|ml|liter)(?![a-zæøå])|flaske|dåse/u.test(`${offer.name} ${text}`.toLowerCase());
        if (bottled && inBottles && !/pant/u.test(text)) {
          found.push({
            id: `${page.id}:${offer.id}:pant`,
            kind: 'regler',
            said: `Side ${number}: ${tileSaid(offer, document)} nævner ikke pant`,
            ...at,
            offerId: offer.id,
            weight: 'se',
          });
        }
      }

      // A price corrected by hand: right now, and gone again next week unless the feed agrees.
      if (offer.corrected) {
        found.push({
          id: `${page.id}:${offer.id}:rettet-pris`,
          kind: 'pris',
          said: `Side ${number}: prisen på ${offer.name} er rettet i hånden — feedet siger ${kroner(offer.corrected.price)}`,
          ...at,
          offerId: offer.id,
          weight: 'se',
        });
      }

      // A price of nothing is a feed that did not parse, not a giveaway.
      if (offer.price <= 0) {
        found.push({
          id: `${page.id}:${offer.id}:uden-pris`,
          kind: 'pris',
          said: `Side ${number}: ${tileSaid(offer, document)} har ingen pris`,
          ...at,
          offerId: offer.id,
          weight: 'stop',
        });
      }
    }
  });

  /*
   * Products the avis carries and no page shows.
   *
   * One line about the book rather than one per product: twelve
   * findings that all say the same thing would push everything else
   * off the list. The count IS the finding.
   */
  const placed = new Set(document.pages.flatMap((page) => page.placements)
    .map((placement) => placement.offerId));
  const shown = new Set(document.offers
    .filter((offer) => placed.has(offer.id))
    .flatMap((offer) => offer.members));
  const bench = document.offers.filter(
    (offer) => !placed.has(offer.id) && !shown.has(offer.id),
  );
  if (bench.length > 0) {
    found.push({
      id: 'avis:reserve',
      kind: 'plads',
      said: `${bench.length} ${bench.length === 1 ? 'vare mangler' : 'varer mangler'} en plads`,
      pageId: null,
      pageNumber: null,
      offerId: null,
      weight: 'se',
    });
  }

  return found.sort(bySeverity);
}

/* ------------------------------------------------------------ dates */

const MONTH_NUMBERS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};
const DAY = 86_400_000;

/** Every day-and-month a line of Danish names, as dates in the week's year. */
export function datesIn(text: string, year: number): Date[] {
  const found: Date[] = [];
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/gu)) {
    found.push(new Date(Date.UTC(year, MONTH_NUMBERS[match[2]!]! - 1, Number(match[1]))));
  }
  for (const match of lower.matchAll(/(?<![\d.])(\d{1,2})[./](\d{1,2})(?![\d./])/gu)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      found.push(new Date(Date.UTC(year, month - 1, day)));
    }
  }
  return found;
}

/**
 * The dates a line names, when they cannot be this week's.
 *
 * Two or more dates are read as a span ("fra 18. til 24. september")
 * and may overlap the week anywhere; a lone date must fall within a few
 * days of it, since chains start their week on a Wednesday or a Friday
 * as often as on a Monday. Returns the words to say, or null.
 */
export function staleDates(text: string, week: CatalogWeek): string | null {
  const dates = datesIn(text, week.year);
  if (dates.length === 0) return null;
  const { from, to } = weekDates(week);
  const start = Date.parse(`${from}T00:00:00Z`) - 3 * DAY;
  const end = Date.parse(`${to}T00:00:00Z`) + 3 * DAY;
  const times = dates.map((date) => date.getTime()).sort((a, b) => a - b);
  const low = times[0]!;
  const high = times[times.length - 1]!;
  const fine = times.length > 1 ? low <= end && high >= start : low >= start && low <= end;
  if (fine) return null;
  const say = (time: number) => new Date(time).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return times.length > 1 ? `${say(low)}–${say(high)}` : say(low);
}

/**
 * The line moved to this week: every date it names shifted by the same
 * whole number of weeks, so "fredag d. 18. september" stays a Friday and
 * a span stays as long. The words around the dates are not touched.
 * Null when there is nothing to move — the line is already this week's,
 * or names no date.
 */
export function retimeDates(text: string, week: CatalogWeek): string | null {
  if (!staleDates(text, week)) return null;
  const dates = datesIn(text, week.year).map((date) => date.getTime()).sort((a, b) => a - b);
  const { from, to } = weekDates(week);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const low = dates[0]!;
  const high = dates[dates.length - 1]!;
  /*
   * The shift that starts the line nearest the week's Monday. Chains
   * start their week on a Thursday, a Friday or a Saturday as often as
   * on the Monday, so "nearest" lands either side of it — which is why
   * the studio shows the moved line before it is applied.
   */
  const base = Math.round((start - low) / (7 * DAY));
  const shift = [base, base + 1, base - 1].find((n) => {
    const a = low + n * 7 * DAY;
    const b = high + n * 7 * DAY;
    return dates.length > 1 ? a <= end && b >= start : a >= start - 3 * DAY && a <= end + 3 * DAY;
  });
  if (shift === undefined || shift === 0) return null;
  const moved = (day: number, month: number) => {
    const date = new Date(Date.UTC(week.year, month - 1, day) + shift * 7 * DAY);
    return { day: date.getUTCDate(), month: date.getUTCMonth() + 1 };
  };
  const NAMES = Object.keys(MONTH_NUMBERS);
  let out = text.replace(
    /(\d{1,2})\.(\s*)(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/giu,
    (_whole, day: string, space: string, month: string) => {
      const to = moved(Number(day), MONTH_NUMBERS[month.toLowerCase()]!);
      const name = NAMES[to.month - 1]!;
      const cased = month[0] === month[0]!.toUpperCase()
        ? (month === month.toUpperCase() ? name.toUpperCase() : name[0]!.toUpperCase() + name.slice(1))
        : name;
      return `${to.day}.${space}${cased}`;
    },
  );
  out = out.replace(/(?<![\d.])(\d{1,2})([./])(\d{1,2})(?![\d./])/gu, (whole, day: string, sep: string, month: string) => {
    const d = Number(day);
    const m = Number(month);
    if (d < 1 || d > 31 || m < 1 || m > 12) return whole;
    const to = moved(d, m);
    return `${to.day}${sep}${to.month}`;
  });
  return out === text ? null : out;
}

function weekSpan(week: CatalogWeek): string {
  const { from, to } = weekDates(week);
  const say = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${say(from)}–${say(to)}`;
}

/**
 * Products the avis promised to carry and no page shows — `mustInclude`.
 *
 * Read off the document alone: an id the avis does not carry at all is
 * the studio's to name (it knows the week's feed); here it is skipped.
 */
export function mustFindings(document: CatalogDocument): Finding[] {
  const must = document.mustInclude ?? [];
  if (must.length === 0) return [];
  const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
  const shown = new Set<string>();
  for (const placement of document.pages.flatMap((page) => page.placements)) {
    shown.add(placement.offerId);
    for (const member of byId.get(placement.offerId)?.members ?? []) shown.add(member);
  }
  return must
    .filter((id) => !shown.has(id) && byId.has(id))
    .map((id) => ({
      id: `skalmed:${id}`,
      kind: 'skalmed' as const,
      said: `${byId.get(id)!.name} skal med, men er ikke på en side`,
      pageId: null,
      pageNumber: null,
      offerId: id,
      weight: 'stop' as const,
    }));
}

/**
 * Every check that needs only the document — what the server holds an
 * avis to before it may be published. The rendered half is `measured.ts`.
 */
export function printFindings(document: CatalogDocument, brand: Brand): Finding[] {
  return [...readFindings(document, brand, document.week ?? null), ...mustFindings(document)].sort(bySeverity);
}
