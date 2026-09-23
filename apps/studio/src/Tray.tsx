import { useMemo, useState } from 'react';
import type { Offer } from '@incitio/schema';
import { formatPrice } from '@incitio/renderer';
import { count, isVariantPiece, useStudio } from './state.js';

/**
 * What has not been placed, on a shelf beside the page.
 *
 * Only inside a page: products are placed on a sheet, and the book view
 * is for looking at the avis. A column rather than a strip along the
 * bottom, two cards to a row, so more products are in view per scroll
 * and the sheet keeps its full height.
 *
 * The three answers to a selection the library always had are at the
 * foot: `Nye pladser` (a cell each), `Saml i pladsen` (all in one
 * cell) and `Saml og stil op` (one cell, arranged by the model).
 * Dragging still works, and dragging a picked card brings the pick.
 */

/** What a tray card carries when it is dragged. */
export const OFFER_MIME = 'application/x-incitio-offer';

/**
 * The products a drop brings: the one dragged, or — when it is one of
 * several picked — the whole pick, so "pick three, drag one" moves all
 * three, the way a file manager moves a selection.
 */
export function droppedOffers(dragged: string, picked: string[]): string[] {
  return picked.includes(dragged) && picked.length > 1 ? picked : [dragged];
}

/** A product as a card on the shelf. */
function Good({ offer }: { offer: Offer }) {
  const picked = useStudio((s) => s.librarySelection.includes(offer.id));
  const toggle = useStudio((s) => s.toggleLibraryPick);

  return (
    <button
      className={`good${picked ? ' good--picked' : ''}`}
      draggable
      aria-pressed={picked}
      title={`${offer.name}\n${offer.description}`}
      onDragStart={(event) => {
        // The page and the cell both read this — see `Book` and
        // `TileEditor`. Plain text as well, because some browsers
        // refuse a drag that carries nothing they recognise.
        event.dataTransfer.setData(OFFER_MIME, offer.id);
        event.dataTransfer.setData('text/plain', offer.name);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => toggle(offer.id)}
    >
      <span className="good__shot">
        {offer.imageUrl
          ? <img src={offer.imageUrl} alt="" loading="lazy" draggable={false} />
          : <span>uden billede</span>}
      </span>
      <span className="good__name">{offer.name}</span>
      <b className="good__price">{formatPrice(offer.price, offer.currency)}</b>
    </button>
  );
}

export function Tray() {
  const s = useStudio();
  const feedOffers = useStudio((state) => state.feedOffers);
  const document = useStudio((state) => state.document);
  const placedAt = useStudio((state) => state.placedAt);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);

  /*
   * The feed's products, then any the document has that the feed does
   * not — after an import by link there is no feed at all and the
   * document is the whole list.
   */
  const all = useMemo(() => {
    const seen = new Set(feedOffers.map((offer) => offer.id));
    return [...feedOffers, ...(document?.offers ?? []).filter((offer) => !seen.has(offer.id))]
      .filter((offer) => !isVariantPiece(offer.id));
  }, [feedOffers, document]);

  const placed = useMemo(() => placedAt(), [document, placedAt]);

  /* Only what is NOT on a page — that is what the shelf is for. */
  const unplaced = useMemo(() => all.filter((offer) => !placed.has(offer.id)), [all, placed]);
  const waiting = useMemo(() => {
    const needle = s.librarySearch.trim().toLowerCase();
    return unplaced
      .filter((offer) => (s.trayFilter ? offer.category === s.trayFilter : true))
      .filter((offer) => (needle
        ? `${offer.brand} ${offer.name} ${offer.description}`.toLowerCase().includes(needle)
        : true));
  }, [unplaced, s.librarySearch, s.trayFilter]);

  const categories = useMemo(
    () => [...new Set(unplaced.map((o) => o.category))]
      .filter(Boolean).sort((a, b) => a.localeCompare(b, 'da')),
    [unplaced],
  );

  const picked = s.librarySelection;
  const pageId = s.openPageId;

  /*
   * Which cell "Saml i pladsen" means: the tile selected on the sheet
   * when there is one — that is the cell being pointed at — otherwise
   * the first empty cell, otherwise the first. The select lets it be
   * named outright.
   */
  const slots = pageId ? s.pageSlots(pageId) : [];
  const page = document?.pages.find((entry) => entry.id === pageId);
  const selectedSlot = page?.placements.find((p) => p.offerId === s.selectedOfferId)?.slotId;
  const emptySlot = slots.find((slot) => slot.label.endsWith('tom'))?.slotId;
  const slotId = (chosenSlot && slots.some((slot) => slot.slotId === chosenSlot) ? chosenSlot : null)
    ?? selectedSlot ?? emptySlot ?? slots[0]?.slotId ?? '';
  const busy = Boolean(s.busy);

  return (
    <aside className="shelf">
      <div className="shelf__head">
        <b>Ikke placeret</b>
        <span className="shelf__count">{waiting.length} af {unplaced.length}</span>
      </div>
      <div className="shelf__tools">
        <input
          className="shelf__find"
          value={s.librarySearch}
          placeholder="søg i varerne"
          onChange={(event) => s.setLibrarySearch(event.target.value)}
        />
        <select
          className="shelf__filter"
          value={s.trayFilter ?? ''}
          onChange={(event) => s.setTrayFilter(event.target.value || null)}
        >
          <option value="">Alle grupper</option>
          {categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>
      <p className="shelf__hint">Klik for at vælge flere · træk ind på siden</p>

      {/* Two to a row: twice the products per screen, so finding one is
          half the scrolling. */}
      <div className="shelf__grid">
        {waiting.length === 0
          ? <p className="shelf__empty">{unplaced.length === 0 ? 'Alle varer har en plads.' : 'Ingen varer passer til søgningen.'}</p>
          : waiting.map((offer) => <Good key={offer.id} offer={offer} />)}
      </div>

      {/*
        * What to do with a selection — pinned to the foot of the shelf,
        * only while something is picked. The three ways the library
        * always had: a cell each, all in one cell, or all in one cell
        * stood up by the model.
        */}
      {picked.length > 0 && (
        <div className="shelf__picked">
          <div className="shelf__pickedhead">
            <b>{count(picked.length, 'vare valgt', 'varer valgt')}</b>
            <button className="inspector__link" onClick={s.clearLibraryPicks}>Ryd</button>
          </div>
          <button
            className="shelf__do"
            disabled={busy || !pageId}
            title="Hver vare får sin egen plads — siden får flere celler, hvis den mangler"
            onClick={() => { if (pageId) s.addOffersToPage(pageId, picked); }}
          >
            Nye pladser <i>en plads hver</i>
          </button>
          <div className="shelf__row">
            <select
              value={slotId}
              disabled={slots.length === 0}
              onChange={(event) => setChosenSlot(event.target.value)}
              title="Hvilken plads varerne samles i"
            >
              {slots.length === 0 && <option value="">ingen pladser</option>}
              {slots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{slot.label}</option>
              ))}
            </select>
            <button
              className="shelf__do"
              disabled={busy || !pageId || !slotId || picked.length > 8}
              title={picked.length > 8
                ? 'En plads kan bære otte varer'
                : 'Alle de valgte i én plads — én pris, én overskrift'}
              onClick={() => { if (pageId && slotId) void s.fillSlot(pageId, slotId, picked); }}
            >
              Saml i pladsen
            </button>
          </div>
          {picked.length > 1 && (
            <button
              className="shelf__model"
              disabled={busy || !pageId || !slotId || !s.decorReady || picked.length > 8}
              title={s.decorReady
                ? 'Varerne i pladsen, og billedmodellen stiller dem op som en avis'
                : 'Kræver en Gemini-nøgle — indsæt den under Billeder'}
              onClick={() => { if (pageId && slotId) void s.composeSlot(pageId, slotId, picked); }}
            >
              Saml og stil op <i>model</i>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
