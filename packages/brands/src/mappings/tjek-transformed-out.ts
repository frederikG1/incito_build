import type { Offer, OfferFeed } from '@incitio/schema';

/**
 * Incitio's offers written out as Tjek "transformed offers" — the rows the
 * publication builder holds and the CMS Offers tab shows: Unit Symbol,
 * Piece Count, Comment Label 2 ("3 for 89,90"), Custom Label 3, Legal
 * Info ("79,80/L").
 *
 * The exact inverse of `tjekTransformed` in ./tjek.ts: a row written here
 * and read back gives the same offer in everything the format can hold,
 * which the round-trip test pins. What it cannot hold is dropped, not
 * invented — a weight range keeps its lower bound, as Tjek's readers do.
 */
export interface TjekTransformedOffer {
  id: string;
  name: string;
  description: string | null;
  price: number;
  preprice: number | null;
  savings: number | null;
  membership_price: number | null;
  membership_savings: number | null;
  unit_symbol: string;
  unit_size_from: number | null;
  unit_size_to: number | null;
  piece_count_from: number;
  piece_count_to: number;
  image: { signed: string } | null;
  products: { image: { signed: string } }[];
  logos: { name: string }[];
  valid_from: string;
  valid_until: string;
  comment_label_1: string | null;
  comment_label_2: string | null;
  comment_label_3: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  legal_info: string | null;
  priority: number | null;
}

const UNIT_OUT: Record<Offer['quantity']['unit'], string> = {
  g: 'gram', kg: 'kilogram', ml: 'milliliter', l: 'liter', m: 'meter', pcs: 'piece', pack: 'piece',
};

const kr = (value: number) => value.toFixed(2).replace('.', ',');
const COMPARISON_UNIT = { kg: 'kg', l: 'L', pcs: 'stk', m: 'm' } as const;

export function toTjekTransformed(offer: Offer): TjekTransformedOffer {
  const hasSize = offer.quantity.size !== null && offer.quantity.unit !== 'pcs' && offer.quantity.unit !== 'pack';
  const said = (kind: Offer['labels'][number]['kind']) => offer.labels.filter((l) => l.kind === kind && !l.image).map((l) => l.text);
  const tags = offer.labels
    .filter((l) => !l.image && (l.kind === 'custom' || l.kind === 'new' || l.kind === 'organic'))
    .map((l) => l.text);
  const member = offer.memberPrice !== null;
  return {
    id: offer.id,
    name: offer.name,
    description: offer.description || null,
    price: offer.price,
    preprice: offer.prePrice,
    // The reader takes `savings`, then `membership_savings`; a member offer's saving goes in the second.
    savings: member ? null : offer.savings,
    membership_price: offer.memberPrice,
    membership_savings: member ? offer.savings : null,
    unit_symbol: hasSize ? UNIT_OUT[offer.quantity.unit] : 'piece',
    unit_size_from: hasSize ? offer.quantity.size : null,
    unit_size_to: hasSize ? offer.quantity.size : null,
    piece_count_from: offer.quantity.pieceCount,
    piece_count_to: offer.quantity.pieceCount,
    image: offer.imageUrl ? { signed: offer.imageUrl } : null,
    products: offer.imagePack.length > 1 ? offer.imagePack.map((url) => ({ image: { signed: url } })) : [],
    // Marks with artwork travel by name; the reader resolves them against the same dictionary.
    logos: offer.labels.filter((l) => l.image).map((l) => ({ name: l.text })),
    valid_from: offer.validFrom,
    valid_until: offer.validTo,
    comment_label_1: offer.pack || (member ? 'Medlemspris' : null),
    comment_label_2: said('multibuy').join(', ') || null,
    comment_label_3: said('saving').join(', ') || null,
    custom_label_1: tags.join(', ') || null,
    // Tjek has no campaign field, and a label here would read back as a chip.
    custom_label_2: null,
    custom_label_3: null,
    legal_info: offer.comparison ? `${kr(offer.comparison.value)}/${COMPARISON_UNIT[offer.comparison.unit]}` : null,
    priority: offer.priority,
  };
}

export function feedToTjekTransformed(feed: OfferFeed): TjekTransformedOffer[] {
  return feed.offers.map(toTjekTransformed);
}
