import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Offer, OfferLabel, PlacementOverrides, PriceShape, SlotRole } from '@incitio/schema';
import { formatPrice, formatQuantity, splitPrice } from './format.js';

/**
 * A certification mark, rendered as artwork.
 *
 * Chains contract for the Ø-mark itself, not the word "Økologi" in a
 * box. Where the artwork fails to load the wording comes back rather
 * than leaving a hole — several marks in the shipped dictionary are
 * hosted on origins that are not always reachable.
 */
function LabelMark({ label }: { label: OfferLabel }) {
  const [broken, setBroken] = useState(false);
  if (broken || !label.image) {
    return <li className={`tag tag--${label.kind}`}>{label.text}</li>;
  }
  return (
    <li className="tag tag--mark">
      <img src={label.image} alt={label.text} onError={() => setBroken(true)} />
    </li>
  );
}

export interface OfferTileProps {
  offer: Offer;
  role: SlotRole;
  priceShape: PriceShape;
  overrides?: PlacementOverrides;
  selected?: boolean;
  onSelect?: (offerId: string) => void;
}

/** How many variant images a tile shows before it stops being legible. */
const MAX_PACK: Record<SlotRole, number> = {
  hero: 5,
  feature: 4,
  standard: 3,
  compact: 1,
};

/** How many promotional tags and marks each role has room for. */
const MAX_TAGS: Record<SlotRole, number> = {
  hero: 3, feature: 2, standard: 1, compact: 0,
};

/**
 * How the images of a multi-variant offer are arranged.
 *
 * Published pages do not print every "frit valg" tile the same way. On
 * one Coop page the pålæg trays overlap in a staggered row with the
 * middle one in front, the spegepølse packs sit in a 2×2 block, the
 * bread bags fan across, and the fiskefrikadeller are two trays offset
 * diagonally. One arrangement everywhere is the single clearest tell
 * that a page was generated.
 */
export type PackStyle = 'row' | 'stagger' | 'grid' | 'fan';

/**
 * Deterministic 0..1 from an offer id (FNV-1a, 32-bit).
 *
 * The arrangement has to VARY across a page but must not vary between
 * two renders of the same catalogue, or the editor would reshuffle
 * under the user and a printed proof would not match the screen.
 * Drawing it from the offer's own id gives both.
 */
