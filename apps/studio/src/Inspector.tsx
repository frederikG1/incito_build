import { useStudio } from './state.js';

/**
 * The per-tile panel.
 *
 * These edits are the "human finesse" the pipeline must not overwrite:
 * they live on the placement as overrides, so regenerating the geometry
 * does not silently discard a headline someone rewrote by hand.
 */
export function Inspector() {
  const { document, selectedOfferId, updateOverrides, select } = useStudio();

  if (!document || !selectedOfferId) {
    return (
      <aside className="inspector inspector--empty">
        <p>Klik på en vare for at rette den.</p>
      </aside>
    );
  }

  const offer = document.offers.find((o) => o.id === selectedOfferId);
  const placement = document.pages
    .flatMap((page) => page.placements)
    .find((p) => p.offerId === selectedOfferId);

  if (!offer || !placement) {
    return (
      <aside className="inspector inspector--empty">
        <p>Varen er ikke længere på en side.</p>
      </aside>
    );
  }

  const { overrides } = placement;

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>{offer.name}</h2>
        <button className="inspector__close" onClick={() => select(null)} aria-label="Luk">×</button>
      </header>

      <dl className="inspector__facts">
        <dt>Pris</dt><dd>{offer.price.toFixed(2)} {offer.currency}</dd>
        <dt>Kategori</dt><dd>{offer.category}</dd>
        <dt>Varenr.</dt><dd>{offer.id}</dd>
      </dl>

      <label className="inspector__field">
        <span>Overskrift på tilen</span>
        <input
          type="text"
          value={overrides.displayName ?? ''}
          placeholder={offer.name}
          onChange={(e) =>
            updateOverrides(offer.id, { displayName: e.target.value || null })}
        />
      </label>

      <label className="inspector__field">
        <span>Billedstørrelse {overrides.imageScale.toFixed(2)}×</span>
        <input
          type="range" min={0.5} max={2} step={0.05}
          value={overrides.imageScale}
          onChange={(e) => updateOverrides(offer.id, { imageScale: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Vandret forskydning</span>
        <input
          type="range" min={-1} max={1} step={0.05}
          value={overrides.imageOffsetX}
          onChange={(e) => updateOverrides(offer.id, { imageOffsetX: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Lodret forskydning</span>
        <input
          type="range" min={-1} max={1} step={0.05}
          value={overrides.imageOffsetY}
          onChange={(e) => updateOverrides(offer.id, { imageOffsetY: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__check">
        <input
          type="checkbox"
          checked={overrides.pinned}
          onChange={(e) => updateOverrides(offer.id, { pinned: e.target.checked })}
        />
        <span>Fastlås — må ikke flyttes ved næste generering</span>
      </label>
    </aside>
  );
}
