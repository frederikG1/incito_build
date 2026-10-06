import { packLimits, packOverride, packTouched } from '@incitio/schema';
import type { Offer, PlacementOverrides } from '@incitio/schema';
import { useStudio } from '../state.js';

/**
 * Every product's depth in one cluster, so "in front" means in front of
 * THESE. A pack nobody has ordered reads as a row of zeros, which is
 * what makes the first press land on 1 rather than on nothing.
 */
function packDepths(overrides: PlacementOverrides, count: number): number[] {
  return Array.from({ length: Math.max(count, 1) }, (_, index) => (
    packOverride(overrides, index).depth
  ));
}

/** The products in a cluster tile, and the one in hand. */
export function PackPanel({ offer, overrides }: { offer: Offer; overrides: PlacementOverrides }) {
  const { selectedPack, selectPackItem, setPackItemHidden, resetPackItem, updatePackItem, endGesture } = useStudio();
  return (
    <>
      {/*
        * The products in the tile, and then the one in hand — first,
        * before anything else the panel can do.
        *
        * They used to sit two thirds of the way down, under the page's
        * texts, the page's ground and the page's background picture. A
        * person clicks a VARE and the panel answered with questions
        * about the sheet: everything about the thing they had just
        * pointed at was below the fold. Now the panel opens with what
        * is in the tile, which of them is in hand, and what can be done
        * to it — and the page's own settings wait at the bottom, where
        * something you change once per sheet belongs.
        */}
      {offer.imagePack.length > 1 && (
        <>
          <h3 className="inspector__group">
            Varer i flisen
            <span className="inspector__count">{offer.imagePack.length}</span>
          </h3>
          <ul className="inspector__pack">
            {offer.imagePack.map((url, index) => {
              const state = packOverride(overrides, index);
              const member = offer.members[index];
              return (
                <li
                  key={`${index}-${url}`}
                  className={[
                    'inspector__packitem',
                    selectedPack === index && 'is-held',
                    state.hidden && 'is-hidden',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    className="inspector__packshot"
                    title={member ? `Vare ${index + 1} · ${member}` : `Vare ${index + 1}`}
                    onClick={() => selectPackItem(selectedPack === index ? null : index)}
                  >
                    <img src={url} alt="" />
                    {packTouched(overrides, index) && <i aria-hidden="true">•</i>}
                  </button>
                  <button
                    className="inspector__part-eye"
                    title={state.hidden ? 'Vis igen' : 'Tag af siden'}
                    aria-label={state.hidden ? 'Vis igen' : 'Tag af siden'}
                    onClick={() => setPackItemHidden(offer.id, index, !state.hidden)}
                  >{state.hidden ? '◌' : '●'}</button>
                </li>
              );
            })}
          </ul>
          <p className="inspector__packsay">
            {selectedPack === null
              ? 'Klik en vare for at flytte, skalere eller lægge den forrest.'
              : `Vare ${selectedPack + 1} er i hånden — rettelserne står herunder.`}
          </p>
        </>
      )}

      {selectedPack !== null && offer.imagePack[selectedPack] !== undefined && (
        <>
          <h3 className="inspector__group">
            Vare {selectedPack + 1}
            {packTouched(overrides, selectedPack) && (
              <button
                className="inspector__link"
                onClick={() => resetPackItem(offer.id, selectedPack)}
              >Nulstil</button>
            )}
          </h3>
          {(() => {
            const state = packOverride(overrides, selectedPack);
            const limit = packLimits();
            const set = (patch: Partial<typeof state>) =>
              updatePackItem(offer.id, selectedPack, patch);
            return (
              <>
                {/*
                  * Which product stands in front.
                  *
                  * Buttons and not a slider: nobody thinks "layer
                  * three", they think "the pears in front of the kale".
                  * Each press moves this product one step past the
                  * product that is currently nearest the front, or
                  * behind the one furthest back — see
                  * `PackOverride.depth`.
                  */}
                <div className="inspector__field">
                  <span>Foran eller bag de andre</span>
                  <div className="segment" role="group" aria-label="Dybde">
                    <button
                      className={state.depth > 0 ? 'is-on' : ''}
                      title="Stil varen foran de andre"
                      onClick={() => set({ depth: Math.min(
                        limit.depth,
                        Math.max(...packDepths(overrides, offer.imagePack.length)) + 1,
                      ) })}
                    >Forrest</button>
                    <button
                      className={state.depth === 0 ? 'is-on' : ''}
                      title="Lad stilarket bestemme — den midterste vare står forrest"
                      onClick={() => set({ depth: 0 })}
                    >Auto</button>
                    <button
                      className={state.depth < 0 ? 'is-on' : ''}
                      title="Stil varen bag de andre"
                      onClick={() => set({ depth: Math.max(
                        -limit.depth,
                        Math.min(...packDepths(overrides, offer.imagePack.length)) - 1,
                      ) })}
                    >Bagest</button>
                  </div>
                </div>

                <label className="inspector__field">
                  <span>Størrelse <b>{state.scale.toFixed(2)}×</b></span>
                  <input
                    type="range" min={limit.minScale} max={limit.maxScale} step={0.01}
                    value={state.scale}
                    onChange={(e) => set({ scale: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                <label className="inspector__field">
                  <span>Vandret <b>{state.offsetX.toFixed(1)}</b></span>
                  <input
                    type="range" min={-limit.reach} max={limit.reach} step={limit.step}
                    value={state.offsetX}
                    onChange={(e) => set({ offsetX: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                <label className="inspector__field">
                  <span>Lodret <b>{state.offsetY.toFixed(1)}</b></span>
                  <input
                    type="range" min={-limit.reach} max={limit.reach} step={limit.step}
                    value={state.offsetY}
                    onChange={(e) => set({ offsetY: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                {/* The one box besides a decoration that may sit
                    off-square: a product pasted onto a page is what a
                    printed leaflet tilts, and nothing else. */}
                <label className="inspector__field">
                  <span>Drejning <b>{state.rotate.toFixed(0)}°</b></span>
                  <input
                    type="range" min={-limit.turn} max={limit.turn} step={1}
                    value={state.rotate}
                    onChange={(e) => set({ rotate: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
              </>
            );
          })()}
        </>
      )}
    </>
  );
}