function stableFraction(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/**
 * Pick an arrangement for this offer's variants.
 *
 * Constrained by count, because the shapes are not interchangeable:
 * four or more items read as a block, two or three as a row, and a fan
 * only works when the items are tall enough to rotate without their
 * corners leaving the tile.
 */
export function packStyle(offerId: string, count: number, role: SlotRole): PackStyle {
  // A 2×2 block only works at exactly four. Five items in two columns
  // is three rows, which makes every product too small to read.
  if (count === 4) return stableFraction(offerId) < 0.55 ? 'grid' : 'stagger';
  if (count > 4) return 'stagger';
  // A fan needs room to rotate without its corners leaving the tile, so
  // a compact tile is offered only the two upright shapes.
  const options: PackStyle[] = role === 'compact'
    ? ['stagger', 'row']
    : ['stagger', 'row', 'fan'];
  return options[Math.floor(stableFraction(offerId) * options.length)]!;
}

/**
 * One offer, drawn at whatever size its slot gives it.
 *
 * There are no "small" and "large" variants of this component — there is
 * one component and a role. Secondary information drops out as the role
 * gets tighter, in the order a designer would drop it (description, then
 * unit price, then brand), and the stylesheet does the rest through
 * container queries. That is what lets one tile stay legible from a
 * half-page hero down to a ninth-page filler.
 */
export function OfferTile({
  offer, role, priceShape, overrides, selected, onSelect,
}: OfferTileProps) {
  /*
   * A price of 0 means there is no price, not that it is free.
   *
   * Feeds carry mechanic offers whose whole proposition is the headline
   * — "Spar 20% på Irma varer", "Udvalgte opbevaringsglas". Printing
   * "0,00" on a price mark makes the loudest thing on the page a lie, so
   * the name carries the tile instead, which is what the leaflet does.
   */
  const hasPrice = offer.price > 0;
  const name = overrides?.displayName ?? offer.name;

  /*
   * A variant cluster, when the offer covers several products.
   *
   * "Frit valg" and "Flere varianter" are one price over several items,
   * and published leaflets print them as a group rather than picking one
   * at random — 72% of SuperBrugsen's offers supply two or more motives.
   * A compact tile shows one anyway: at that size a cluster is mush.
   */
  const pack = offer.imagePack.slice(0, MAX_PACK[role]);
  const isPacked = pack.length > 1;
  const arrangement = isPacked ? packStyle(offer.id, pack.length, role) : 'row';

  // Price tags and certification marks compete for the same corner and
  // must not: a tile that can show one badge should show its Ø-mark, not
  // lose it behind "Spar 25%".
  const marks = offer.labels.filter((l) => l.image !== null);
  const promos = offer.labels.filter((l) => l.image === null);
  const tagRoom = MAX_TAGS[role];
  const promoCount = Math.min(promos.length, tagRoom);

  const showDescription = (role === 'hero' || role === 'feature') && offer.description !== '';
  /*
   * The brand line, unless the name already says it.
   *
   * Feeds routinely give both — "GOD MORGEN" and "Økologisk God Morgen
   * juice" — and printing the two together says the same thing twice
   * and costs the tile a line it does not have to spare. Published
   * tiles set the brand separately only when the name omits it.
   */
  const showBrand = role !== 'compact'
    && offer.brand !== ''
    && !name.toLowerCase().includes(offer.brand.toLowerCase());
  /*
   * Unit price and previous price are the first things a designer drops
   * on a crowded tile — they are reference figures, not the offer. A
   * compact tile never shows them; a standard one shows them only when
   * it is not already carrying a promotional chip.
   */
  const showMeta = role !== 'compact' && !(role === 'standard' && promoCount > 0);
  const showComparison = showMeta && offer.comparison !== null;

  const price = splitPrice(offer.price);
  const quantity = formatQuantity(
    offer.quantity.size, offer.quantity.unit, offer.quantity.pieceCount,
  );

  // Image nudges are stored normalised so they survive a template change.
  const mediaStyle: CSSProperties = {
    transform: `translate(${(overrides?.imageOffsetX ?? 0) * 20}%, ${(overrides?.imageOffsetY ?? 0) * 20}%) scale(${overrides?.imageScale ?? 1})`,
  };


  const className = [
    'tile',
    `tile--${role}`,
    isPacked && 'tile--packed',
    !hasPrice && 'tile--mechanic',
    selected && 'is-selected',
  ].filter(Boolean).join(' ');

  return (
    <article
      className={className}
      data-offer-id={offer.id}
      onClick={onSelect ? () => onSelect(offer.id) : undefined}
    >
      <div className="tile__media">
        {isPacked ? (
          <div
            className={`tile__pack tile__pack--${arrangement}`}
            style={mediaStyle}
            data-count={pack.length}
          >
            {pack.map((url, index) => (
              /*
               * The middle item paints on top, not the last one.
               *
               * A group of products has a front — published tiles put
               * the lead variant nearest the reader with the others
               * behind it on each side. Stacking strictly by DOM order
               * makes the rightmost item the front, which reads as a
               * pile that fell over.
               */
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                style={{ zIndex: pack.length - Math.abs(index - (pack.length - 1) / 2) * 2 }}
              />
            ))}
          </div>
        ) : offer.imageUrl ? (
          <img src={offer.imageUrl} alt="" loading="lazy" style={mediaStyle} />
        ) : (
          <div className="tile__placeholder" aria-hidden="true">
            <span>{name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}

        {tagRoom > 0 && marks.length > 0 && (
          <ul className="tile__marks">
            {marks.slice(0, tagRoom).map((label) => (
              <LabelMark key={`${label.kind}-${label.text}`} label={label} />
            ))}
          </ul>
        )}
      </div>

      {hasPrice && (
        <div className={`price price--${priceShape}`}>
          {/* The figure is one unbreakable unit. Inside a disc the mark
              is square and narrow, and without this the øre wrapped onto
              a second line and the price read as two numbers. */}
          <span className="price__figure">
            <span className="price__major">{price.major}</span>
            <span className="price__minor">{price.minor === '00' ? ',-' : price.minor}</span>
          </span>
          {offer.savings !== null && offer.savings > 0 && role !== 'compact' && (
            <span className="price__savings">
              Spar {formatPrice(offer.savings, offer.currency)}
            </span>
          )}
        </div>
      )}

      <div className="tile__info">
        {showBrand && <p className="tile__brand">{offer.brand}</p>}
        <h3 className="tile__name">{name}</h3>
        {quantity && <p className="tile__quantity">{quantity}</p>}
        {showDescription && <p className="tile__description">{offer.description}</p>}

        <p className="tile__meta" hidden={!showMeta}>
          {offer.prePrice !== null && offer.prePrice > offer.price && (
            <span className="tile__preprice">
              Normalpris {formatPrice(offer.prePrice, offer.currency)}
            </span>
          )}
          {showComparison && offer.comparison && (
            <span className="tile__comparison">
              {formatPrice(offer.comparison.value, offer.currency)} / {offer.comparison.unit}
            </span>
          )}
        </p>
      </div>

      {/*
        * Tags sit OUTSIDE the text block, as their own tile row.
        *
        * Inside it they were the last thing in an elastic, clipped box,
        * so on a tight tile the chip printed cut in half across its
        * middle — which reads as a rendering bug rather than as an
        * omission. A fixed row either fits whole or is not there.
        */}
      {tagRoom > 0 && promos.length > 0 && (
        <ul className="tile__tags">
          {promos.slice(0, tagRoom).map((label) => (
            <li key={`${label.kind}-${label.text}`} className={`tag tag--${label.kind}`}>
              {label.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
