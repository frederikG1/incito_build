import { z } from 'zod';
import { TILE_ARRANGEMENTS, TILE_PARTS } from './tile.js';

/**
 * Every edit a person or an agent can make to a catalogue, as data.
 *
 * The studio's gestures, the HTTP API, the CLI and Claude all speak this
 * vocabulary, so an edit is the same thing whoever made it: it can be
 * logged, replayed, reviewed before it lands and undone as a unit.
 *
 * Offers are addressed by `offerId` — an offer stands on at most one
 * page, so the id says which tile — and pages by `pageId`. Values are
 * ABSOLUTE ("scale 1.2"), not deltas ("20% bigger"), so running the same
 * op twice is the same as running it once. Geometry is in the units the
 * document already stores: a box's offsets in percent of the page (±25),
 * the picture's in fractions of its frame (±1).
 */
const Id = z.string().min(1);

export const TEXT_PARTS = ['name', 'description', 'brand', 'quantity', 'meta'] as const;

export const EditOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('swap'),
    offerId: Id,
    withOfferId: Id.describe('A placed offer trades places; a reserve offer takes this one\'s slot and this one goes to reserve.'),
  }).describe('Swap two offers.'),
  z.object({
    op: z.literal('place'),
    offerId: Id,
    pageId: Id,
    slotId: Id,
  }).describe('Put an offer in a slot. The slot\'s occupant moves to where the offer was, or to reserve.'),
  z.object({ op: z.literal('add'), offerId: Id, pageId: Id })
    .describe('Put an offer on a page, in its first empty slot — or, on a full page, in the chain\'s layout with one more slot.'),
  z.object({ op: z.literal('remove'), offerId: Id }).describe('Take an offer off its page, into reserve.'),
  z.object({ op: z.literal('lead'), offerId: Id }).describe('Make an offer its page\'s lead: move it into the page\'s biggest slot.'),
  z.object({
    op: z.literal('text'),
    offerId: Id,
    part: z.enum(TEXT_PARTS),
    text: z.string().max(200).nullable().describe('The words to print; "" removes the line; null goes back to the feed\'s.'),
  }).describe('Rewrite a line of a tile.'),
  z.object({
    op: z.literal('part'),
    offerId: Id,
    part: z.enum(TILE_PARTS),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    scale: z.number().optional(),
    hidden: z.boolean().optional(),
  }).describe('Move, size or hide one box of a tile. media: offsets ±1 of its frame, scale 0.5–2; others: offsets ±25 page %, scale 0.4–3.'),
  z.object({
    op: z.literal('arrange'),
    offerId: Id,
    arrangement: z.enum(TILE_ARRANGEMENTS).nullable(),
  }).describe('How a several-product tile stands its products: row, stagger, grid or fan; null lets the page decide.'),
  z.object({ op: z.literal('pin'), offerId: Id, pinned: z.boolean() })
    .describe('Lock a tile in its slot: a new week and a re-layout leave it where it is.'),
  z.object({
    op: z.literal('price'),
    offerId: Id,
    price: z.number().nonnegative().max(100000).optional(),
    prePrice: z.number().nonnegative().max(100000).nullable().optional(),
  }).describe('Correct an offer\'s price or previous price.'),
  z.object({
    op: z.literal('pageText'),
    pageId: Id,
    title: z.string().max(80).optional(),
    subtitle: z.string().max(160).optional(),
  }).describe('Rewrite a page\'s heading.'),
  z.object({ op: z.literal('layout'), pageId: Id, templateId: Id })
    .describe('Give a page another of the chain\'s layouts. Offers keep their order; what does not fit goes to reserve.'),
  z.object({ op: z.literal('movePage'), pageId: Id, to: z.number().int().min(0) })
    .describe('Move a page to position `to` (0 is the front page).'),
  z.object({ op: z.literal('removePage'), pageId: Id })
    .describe('Leave a page out of this edition — the national cover in a store\'s copy, a store page in the national one. Its offers go to reserve.'),
  z.object({ op: z.literal('reset'), offerId: Id })
    .describe('Undo every tweak on a tile — boxes, picture, wording — but keep it pinned if it was.'),
]);
export type EditOp = z.infer<typeof EditOp>;

export const EditOps = z.array(EditOp).max(200);
export type EditOps = z.infer<typeof EditOps>;
