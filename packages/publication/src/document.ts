/**
 * A published leaflet as one of our own documents.
 *
 * The grid is READ, not guessed: every offer on a published page is a
 * rectangle with coordinates, so the lattice those rectangles sit on is
 * arithmetic — `lattice` in `@incitio/reference` is the same fitter the
 * PDF path uses, handed better evidence. No model is called here at all,
 * which is the whole point of importing from a link rather than from a
 * photograph: it costs nothing, it is exact, and it is reproducible.
 *
 * What comes out is an ordinary `CatalogDocument`. The editor, the save
 * button and the PDF path do not know a page arrived this way, and the
 * layouts travel in `document.templates` for the same reason a rebuilt
 * page's does: nobody drew them for the chain, and they describe one
 * printed sheet rather than a shape the chain uses again.
 */
import {
  type CatalogDocument, type CatalogPage, type Offer, type PageTemplate,
  type SlotRole, type TemplateSlot, validateTemplate,
} from '@incitio/schema';
import { lattice } from '@incitio/reference';
import type { Publication, PublicationOffer, PublicationPage, Rect } from './incito.js';

/** Grid names are `a`..`z`, which is also what `lattice` hands back. */
const NAMES = 'abcdefghijklmnopqrstuvwxyz';

/**
 * How far a grid may be padded out to put the offers where the sheet
 * puts them.
 *
 * A published page reserves a band at the top for its headline, and the
 * offers below it sit on a lattice of their own. Fitted alone that
 * lattice would be stretched over the whole sheet and the band would
 * vanish, so the empty tracks around the offers are added back — but a
 * page whose offers occupy a tenth of the paper would otherwise produce
 * a grid of a hundred cells, and a hundred `1fr` tracks is not a layout,
 * it is a rounding error with a stylesheet.
 */
const MAX_COLUMNS = 12;
const MAX_ROWS = 16;

/**
 * What a cell is FOR, judged against the other cells on its own page.
 *
 * Relative, never absolute, and that distinction is the whole rule. A
 * role is a statement about prominence — "this offer leads the page" —
 * and prominence only exists in comparison: on a two-by-two page every
 * cell is a quarter of the sheet and NONE of them leads it. Measured
 * against fixed shares of the paper they all cleared the same bar at
 * once, and a published page whose four offers are plainly equals came
 * back with four leads.
 *
 * `feature` is deliberately not reachable from here. It is not a size,
 * it is a chain's editorial band — SuperBrugsen prints it as a red
 * panel with inverted type — and a published page we are copying does
 * not have one. Reading a size off somebody's printed sheet must not
 * invent their furniture.
 */
function rolesFor(areas: number[]): SlotRole[] {
  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  return areas.map((area) => {
    const against = median > 0 ? area / median : 1;
    if (against >= 1.6) return 'hero';
    if (against <= 0.6) return 'compact';
    return 'standard';
  });
}

/** ISO date, n days from today. */
function isoDate(offsetDays = 0): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

/**
 * The unit price the page already prints.
 *
 * Danish leaflets set it into the fine print — "Kg-pris maks. 61,25" —
 * because the law requires it there, which makes the line the publisher's
 * own answer rather than one we compute from a weight we parsed. Read it
 * when it is stated; leave `comparison` null when it is not, and let the
 * ordinary ingest maths fill it in for feed offers.
 */
