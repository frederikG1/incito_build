import type { CatalogPage, Offer, PlacementOverrides } from '@incitio/schema';
import { useStudio, useStudioPick } from '../state.js';
import { TilePrice } from './TilePrice.js';

/** What the tile says: its price, its words, and where it stands on the page. */
export function ContentPanel({ offer, overrides, onPage, leads }: { offer: Offer; overrides: PlacementOverrides; onPage: CatalogPage | undefined; leads: boolean }) {
  const { updateOverrides, focusOffer, removeOfferFromPage } = useStudioPick('updateOverrides', 'focusOffer', 'removeOfferFromPage');
  return (
    <>
      <TilePrice key={offer.id} offer={offer} />

      <h3 className="inspector__group">Tekst</h3>

      <label className="inspector__field">
        <span>Overskrift på flisen</span>
        <input
          type="text"
          value={overrides.displayName ?? ''}
          placeholder={offer.name}
          onChange={(e) =>
            updateOverrides(offer.id, { displayName: e.target.value || null })}
        />
        <small>Tom = varens egen tekst.</small>
      </label>

      <label className="inspector__field">
        <span>Underlinje</span>
        <input
          type="text"
          value={overrides.description ?? offer.description}
          placeholder={offer.description || 'ingen'}
          onChange={(e) => updateOverrides(offer.id, { description: e.target.value })}
        />
        <small>
          Tom = ingen underlinje.{' '}
          {overrides.description !== null && offer.description !== '' && (
            <button
              className="inspector__link"
              onClick={() => updateOverrides(offer.id, { description: null })}
            >Brug varens egen tekst</button>
          )}
        </small>
      </label>

      {/*
        * Promote this offer to its page's leading slot.
        *
        * It used to sit on every sheet's bar, where it acted on the
        * SELECTION and was therefore disabled on all but one sheet at a
        * time — a control that is grey on nine pages out of ten teaches
        * people to stop reading the row it is in. Here it is beside
        * everything else that acts on the selected offer, and it is
        * only drawn when there is a page it could move it on.
        */}
      {onPage && (
        <button
          className="inspector__promote"
          onClick={() => focusOffer(onPage.id, offer.id)}
          disabled={leads}
          title={leads
            ? 'Varen fører allerede siden'
            : 'Byt varen op i sidens hovedplads'}
        >
          {leads ? 'Fører siden' : 'Sæt i fokus'}
        </button>
      )}

      {/*
        * Take the product off the page.
        *
        * Not a deletion: it goes to the bench — every offer in the
        * document that no page shows — so it can be dealt out again
        * here or on another page, and the count in the toolbar says how
        * many are waiting. The cell it leaves stays empty rather than
        * the page reflowing, because a page somebody is editing should
        * not rearrange itself under their hands.
        */}
      {onPage && (
        <button
          className="inspector__drop"
          onClick={() => removeOfferFromPage(onPage.id, offer.id)}
          title="Varen bliver i avisen under Ikke placeret"
        >
          Tag af siden
        </button>
      )}

      <label className="inspector__check">
        <input
          type="checkbox"
          checked={overrides.pinned}
          onChange={(e) => updateOverrides(offer.id, { pinned: e.target.checked })}
        />
        <span>Lås varen på pladsen</span>
      </label>
    </>
  );
}
