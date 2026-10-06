import { TILE_PARTS, TILE_PART_NAMES, partLimits, partOverride, partTouched } from '@incitio/schema';
import type { CatalogPage, Offer, PlacementOverrides, TilePart } from '@incitio/schema';
import { useStudio, useStudioPick } from '../state.js';
import { Measure } from '../Measure.js';

/**
 * The boxes whose wording lives on the box itself.
 *
 * The headline and the underline are absent because they have fields of
 * their own further up this panel; the price and the certification
 * marks because neither is a caption. Mirrors `REWRITABLE` in
 * TileEditor — the same rule, stated where each half of the editor can
 * see it.
 */
const REWRITABLE: readonly TilePart[] = [
  'brand', 'quantity', 'meta', 'tags',
];

/**
 * The box in hand on a tile, in pixels. A box moves in page percent and
 * the artwork pans in its frame's own units; both are written as a
 * nudge from where the box is, then measured and corrected.
 */
function PartMeasure({ pageId, slotId, offerId, part }: { pageId: string; slotId: string; offerId: string; part: TilePart }) {
  const updatePart = useStudio((s) => s.updatePart);
  const slot = `[data-slot-id="${CSS.escape(slotId)}"]`;
  const media = part === 'media';
  return (
    <Measure target={{
      key: `part:${offerId}:${part}`,
      pageId,
      selectors: media
        ? [`${slot} [data-part="media"] img`, `${slot} .tile__media > img`, `${slot} [data-part="media"]`]
        : [`${slot} [data-part="${part}"]`],
      write: (to, from, size, gesture, read) => {
        const placement = useStudio.getState().document?.pages.find((p) => p.id === pageId)?.placements.find((p) => p.slotId === slotId);
        if (!placement) return;
        const now = partOverride(placement.overrides, part);
        const { reach, minScale, maxScale } = partLimits(part);
        const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
        let perX = 100 / size.w;
        let perY = 100 / size.h;
        if (media) {
          // ±1 is a fifth of the artwork's frame either way — see `offsetPerPixel` in the tile editor.
          const frame = read(`${slot} [data-part="media"]`) ?? read(`${slot} .tile__media`) ?? from;
          perX = frame.w > 0 ? 1 / (frame.w * 0.2) : 0;
          perY = frame.h > 0 ? 1 / (frame.h * 0.2) : 0;
        }
        updatePart(offerId, part, {
          offsetX: clamp(now.offsetX + (to.x - from.x) * perX, -reach, reach),
          offsetY: clamp(now.offsetY + (to.y - from.y) * perY, -reach, reach),
          ...(from.w > 0 && Math.abs(to.w - from.w) > 0.01 ? { scale: clamp(now.scale * (to.w / from.w), minScale, maxScale) } : {}),
        }, gesture);
      },
    }} />
  );
}

/** The boxes the tile is built from, and the sliders for the one in hand. */
export function PartsPanel({ offer, overrides, onPage, slotId, held }: { offer: Offer; overrides: PlacementOverrides; onPage: CatalogPage | undefined; slotId: string; held: TilePart }) {
  const { selectedPart, selectPart, setPartHidden, resetTile, resetPart, updatePart } = useStudioPick('selectedPart', 'selectPart', 'setPartHidden', 'resetTile', 'resetPart', 'updatePart');
  const geometry = partOverride(overrides, held);
  const limits = partLimits(held);
  const arranged = TILE_PARTS.some((part) => partTouched(overrides, part));
  return (
    <>
      <h3 className="inspector__group">
        Elementer
        {arranged && (
          <button className="inspector__link" onClick={() => resetTile(offer.id)}>
            Nulstil alle
          </button>
        )}
      </h3>

      {/*
        * Every box the tile draws, in the order it draws them.
        *
        * The panel lists them rather than only showing the one in hand,
        * because a box that has been taken off the page cannot be
        * clicked to get it back — and a hidden element with no way home
        * is a destructive edit wearing the clothes of a reversible one.
        */}
      <ul className="inspector__parts">
        {TILE_PARTS.map((part) => {
          const state = partOverride(overrides, part);
          const held = selectedPart === part || (selectedPart === null && part === 'media');
          return (
            <li
              key={part}
              className={[
                'inspector__part',
                held && 'is-held',
                state.hidden && 'is-hidden',
              ].filter(Boolean).join(' ')}
            >
              <button
                className="inspector__part-name"
                onClick={() => selectPart(part === 'media' ? null : part)}
              >
                {TILE_PART_NAMES[part]}
                {partTouched(overrides, part) && <i aria-hidden="true">•</i>}
              </button>
              {part !== 'media' && (
                <button
                  className="inspector__part-eye"
                  title={state.hidden ? 'Vis igen' : 'Tag af siden'}
                  aria-label={state.hidden ? 'Vis igen' : 'Tag af siden'}
                  onClick={() => setPartHidden(offer.id, part, !state.hidden)}
                >{state.hidden ? '◌' : '●'}</button>
              )}
            </li>
          );
        })}
      </ul>
      {onPage && <PartMeasure pageId={onPage.id} slotId={slotId} offerId={offer.id} part={held} />}

      {/*
        * The four sliders for the variant in hand.
        *
        * Drawn instead of the box's own, not beside them: with a
        * product picked up, "size" means that product, and two panels
        * both called Størrelse is the ambiguity this panel exists to
        * remove.
        */}
      <h3 className="inspector__group">
        {TILE_PART_NAMES[held]}
        {partTouched(overrides, held) && (
          <button className="inspector__link" onClick={() => resetPart(offer.id, held)}>
            Nulstil
          </button>
        )}
      </h3>

      <label className="inspector__field">
        <span>Størrelse <b>{geometry.scale.toFixed(2)}×</b></span>
        <input
          type="range" min={limits.minScale} max={limits.maxScale} step={0.01}
          value={geometry.scale}
          onChange={(e) => updatePart(offer.id, held, { scale: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Vandret <b>{geometry.offsetX.toFixed(2)}</b></span>
        <input
          type="range" min={-limits.reach} max={limits.reach} step={limits.step}
          value={geometry.offsetX}
          onChange={(e) => updatePart(offer.id, held, { offsetX: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Lodret <b>{geometry.offsetY.toFixed(2)}</b></span>
        <input
          type="range" min={-limits.reach} max={limits.reach} step={limits.step}
          value={geometry.offsetY}
          onChange={(e) => updatePart(offer.id, held, { offsetY: Number(e.target.value) })}
        />
      </label>

      {/* Only for the boxes that keep their words on themselves. The
          headline and the underline have their own fields above, and
          the price and the certification marks are not captions. */}
      {REWRITABLE.includes(held) && (
        <label className="inspector__field">
          <span>Tekst</span>
          <input
            type="text"
            value={geometry.text ?? ''}
            placeholder="feedets egen"
            onChange={(e) => updatePart(offer.id, held, { text: e.target.value })}
          />
          <small>
            Tom = linjen falder væk.{' '}
            {geometry.text !== null && (
              <button
                className="inspector__link"
                onClick={() => updatePart(offer.id, held, { text: null })}
              >Hent feedets tekst</button>
            )}
          </small>
        </label>
      )}
    </>
  );
}
