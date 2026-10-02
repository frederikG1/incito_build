import type { Department } from '@incitio/compose';
import type { Offer, SlotRole } from '@incitio/schema';
import { seeded, standInPrices, type PriceHistory } from '@incitio/workflow';

/**
 * What the platform knows that the avis does not — STAND-INS.
 *
 * Three numbers the studio now shows come from outside the document:
 * what a product cost over the last 30 days (the price rules), how many
 * people see a place on a page (the slot exchange), and what they did
 * once the avis was out (results). All of it exists — the chain's price
 * history, Tjek's reach and click data — and none of it is wired yet.
 *
 * So this file is the ONE seam. Every number below is made up, made up
 * the same way every time (seeded by the offer or the page, never
 * random), and labelled as such wherever it is shown — see `DEMO_NOTE`.
 * Replacing it is replacing these functions with fetches; nothing that
 * calls them needs to change.
 */

/** True while the numbers below are stand-ins. Every screen that shows them says so. */
export const SIGNALS_ARE_DEMO = true;
export const DEMO_NOTE = 'Eksempeltal — kommer fra Tjek, når forbindelsen er slået til';

/*
 * The 30-day price history lives with the price rules in
 * `@incitio/workflow` (`standInPrices`), because the server judges
 * "før"-prices with it too: what the studio warns about is what the
 * server refuses. Same stand-in, one place to replace.
 */
export { normalPrice, seeded, type PriceHistory } from '@incitio/workflow';

/** What the shelf price was, day by day, for the 30 days before. Stand-in — see `standInPrices`. */
export function priceHistory(offer: Offer): PriceHistory | null {
  return standInPrices.history(offer);
}

/* ----------------------------------------------------------- reach */

/** How many people open this chain's avis in a week. Stand-in for Tjek's reach. */
export function weeklyReach(brandId: string): number {
  return Math.round((240_000 + seeded(`${brandId}:reach`) * 380_000) / 1000) * 1000;
}

/**
 * How far into the avis a reader gets.
 *
 * The cover is seen by everybody, every page after it by a few percent
 * fewer, and the back page gets a lift — the paper is turned over.
 * The real curve is Tjek's page-view data per publication.
 */
export function pageReach(pageIndex: number, pageCount: number): number {
  if (pageIndex === 0) return 1;
  if (pageIndex === pageCount - 1 && pageCount > 2) return 0.74;
  return Math.max(0.35, 0.9 * Math.pow(0.95, pageIndex - 1));
}

export interface SlotSignal {
  /** People who will see the place this week. */
  views: number;
  /** Share of them who tap it. */
  clickRate: number;
  clicks: number;
  /** What the place costs on the chain's rate card. */
  listPrice: number;
}

/**
 * What a place on a page is worth.
 *
 * Seen by the page's readers, weighted by how much of the page it is —
 * a half-page hero is not seen four times as much as an eighth, so the
 * share counts at a root. Stand-in for Tjek's attention data per position.
 */
export function slotSignal(input: {
  brandId: string;
  pageIndex: number;
  pageCount: number;
  /** The place's share of the page, 0..1. */
  share: number;
  role: SlotRole | null;
  slotId: string;
}): SlotSignal {
  const readers = weeklyReach(input.brandId) * pageReach(input.pageIndex, input.pageCount);
  const lead = input.role === 'hero' ? 1.15 : input.role === 'feature' ? 1.06 : 1;
  const noticed = Math.min(0.92, 0.28 + Math.sqrt(Math.max(0, input.share)) * 0.9) * lead;
  const views = Math.round((readers * noticed) / 100) * 100;
  const clickRate = 0.012 + Math.sqrt(Math.max(0, input.share)) * 0.045
    + seeded(`${input.brandId}:${input.pageIndex}:${input.slotId}:ctr`) * 0.008;
  return {
    views,
    clickRate,
    clicks: Math.round(views * clickRate),
    // A rate card: kr. 140 per thousand views, in steps of 500.
    listPrice: Math.max(1000, Math.round((views * 0.14) / 500) * 500),
  };
}

/**
 * What a place actually did, once the avis was out.
 *
 * The plan times a factor around 1 — some places beat their estimate,
 * some miss. Stand-in for Tjek's post-campaign numbers.
 */
export function slotResult(planned: SlotSignal, key: string): { views: number; clicks: number; lists: number } {
  const factor = 0.72 + seeded(`${key}:resultat`) * 0.6;
  const views = Math.round((planned.views * factor) / 100) * 100;
  const clicks = Math.round(planned.clicks * factor * (0.85 + seeded(`${key}:klik`) * 0.3));
  // Added to a shopping list in the app: a share of the clicks.
  const lists = Math.round(clicks * (0.18 + seeded(`${key}:liste`) * 0.2));
  return { views, clicks, lists };
}

/* ---------------------------------------------------------- households */

export interface Household {
  id: string;
  name: string;
  /** Who they are, in one line. */
  said: string;
  /** What they buy, most first. */
  likes: Department[];
  /** What their shopping list holds this week — product words matched against offer names. */
  list: string[];
}

/**
 * Who reads the avis.
 *
 * Stand-ins for the segments Tjek can build from favourites, shopping
 * lists and store visits — never one named person, always a kind of
 * household.
 */
export const HOUSEHOLDS: Household[] = [
  {
    id: 'familie',
    name: 'Børnefamilien',
    said: 'To voksne, to børn, handler stort fredag',
    likes: ['mejeri', 'frugt', 'koed', 'slik', 'frost', 'broed'],
    list: ['mælk', 'yoghurt', 'bananer', 'hakket', 'rugbrød', 'juice', 'chips'],
  },
  {
    id: 'single',
    name: 'Single i byen',
    said: 'Handler lidt og ofte, efter arbejde',
    likes: ['vin', 'paalaeg', 'drikke', 'slik', 'kolonial'],
    list: ['øl', 'vin', 'pizza', 'kaffe', 'pasta'],
  },
  {
    id: 'senior',
    name: 'Pensionistparret',
    said: 'Handler i formiddagen, læser avisen grundigt',
    likes: ['broed', 'frugt', 'kolonial', 'paalaeg', 'husholdning', 'mejeri'],
    list: ['kaffe', 'smør', 'kartofler', 'æbler', 'rugbrød', 'ost'],
  },
];