function statedComparison(text: string): Offer['comparison'] {
  const found = /(kg|liter|ltr|l)-pris[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i.exec(text);
  if (!found) return null;
  const value = Number(found[2]!.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return { value, unit: found[1]!.toLowerCase().startsWith('kg') ? 'kg' : 'l' };
}

/** The size in the fine print — "240-250 g" — as a plain number and unit. */
function statedQuantity(text: string): Offer['quantity'] {
  const found = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i.exec(text);
  if (!found) return { size: null, unit: 'pcs', pieceCount: 1 };
  const size = Number(found[1]!.replace(',', '.'));
  const unit = found[2]!.toLowerCase();
  if (!Number.isFinite(size)) return { size: null, unit: 'pcs', pieceCount: 1 };
  // Centilitres are stored as millilitres, the same way ingest does it,
  // so the two paths cannot disagree about what "50 cl" is.
  if (unit === 'cl') return { size: size * 10, unit: 'ml', pieceCount: 1 };
  return { size, unit: unit as Offer['quantity']['unit'], pieceCount: 1 };
}

/** How many items one offer covers — "4 poser", "2 stk.". */
function pieceCount(pack: string): number {
  const found = /^(\d+)\s/.exec(pack.trim());
  const count = found ? Number(found[1]) : 1;
  return Number.isInteger(count) && count > 0 && count < 100 ? count : 1;
}

export interface OfferOptions {
  validFrom?: string;
  validTo?: string;
}

/**
 * One published offer as an `Offer`.
 *
 * Exported because a caller may well want the products without the
 * pages — a published leaflet is also the tidiest product list a chain
 * has, and the studio's library shows it next to an uploaded feed.
 */
export function publicationOffer(
  offer: PublicationOffer,
  page: PublicationPage,
  options: OfferOptions = {},
): Offer {
  const fine = offer.description;
  const quantity = statedQuantity(fine);
  return {
    id: offer.id,
    name: offer.name,
    description: fine,
    brand: '',
    /*
     * The page is the category.
     *
     * A published leaflet carries no taxonomy — it carries pages, and a
     * page IS the grouping its editor chose. Calling that "uncategorised"
     * would throw away the only editorial fact in the file, and the
     * library groups by this field.
     */
    category: `Side ${page.number}`,
    price: offer.price ?? 0,
    priceFrom: false,
    prePrice: null,
    savings: null,
    savingsMax: null,
    currency: offer.currency,
    comparison: statedComparison(fine),
    quantity: { ...quantity, pieceCount: pieceCount(offer.pack) },
    pack: offer.pack,
    validFrom: options.validFrom ?? isoDate(),
    validTo: options.validTo ?? isoDate(6),
    imageUrl: offer.imageUrl,
    imagePack: [],
    labels: [],
    priority: null,
    // A published offer stands for itself. Grouping is something an
    // editor does here — see `groupOffers`.
    members: [],
  };
}

/** Empty tracks to add around a lattice so the offers sit where they print. */
function padding(
  bounds: { from: number; to: number; span: number },
  tracks: number,
  gap: number,
): { before: number; after: number } {
  const cell = ((bounds.to - bounds.from) - (tracks - 1) * gap) / tracks;
  const step = cell + gap;
  if (!(step > 0)) return { before: 0, after: 0 };
  return {
    before: Math.max(0, Math.round(bounds.from / step)),
    after: Math.max(0, Math.round((bounds.span - bounds.to) / step)),
  };
}

/** A row of `n` empty cells. */
const blankRow = (n: number) => new Array<string>(n).fill('.').join(' ');

export interface PageReading {
  number: number;
  offers: number;
  columns: number;
  rows: number;
  /** How far the worst offer edge sat from its lattice line, 0..1. */
  fit: number;
  /** Why this page carries no grid, when it does not. */
  skipped: string | null;
}

/**
 * The template one published page sits on.
 *
 * Null when the page has no offers to fit a grid to — a front cover, a
 * full-page advertisement, a recipe spread. Those become image pages
 * upstream rather than empty grids.
 */
export function pageTemplate(
  page: PublicationPage,
  id: string,
): { template: PageTemplate; order: string[]; fit: number } | null {
  if (page.offers.length === 0) return null;

  /*
   * Fitted in SHARES of the sheet, not in the publication's own points.
   *
   * Everything `lattice` is tuned against — its tolerance, its widest
   * gutter, what counts as a band — is a share of the page, because the
   * PDF reader it was written for normalises before it calls. Handed
   * raw points it still answers, and answers wrongly: on a 992pt sheet
   * the tolerance of 0.035 becomes a thirtieth of a point, so the 0.9pt
   * that separates a leaflet's bottom row from its top two is a miss,
   * and a page that is plainly two-by-three comes back as "no grid".
   */
  const rects: Rect[] = page.offers.map((offer) => ({
    x: offer.rect.x / page.width,
    y: offer.rect.y / page.height,
    w: offer.rect.w / page.width,
    h: offer.rect.h / page.height,
  }));
  const fitted = lattice(rects);
  if (!fitted) return null;

  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y0 = Math.min(...rects.map((r) => r.y));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));

  const across = padding({ from: x0, to: x1, span: 1 }, fitted.columns, fitted.gutter.x);
  const down = padding({ from: y0, to: y1, span: 1 }, fitted.rows, fitted.gutter.y);
  // Padding is a courtesy, not a requirement: past the caps it is
  // dropped entirely rather than partly, so the grid that renders is
  // either the printed proportions or the offers' own.
  const pad = (fitted.columns + across.before + across.after <= MAX_COLUMNS
    && fitted.rows + down.before + down.after <= MAX_ROWS)
    ? { across, down }
    : { across: { before: 0, after: 0 }, down: { before: 0, after: 0 } };

  const width = fitted.columns + pad.across.before + pad.across.after;
  const areas = [
    ...new Array<string>(pad.down.before).fill(blankRow(width)),
    ...fitted.areas.map((row) => [
      ...new Array<string>(pad.across.before).fill('.'),
      ...row.split(' '),
      ...new Array<string>(pad.across.after).fill('.'),
    ].join(' ')),
    ...new Array<string>(pad.down.after).fill(blankRow(width)),
  ];

  const roles = rolesFor(rects.map((rect) => rect.w * rect.h));
  const slots: TemplateSlot[] = rects.map((rect, index) => ({
    id: NAMES[index % NAMES.length]!,
    role: roles[index]!,
    bleed: 1,
  }));

  const template: PageTemplate = {
    id,
    name: `Side ${page.number} — læst fra udgivelsen`,
    areas,
    // A slot whose cell was clipped away by the lattice is not a slot.
    // It can happen when two offers land in one cell, and a template
    // that declares it fails validation rather than rendering short.
    slots: slots.filter((slot) => areas.some((row) => row.split(' ').includes(slot.id))),
  };

  const problems = validateTemplate(template);
  if (problems.length > 0) return null;

  return { template, order: slots.map((slot) => slot.id), fit: fitted.fit };
}

