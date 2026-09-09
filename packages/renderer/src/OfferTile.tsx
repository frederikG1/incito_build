import { useState, type CSSProperties } from 'react';
import type { Offer, OfferLabel, PlacementOverrides, TemplateSlot } from '@incitio/schema';
import { formatPrice, formatQuantity, formatValidity, splitPrice } from './format.js';

/**
 * A certification mark, rendered as artwork.
 *
 * Retailers contract for the Ø-mark itself, not the word "Økologi" in a
 * box. Where the artwork fails to load the wording comes back rather than
 * leaving a hole — several marks in the shipped dictionary are hosted on
 * Google Drive, which is not a reliable image origin.
 */
function LabelMark({ label }: { label: OfferLabel }) {
  const [broken, setBroken] = useState(false);
  if (broken || !label.image) {
    return <li className={`tag tag--${label.kind}`}>{label.text}</li>;
  }
  return (
    <li className="tag tag--mark">
      {/* Not lazy: marks are 1-24KB of SVG, at most two per tile, and the
          page container is scaled — which stops the lazy heuristic firing
          for tiles the viewer is actually looking at. */}
      <img src={label.image} alt={label.text} onError={() => setBroken(true)} />
    </li>
  );
}

export interface OfferTileProps {
  offer: Offer;
  slot: TemplateSlot;
  overrides?: PlacementOverrides;
  /** Fraction of the page this tile covers; drives the density decisions. */
  area: number;
  /** Slot aspect ratio; wide tiles switch to a side-by-side composition. */
  aspect: number;
  selected?: boolean;
  onSelect?: (offerId: string) => void;
}

/**
 * One offer, rendered at whatever size the slot gives it.
 *
 * The tile does not have "small" and "large" variants — it has thresholds.
 * Secondary information drops out as the tile shrinks, in the order a
 * designer would drop it (description, then unit price, then brand), so a
 * single component stays legible from a hero down to a filler.
 */
/**
 * Tile proportions measured from real published catalogs.
 *
 * Source: `data/templates/tile-composition.json`, produced by
 * `ml/mine_pdf.py` from 1,193 tiles across 7 retailers. The figures below
 * are the grocery/hypermarket segment (n=723) — furniture and lifestyle
 * catalogs run a completely different scale (price/name ~1.05 at Daells
 * Bolighus against ~3.75 at Bilka), so mixing the segments would produce
 * a tile that suits neither.
 *
 * Re-derive after re-running the miner; do not hand-tune.
 */
export const MEASURED = {
  /** Median share of a tile given over to artwork. */
  artworkShare: 0.557,
  /** Median price-to-name font-size ratio, and its interquartile range. */
  priceToName: { median: 1.9, q1: 1.43, q3: 3.26 },
} as const;

/** Editorial weight of the role, independent of how big the slot happens to be. */
const ROLE_SCALE = { hero: 1.25, standard: 1, filler: 0.95 } as const;

/** Area at which the scale multiplier is exactly 1 — a standard 6-up tile. */
const REFERENCE_AREA = 0.14;

/**
 * Type scale for a tile: its editorial role, adjusted by the square root
 * of its area.
 *
 * The square root matters. Scaling type linearly with area makes a
 * quarter-page tile four times the size of a sixteenth-page one, which
 * reads as a broken slide rather than a hierarchy; scaling with the
 * tile's *dimension* is what a designer does by eye. The clamp then stops
 * either extreme from running away.
 */
function typeScale(role: keyof typeof ROLE_SCALE, area: number): number {
  const areaFactor = Math.min(1.35, Math.max(0.85, Math.sqrt(area / REFERENCE_AREA)));
  return ROLE_SCALE[role] * areaFactor;
}

export function OfferTile({ offer, slot, overrides, area, aspect, selected, onSelect }: OfferTileProps) {
  const isHero = slot.role === 'hero';
  const isWide = aspect >= 1.55;
  const showDescription = area > 0.12 && offer.description !== '';
  const showComparison = area > 0.055 && offer.comparison !== null;
  const showBrand = area > 0.05 && offer.brand !== '';
  const showValidity = isHero;

  const price = splitPrice(offer.price);
  const name = overrides?.displayName ?? offer.name;
  const quantity = formatQuantity(offer.quantity.size, offer.quantity.unit, offer.quantity.pieceCount);

  // Image nudges are stored normalised so they survive a template change.
  const imageStyle: CSSProperties = {
    transform: `translate(${(overrides?.imageOffsetX ?? 0) * 20}%, ${(overrides?.imageOffsetY ?? 0) * 20}%) scale(${overrides?.imageScale ?? 1})`,
  };

  // Price tags and certification marks compete for the same corner and
  // must not: a tile that can show one badge should show its Ø-mark, not
  // lose it behind "Spar 25%". They are separated so the crowded-tile
  // truncation applies to each group independently.
  const marks = offer.labels.filter((l) => l.image !== null);
  const promos = offer.labels.filter((l) => l.image === null);

  return (
    <article
      className={`tile${isHero ? ' tile--hero' : ''}${isWide ? ' tile--wide' : ''}${selected ? ' tile--selected' : ''}`}
      onClick={onSelect ? () => onSelect(offer.id) : undefined}
      style={{ '--scale': typeScale(slot.role, area) } as CSSProperties}
    >
      <div className="tile__media">
        {offer.imageUrl ? (
          <img src={offer.imageUrl} alt="" loading="lazy" style={imageStyle} />
        ) : (
          <div className="tile__placeholder" aria-hidden="true">
            <span>{name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        {promos.length > 0 && (
          <ul className="tile__labels">
            {promos.slice(0, isHero ? 3 : 1).map((label) => (
              <li key={`${label.kind}-${label.text}`} className={`tag tag--${label.kind}`}>
                {label.text}
              </li>
            ))}
          </ul>
        )}
        {marks.length > 0 && (
          <ul className="tile__marks">
            {marks.slice(0, isHero ? 3 : 2).map((label) => (
              <LabelMark key={`${label.kind}-${label.text}`} label={label} />
            ))}
          </ul>
        )}
      </div>

      <div className="tile__body">
        <div className="tile__text">
          {showBrand && <p className="tile__brand">{offer.brand}</p>}
          <h3 className="tile__name">{name}</h3>
          {quantity && <p className="tile__quantity">{quantity}</p>}
          {showDescription && <p className="tile__description">{offer.description}</p>}
        </div>

        <div className="tile__pricing">
          <div className="price">
            <span className="price__major">{price.major}</span>
            <span className="price__minor">{price.minor}</span>
          </div>
          <div className="tile__meta">
            {offer.prePrice !== null && offer.prePrice > offer.price && (
              <span className="tile__preprice">{formatPrice(offer.prePrice, offer.currency)}</span>
            )}
            {offer.savings !== null && offer.savings > 0 && (
              <span className="tile__savings">Spar {formatPrice(offer.savings, offer.currency)}</span>
            )}
            {showComparison && offer.comparison && (
              <span className="tile__comparison">
                {formatPrice(offer.comparison.value, offer.currency)} / {offer.comparison.unit}
              </span>
            )}
            {showValidity && (
              <span className="tile__validity">{formatValidity(offer.validFrom, offer.validTo)}</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
