import { z } from 'zod';

/**
 * What happens to an avis around the pages: who signed it off, which
 * places on it are sold, and what changed after it went out.
 *
 * Three things the layout tools never needed and the week always had.
 * A printed avis is approved by marketing, by the buyers and by whoever
 * answers for the prices; its best places are paid for by suppliers;
 * and once it is out, a product sells out on Wednesday. Each lived in
 * e-mail. Here each is data on the document, so the studio can say
 * what changed since a signature, refuse to move a sold place, and keep
 * the published avis current.
 */

/* -------------------------------------------------------- sign-off */

/** Who signs an avis off. One lane each; each sees the changes it answers for. */
export const APPROVAL_ROLES = ['marketing', 'indkob', 'pris'] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export const APPROVAL_ROLE_NAMES: Record<ApprovalRole, string> = {
  marketing: 'Marketing',
  indkob: 'Indkøb',
  pris: 'Pris og jura',
};

/**
 * The avis as it stood when somebody signed it — only what a change can
 * be stated in.
 *
 * Not a version number. A version is the whole document at a moment and
 * would have to be fetched and walked to say "the price of Arla
 * letmælk went from 10 to 12"; this is the few facts that sentence is
 * made of, small enough to travel inside the document it describes.
 */
export const ApprovalSeen = z.object({
  pages: z.array(z.object({
    id: z.string(),
    title: z.string(),
    templateId: z.string(),
    /** [slotId, offerId] in the page's own order. */
    slots: z.array(z.tuple([z.string(), z.string()])),
  })),
  /**
   * offerId → [name, price, prePrice, memberPrice, savings?].
   * `savings` is the "spar" the avis states; absent on signatures made before it was kept.
   */
  offers: z.record(z.string(), z.tuple([z.string(), z.number(), z.number().nullable(), z.number().nullable()]).rest(z.number().nullable())),
  /**
   * editionId → [name, number of edits, fingerprint?].
   * The fingerprint is of the edition's edits and local offers, so a swapped
   * edit is a change even when the count stays; absent on older signatures.
   */
  editions: z.record(z.string(), z.tuple([z.string(), z.number()]).rest(z.string())).default({}),
  /** bookingId → "pageId/slotId/offerId/supplier". */
  bookings: z.record(z.string(), z.string()).default({}),
});
export type ApprovalSeen = z.infer<typeof ApprovalSeen>;

export const Approval = z.object({
  role: z.enum(APPROVAL_ROLES),
  who: z.string().min(1).max(80),
  at: z.string(),
  seen: ApprovalSeen,
  /**
   * The stored version the signature was saved as — the avis exactly as
   * signed, fetchable from the history. Set by the server, which is the
   * only place a signature is made; absent on older ones.
   */
  version: z.number().int().positive().optional(),
});
export type Approval = z.infer<typeof Approval>;

/* ------------------------------------------------------ sold places */

/**
 * A place on a page a supplier has paid for.
 *
 * Addressed by page and slot, because that is what was sold: "the big
 * place on the front page", whatever product ends up standing in it.
 * The product is part of the deal when there is one — Carlsberg bought
 * the place for Carlsberg — and the checks say so when the place shows
 * something else, or nothing.
 */
export const SlotBooking = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  slotId: z.string().min(1),
  /** Who paid: "Carlsberg Danmark", as the deal names them. */
  supplier: z.string().min(1).max(80),
  /** The product the deal is for; null when the supplier may fill it as they like. */
  offerId: z.string().nullable().default(null),
  /** What the place was sold for, in the avis's currency. */
  price: z.number().nonnegative().max(10_000_000),
  /** The deal's own reference, or a word for the person reading. */
  note: z.string().max(200).default(''),
  at: z.string(),
});
export type SlotBooking = z.infer<typeof SlotBooking>;

/* -------------------------------------------------------- live avis */

export const LIVE_KINDS = ['udsolgt', 'pris', 'tilbage'] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/**
 * One change to an avis that is already out.
 *
 * Kept as a list rather than folded into the pages, because "when did
 * the shopper see what" is the question a complaint asks, and the
 * answer is this list in order.
 */
export const LiveEvent = z.object({
  id: z.string().min(1),
  at: z.string(),
  kind: z.enum(LIVE_KINDS),
  offerId: z.string().min(1),
  /** The product standing in for a sold-out one, when there is one. */
  substituteId: z.string().nullable().default(null),
  /** The price before and after, on a price change. */
  before: z.number().nullable().default(null),
  after: z.number().nullable().default(null),
  who: z.string().max(80).default(''),
});
export type LiveEvent = z.infer<typeof LiveEvent>;
