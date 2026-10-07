import { datesIn, retimeDates } from '@incitio/workflow';
import type { CatalogDocument, Offer } from '@incitio/schema';
import type { Finding } from './findings.js';

/**
 * The fix a finding can carry, when the studio knows it without asking.
 *
 * Godkend lists what stops the print; most lines only say where to go.
 * Three have one right answer the studio can already see: the band that
 * names last week's dates, the page with empty places, the product whose
 * picture the feed has under the same name. Those get a button that does
 * it, and say what it will do before it does.
 */
export type QuickFix =
  | { kind: 'uge'; label: string; detail: string; pageId: string; lines: { from: string; to: string }[] }
  | { kind: 'plads'; label: string; detail: string; pageId: string }
  | { kind: 'billede'; label: string; detail: string; offerId: string; imageUrl: string }
  | { kind: 'førpris'; label: string; detail: string; offerId: string; prePrice: number | null; savings: number };

/** The lines on a page that name another week, with what they become. */
export function staleLinesOf(document: CatalogDocument, pageId: string): { from: string; to: string }[] {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page || !document.week) return [];
  const week = document.week;
  return [page.title, page.subtitle, ...page.notes.map((note) => note.text)]
    .map((from) => ({ from, to: retimeDates(from, week) }))
    .filter((line): line is { from: string; to: string } => line.to !== null);
}

/** The feed's picture for a product: the same row, or a row with the same name. */
export function feedPictureOf(offer: Offer, feed: Offer[]): string | null {
  const name = offer.name.trim().toLowerCase();
  const same = feed.find((row) => row.id === offer.id && row.imageUrl)
    ?? feed.find((row) => row.imageUrl && row.name.trim().toLowerCase() === name);
  return same?.imageUrl ?? null;
}

/** "25. sep.–1. okt." — the dates a moved line now names, short enough for a button. */
function spanOf(text: string, year: number): string {
  const times = datesIn(text, year).map((date) => date.getTime()).sort((a, b) => a - b);
  const say = (time: number) => new Date(time).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (times.length === 0) return 'denne uge';
  const low = times[0]!;
  const high = times[times.length - 1]!;
  return low === high ? say(low) : `${say(low)}–${say(high)}`;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function quickFixOf(
  document: CatalogDocument,
  finding: Finding,
  feed: Offer[],
  emptyOn: (pageId: string) => number,
): QuickFix | null {
  if (finding.kind === 'førpris' && finding.offerId) {
    const offer = document.offers.find((entry) => entry.id === finding.offerId);
    if (!offer) return null;
    // A saving that disagrees with its two prices: make it the difference.
    if (finding.id.startsWith('spar:') && offer.prePrice !== null && offer.prePrice > offer.price) {
      const savings = cents(offer.prePrice - offer.price);
      return {
        kind: 'førpris', label: 'Ret spar-beløbet', detail: `Spar ${savings.toFixed(2).replace('.', ',')} i stedet for ${offer.savings}`,
        offerId: offer.id, prePrice: offer.prePrice, savings,
      };
    }
    // Everything else: no before-price, no claim to check.
    if (finding.id.startsWith('førpris:') || finding.id.startsWith('førlav:') || finding.id.startsWith('spar:')) {
      return {
        kind: 'førpris', label: 'Fjern førpris', detail: `${offer.name} vises kun med sin pris, uden førpris og spar`,
        offerId: offer.id, prePrice: null, savings: 0,
      };
    }
    return null;
  }
  if (!finding.pageId) return null;
  if (finding.kind === 'uge') {
    const lines = staleLinesOf(document, finding.pageId);
    if (lines.length === 0) return null;
    return {
      kind: 'uge',
      label: `Ret til ${spanOf(lines[0]!.to, document.week!.year)}`,
      detail: lines.map((line) => `"${line.to}"`).join(' · '),
      pageId: finding.pageId,
      lines,
    };
  }
  if (finding.kind === 'plads' && finding.id.endsWith(':tomme-pladser')) {
    const empty = emptyOn(finding.pageId);
    if (empty === 0) return null;
    return {
      kind: 'plads',
      label: 'Fyld fra reserven',
      detail: `${empty === 1 ? 'Én tom plads' : `${empty} tomme pladser`} fyldes med varer fra sidens afdeling`,
      pageId: finding.pageId,
    };
  }
  if (finding.kind === 'billede' && finding.offerId) {
    const offer = document.offers.find((entry) => entry.id === finding.offerId);
    if (!offer || offer.members.length > 1 || offer.imageUrl) return null;
    const imageUrl = feedPictureOf(offer, feed);
    if (!imageUrl) return null;
    return {
      kind: 'billede',
      label: 'Brug feedets billede',
      detail: `Billedet fra feedet til ${offer.name}`,
      offerId: offer.id,
      imageUrl,
    };
  }
  return null;
}

/** The avis with a fix applied. Pure: the studio wraps it in its undo. */
export function applyQuickFix(document: CatalogDocument, fix: QuickFix): CatalogDocument {
  if (fix.kind === 'billede') {
    return {
      ...document,
      offers: document.offers.map((offer) => (offer.id === fix.offerId ? { ...offer, imageUrl: fix.imageUrl } : offer)),
    };
  }
  if (fix.kind === 'førpris') {
    return {
      ...document,
      offers: document.offers.map((offer) => (offer.id === fix.offerId
        ? { ...offer, prePrice: fix.prePrice, savings: fix.savings, ...(fix.prePrice === null ? { savingsPercent: null, savingsMax: null } : {}) }
        : offer)),
    };
  }
  if (fix.kind === 'uge') {
    const moved = new Map(fix.lines.map((line) => [line.from, line.to]));
    const retime = (text: string) => moved.get(text) ?? text;
    return {
      ...document,
      pages: document.pages.map((page) => (page.id === fix.pageId
        ? {
          ...page,
          title: retime(page.title),
          subtitle: retime(page.subtitle),
          notes: page.notes.map((note) => ({ ...note, text: retime(note.text) })),
        }
        : page)),
    };
  }
  return document;
}
