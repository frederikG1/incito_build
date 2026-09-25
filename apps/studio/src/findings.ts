import { freeSlots } from './grid.js';
import { isImagePage, weekDates } from '@incitio/schema';
import { departmentOf } from '@incitio/compose';
import type { Brand, CatalogDocument, CatalogWeek, Offer } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { OUT_OF_PROPORTION } from './cluster-layout.js';

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

export interface Finding {
  /** Stable across re-reads, so the list does not reshuffle under the pointer. */
  id: string;
  /** What kind of thing is wrong, for grouping and for the icon. */
  kind: FindingKind;
  /** The sentence the editor reads. Danish, and about the page, not the code. */
  said: string;
  /** Where to go. Null on a finding about the whole book. */
  pageId: string | null;
  pageNumber: number | null;
  /** The tile to select on arrival, when the finding is about one. */
  offerId: string | null;
  /**
   * Whether this stops a print or is worth a look.
   *
   * Two levels and not five. The question the list answers is "can I
   * send this to print", and a scale invites an argument about whether
   * something is a 3 or a 4 instead of answering it.
   */
  weight: 'stop' | 'se';
}

export const FINDING_KINDS = [
  'billede', 'plads', 'tekst', 'pris', 'klynge', 'ark', 'uge', 'skabelon', 'regler',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Newest complaints first is wrong here; severity first is what gets fixed. */
export function bySeverity(a: Finding, b: Finding): number {
  if (a.weight !== b.weight) return a.weight === 'stop' ? -1 : 1;
  return (a.pageNumber ?? 99) - (b.pageNumber ?? 99);
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

/* ------------------------------------------------------ the measured half */

/** A rectangle, as the browser hands one over. */
interface Box { left: number; top: number; right: number; bottom: number }

/** The visible artwork inside an `object-fit: contain` box. */
function painted(img: HTMLImageElement): Box {
  const r = img.getBoundingClientRect();
  // A `cover` image fills its box and is cropped to it by design, so
  // the box IS the painted area.
  if (getComputedStyle(img).objectFit === 'cover') return r;
  if (!img.naturalWidth || !img.naturalHeight) return r;
  const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  return {
    left: r.left + (r.width - w) / 2,
    right: r.right - (r.width - w) / 2,
    top: r.top + (r.height - h) / 2,
    bottom: r.bottom - (r.height - h) / 2,
  };
}

function over(a: Box, b: Box): { wide: number; high: number } {
  return {
    wide: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    high: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}

/** Which product a node belongs to, and what that product is called. */
function ownerOf(node: Element): { offerId: string | null; name: string } {
  const slot = node.closest('[data-offer-id]') as HTMLElement | null;
  const tile = node.closest('.tile');
  const name = tile?.querySelector('.tile__name')?.textContent?.trim() ?? '';
  return { offerId: slot?.dataset['offerId'] ?? null, name };
}

const WORDS = '.tile__name, .tile__description, .tile__quantity, .tile__meta, .tile__brand';

/**
 * What the rendered pages are doing wrong, measured.
 *
 * The same rules `npm run check` runs in Chromium, run against the
 * pages already on screen — because they are the same pages. A checker
 * that lives in a terminal is a checker somebody runs on Friday; this
 * is the same measurement standing next to the sheet it is about.
 *
 * Takes the root to read from so it can be pointed at a fragment in a
 * test as easily as at the studio.
 */
export function measureFindings(
  root: ParentNode,
  pageIds: string[],
  /*
   * The clusters nobody has positioned — no model run, no hand
   * correction. Their sizes are whatever `object-fit: contain` made
   * of the photographs, and that is worth saying; a cluster somebody
   * DID place is theirs and gets left alone.
   */
  untouched: Set<string> = new Set(),
): Finding[] {
  const found: Finding[] = [];
  const sheets = [...root.querySelectorAll('.page')];

  sheets.forEach((el, index) => {
    const number = index + 1;
    const at = {
      pageId: (el as HTMLElement).dataset['pageId'] ?? pageIds[index] ?? null,
      pageNumber: number,
    };
    const bounds = el.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;

    /*
     * Artwork past the paper's edge.
     *
     * Always a defect and always cut off in print — as opposed to
     * artwork past its own CELL, which is the design: every tile's
     * picture is licensed to overrun its cell, and measuring that
     * would report the look of the chain as a fault. See the same
     * split in `scripts/check-render.ts`.
     */
    for (const node of el.querySelectorAll('.tile__media img')) {
      const img = node as HTMLImageElement;
      if (!img.naturalWidth) continue;
      const a = painted(img);
      const off = Math.max(
        bounds.left - a.left, a.right - bounds.right,
        bounds.top - a.top, a.bottom - bounds.bottom,
      );
      if (off > 1) {
        const who = ownerOf(img);
        found.push({
          id: `${at.pageId}:${who.offerId}:ud-over-arket`,
          kind: 'ark',
          said: `Side ${number}: ${who.name || 'en vare'} rager ${Math.round(off)}px ud over arket`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    /*
     * A product painted over somebody's words.
     *
     * The rule the overrun exists to respect, stated as the only thing
     * that can be measured. The words print on top, so a collision is
     * never a disappearance — it is a product name read through a
     * photograph, which is worse, because it looks deliberate.
     */
    const type = [...el.querySelectorAll(WORDS)]
      .map((word) => ({ word, box: word.getBoundingClientRect() }))
      .filter((entry) => entry.box.width > 1 && entry.box.height > 1);

    for (const node of el.querySelectorAll('.tile__media img')) {
      const img = node as HTMLImageElement;
      if (!img.naturalWidth) continue;
      const a = painted(img);
      for (const { word, box } of type) {
        const hit = over(a, box);
        // A pixel of touching is rounding; a third of a line is ink.
        if (hit.wide > 1 && hit.high > Math.min(4, box.height / 3)) {
          const who = ownerOf(img);
          found.push({
            id: `${at.pageId}:${who.offerId}:over-teksten`,
            kind: 'ark',
            said: `Side ${number}: et billede dækker `
              + `"${(word.textContent ?? '').trim().slice(0, 28)}"`,
            ...at,
            offerId: who.offerId,
            weight: 'stop',
          });
          break;
        }
      }
    }

    /*
     * The price mark is SUPPOSED to overlap the product. It must never
     * overlap the product's NAME, which is the one thing a shopper has
     * to be able to read next to the number.
     */
    for (const tile of el.querySelectorAll('.tile')) {
      const mark = tile.querySelector('.price');
      const label = tile.querySelector('.tile__name');
      if (!mark || !label) continue;
      const hit = over(mark.getBoundingClientRect(), label.getBoundingClientRect());
      if (hit.wide > 0 && hit.high > 0) {
        const who = ownerOf(tile);
        found.push({
          id: `${at.pageId}:${who.offerId}:pris-over-navn`,
          kind: 'pris',
          said: `Side ${number}: prisen dækker navnet på ${who.name || 'en vare'}`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    // Half a line of type, and half a promo chip.
    for (const words of el.querySelectorAll('.tile__words')) {
      const past = words.scrollHeight - words.clientHeight;
      if (past > 2) {
        const who = ownerOf(words);
        found.push({
          id: `${at.pageId}:${who.offerId}:tekst-klippet`,
          kind: 'tekst',
          said: `Side ${number}: teksten er klippet af på ${who.name || 'en vare'} (${past}px)`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }
    for (const tags of el.querySelectorAll('.tile__tags')) {
      if (tags.scrollHeight - tags.clientHeight > 2) {
        const who = ownerOf(tags);
        found.push({
          id: `${at.pageId}:${who.offerId}:maerke-klippet`,
          kind: 'tekst',
          said: `Side ${number}: et mærke er klippet af på ${who.name || 'en vare'}`,
          ...at,
          offerId: who.offerId,
          weight: 'se',
        });
      }
    }

    /*
     * A text block past the foot of its own tile prints its last line
     * across the offer below it. The block no longer clips — the price
     * mark lives in it and leans out of it — so this is the guard that
     * replaced the clip.
     */
    for (const info of el.querySelectorAll('.tile__info')) {
      const tile = info.closest('.tile');
      if (!tile) continue;
      const past = info.getBoundingClientRect().bottom - tile.getBoundingClientRect().bottom;
      if (past > 2) {
        const who = ownerOf(info);
        found.push({
          id: `${at.pageId}:${who.offerId}:tekst-under-flisen`,
          kind: 'tekst',
          said: `Side ${number}: teksten løber ${Math.round(past)}px ud under ${who.name || 'flisen'}`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    /*
     * Two products of one cluster standing on top of each other.
     *
     * `reviewCluster` says this about an arrangement the moment it is
     * read — and then the editor drags something and nobody asks
     * again. Measured off the drawn cutouts it is true of the tile as
     * it stands, which is the only version that gets printed.
     */
    for (const tile of el.querySelectorAll('.tile')) {
      const pack = [...tile.querySelectorAll('.tile__pack img')] as HTMLImageElement[];
      if (pack.length < 2) continue;
      const boxes = pack.filter((img) => img.naturalWidth).map(painted);

      /*
       * A pack whose sizes are the photographs' own.
       *
       * Only for a tile NOBODY has positioned — see `untouched`. Left
       * to the stylesheet, every product in a cluster gets one equal
       * grid track and `object-fit: contain` fits it to that box, so
       * what decides how big a product looks is the shape of the
       * photograph and nothing else. In a wide cell the heights bind
       * and a nearly square packshot comes out three times as wide as
       * the cartons beside it; in a narrow one the widths bind and a
       * flat pack comes out a third of their height. Both read as a
       * statement about the products, and neither is one.
       *
       * Said once per tile, not once per product: the answer is the
       * same for all of them — stand the cluster up, or size them by
       * hand — and four lines saying it would push the rest of the
       * list off the screen.
       *
       * Never for a cluster a model or a person has placed. There the
       * sizes were chosen, honest differences are the point, and
       * `reviewCluster` already says so when they go out of
       * proportion.
       */
      const who = ownerOf(tile);
      if (who.offerId && untouched.has(who.offerId) && boxes.length > 1) {
        const areas = boxes.map((box) => (box.right - box.left) * (box.bottom - box.top));
        const spread = Math.max(...areas) / Math.max(1, Math.min(...areas));
        if (spread > OUT_OF_PROPORTION * OUT_OF_PROPORTION) {
          found.push({
            id: `${at.pageId}:${who.offerId}:pakkestørrelser`,
            kind: 'klynge',
            said: `Side ${number}: varerne i ${who.name || 'klyngen'} er `
              + `${spread.toFixed(1)}× fra hinanden i størrelse — sat efter fotografierne,`
              + ' ikke efter varerne',
            ...at,
            offerId: who.offerId,
            weight: 'se',
          });
        }
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const hit = over(boxes[i]!, boxes[j]!);
          if (hit.wide <= 0 || hit.high <= 0) continue;
          const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);
          const smaller = Math.min(area(boxes[i]!), area(boxes[j]!));
          const share = smaller > 0 ? (hit.wide * hit.high) / smaller : 0;
          // The same threshold `reviewCluster` uses: products in a
          // composed group are meant to overlap a little.
          if (share > 0.15) {
            found.push({
              id: `${at.pageId}:${who.offerId}:klynge-${i}-${j}`,
              kind: 'klynge',
              said: `Side ${number}: vare ${i + 1} dækker ${Math.round(share * 100)} % `
                + `af vare ${j + 1} i ${who.name || 'klyngen'}`,
              ...at,
              offerId: who.offerId,
              weight: 'se',
            });
          }
        }
      }
    }
  });

  /*
   * One finding per id. The same tile can trip the same rule against
   * several words, and a list that says it four times is a list nobody
   * reads to the bottom of.
   */
  const once = new Map<string, Finding>();
  for (const finding of found) if (!once.has(finding.id)) once.set(finding.id, finding);
  return [...once.values()].sort(bySeverity);
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

function weekSpan(week: CatalogWeek): string {
  const { from, to } = weekDates(week);
  const say = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${say(from)}–${say(to)}`;
}