export interface ImportOptions extends OfferOptions {
  brandId: string;
  /** The document's id, which is also what it saves under. */
  catalogId: string;
  name: string;
  /** Which pages to take, 1-based. All of them when absent. */
  pages?: number[];
  /**
   * Put the publication's own products on the pages.
   *
   * On by default, because a page with nothing in it is not a layout
   * anybody can judge. Off is the other honest reading of "give me the
   * layout": the grid, empty, ready for this week's feed.
   */
  withOffers?: boolean;
}

export interface PublicationImport {
  document: CatalogDocument;
  readings: PageReading[];
}

/**
 * A publication as a document, page for page.
 *
 * Pages that carry no readable grid still come through — as image pages
 * when they have a sheet-sized picture, and dropped otherwise. A
 * catalogue that silently skipped its cover would be renumbered against
 * the publication it was imported from, and the first thing anybody does
 * with this is compare the two side by side.
 */
export function publicationDocument(
  publication: Publication,
  options: ImportOptions,
): PublicationImport {
  const wanted = options.pages?.length ? new Set(options.pages) : null;
  const chosen = publication.pages.filter((page) => !wanted || wanted.has(page.number));

  const withOffers = options.withOffers !== false;
  const offers: Offer[] = [];
  const templates: PageTemplate[] = [];
  const pages: CatalogPage[] = [];
  const readings: PageReading[] = [];
  const seen = new Set<string>();

  for (const page of chosen) {
    const templateId = `pub/${publication.id}/p${page.number}`;
    const read = pageTemplate(page, templateId);

    const background = page.background
      ? {
        imageUrl: page.background.imageUrl,
        subject: `udgivelsens side ${page.number}`,
        // The picture IS the sheet — it was published at the sheet's own
        // proportions — so it is fitted whole rather than cropped to fill.
        fit: 'contain' as const,
        opacity: page.background.opacity,
        focusX: 50,
        focusY: 50,
      }
      : null;

    if (!read) {
      readings.push({
        number: page.number,
        offers: page.offers.length,
        columns: 0,
        rows: 0,
        fit: 0,
        skipped: page.offers.length === 0
          ? 'ingen tilbud på siden'
          : 'tilbuddene sidder ikke på et fælles gitter',
      });
      // A sheet with a picture and no grid is exactly what an image page
      // is for — a cover, an advertisement, a recipe spread.
      if (background) {
        pages.push({
          id: `${options.catalogId}-p${page.number}`,
          kind: 'image',
          templateId: '',
          title: '',
          subtitle: '',
          placements: [],
          rationale: `Side ${page.number} i udgivelsen — uden gitter`,
          ground: page.ground,
          decorations: [],
          background,
          texts: {},
        });
      }
      continue;
    }

    templates.push(read.template);
    readings.push({
      number: page.number,
      offers: page.offers.length,
      columns: read.template.areas[0]!.split(' ').length,
      rows: read.template.areas.length,
      fit: read.fit,
      skipped: null,
    });

    const placements = read.order
      .map((slotId, index) => ({ slotId, offer: page.offers[index] }))
      .filter((entry): entry is { slotId: string; offer: PublicationOffer } => Boolean(entry.offer))
      .filter((entry) => read.template.slots.some((slot) => slot.id === entry.slotId));

    for (const entry of placements) {
      if (seen.has(entry.offer.id)) continue;
      seen.add(entry.offer.id);
      offers.push(publicationOffer(entry.offer, page, options));
    }

    pages.push({
      id: `${options.catalogId}-p${page.number}`,
      kind: 'offers',
      templateId: read.template.id,
      title: '',
      subtitle: '',
      placements: withOffers
        ? placements.map((entry) => ({
          offerId: entry.offer.id,
          slotId: entry.slotId,
          overrides: {
            pinned: false,
            arrangement: null,
            displayName: null,
            description: null,
            imageScale: 1,
            imageOffsetX: 0,
            imageOffsetY: 0,
            parts: {},
            pack: {},
          },
        }))
        : [],
      rationale: `Side ${page.number} i udgivelsen`,
      ground: page.ground,
      decorations: [],
      background,
      texts: {},
    });
  }

  const now = new Date().toISOString();
  return {
    document: {
      id: options.catalogId,
      schemaVersion: 2,
      name: options.name,
      brandId: options.brandId,
      pages,
      /*
       * Every product the publication carries travels with the
       * document, whether or not a page is showing it.
       *
       * `withOffers: false` asks for the grid without the products ON
       * it, not for the products to be thrown away — an offer in the
       * document that no page shows is the bench, which the editor
       * already knows how to deal out.
       */
      offers,
      templates,
      createdAt: now,
      updatedAt: now,
    },
    readings,
  };
}
