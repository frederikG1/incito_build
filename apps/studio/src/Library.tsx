import { useMemo, useState } from 'react';
import type { Offer } from '@incitio/schema';
import { formatPrice } from '@incitio/renderer';
import { count, useStudio } from './state.js';

/**
 * What is in the file, as a deck of cards.
 *
 * An uploaded feed used to be invisible: a string the studio held until
 * something was generated from it, so the first sight of the week's
 * products was after a rebuild had been paid for. This is the products
 * themselves — a picture, a name, a price — grouped the way the feed
 * groups them, searchable, and draggable onto a page by hand.
 *
 * It lists the document's own offers as well as the feed's, because
 * after a publication is imported by link there is no feed at all and
 * the document IS the product list. Deduplicated by id, feed first.
 */

/** One heading in the library, and the products under it. */
interface Group {
  name: string;
  offers: Offer[];
}

/**
 * The products, grouped by whatever the feed calls a category.
 *
 * Alphabetical rather than by size: the list is something people scan
 * for a known product, and a list that reorders itself when next week's
 * file has more dairy in it cannot be scanned twice the same way.
 * "uncategorised" sinks to the bottom, where an unnamed pile belongs.
 */
function grouped(offers: Offer[], query: string): Group[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? offers.filter((offer) => `${offer.brand} ${offer.name} ${offer.description}`
      .toLowerCase().includes(needle))
    : offers;

  const buckets = new Map<string, Offer[]>();
  for (const offer of matching) {
    const key = offer.category || 'uden kategori';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(offer);
    else buckets.set(key, [offer]);
  }

  return [...buckets.entries()]
    .map(([name, list]) => ({ name, offers: list }))
    .sort((a, b) => {
      const anon = (name: string) => (name === 'uncategorised' || name === 'uden kategori' ? 1 : 0);
      return anon(a.name) - anon(b.name) || a.name.localeCompare(b.name, 'da');
    });
}

function Card({ offer, placedOn }: { offer: Offer; placedOn: string | null }) {
  const picked = useStudio((s) => s.librarySelection.includes(offer.id));
  const activePageId = useStudio((s) => s.activePageId);
  const toggle = useStudio((s) => s.toggleLibraryPick);
  const add = useStudio((s) => s.addOffersToPage);

  return (
    <li className={`card${picked ? ' card--picked' : ''}${placedOn ? ' card--placed' : ''}`}>
      {/*
        * The whole card ticks it, and a click TOGGLES rather than
        * replacing the selection. A checkbox with a 12px hit area beside
        * a 40px picture is a target people miss, and this list exists to
        * pick several — a click that silently unpicked the last five
        * would make the multi-select unusable. One product on its own
        * does not need the selection at all: that is the `+`.
        */}
      <button
        className="card__body"
        title={`${offer.name}\n${offer.description}`}
        aria-pressed={picked}
        onClick={() => toggle(offer.id)}
      >
        <span className="card__shot">
          {offer.imageUrl
            ? <img src={offer.imageUrl} alt="" loading="lazy" draggable={false} />
            /* Said, not left blank: an offer with no photograph cannot
               stand in for a product in print, and that is the single
               most useful thing to know about it here. */
            : <span className="card__none">uden billede</span>}
        </span>
        <span className="card__name">{offer.name}</span>
        <span className="card__price">{formatPrice(offer.price, offer.currency)}</span>
      </button>

      {placedOn
        ? <span className="card__where" title={`Ligger allerede på ${placedOn}`}>{placedOn}</span>
        : (
          <button
            className="card__add"
            title={activePageId ? 'Læg denne vare på den valgte side' : 'Vælg en side først'}
            disabled={!activePageId}
            onClick={() => { if (activePageId) add(activePageId, [offer.id]); }}
          >+</button>
        )}
    </li>
  );
}

export function Library() {
  const open = useStudio((s) => s.libraryOpen);
  const setOpen = useStudio((s) => s.setLibraryOpen);
  const feedOffers = useStudio((s) => s.feedOffers);
  const reading = useStudio((s) => s.feedReading);
  const document = useStudio((s) => s.document);
  const search = useStudio((s) => s.librarySearch);
  const setSearch = useStudio((s) => s.setLibrarySearch);
  const picked = useStudio((s) => s.librarySelection);
  const clear = useStudio((s) => s.clearLibraryPicks);
  const add = useStudio((s) => s.addOffersToPage);
  const activePageId = useStudio((s) => s.activePageId);
  const setActivePage = useStudio((s) => s.setActivePage);
  const closed = useStudio((s) => s.libraryClosedGroups);
  const toggleGroup = useStudio((s) => s.toggleLibraryGroup);
  const fill = useStudio((s) => s.fillSlot);
  const note = useStudio((s) => s.arrangeNote);
  const setNote = useStudio((s) => s.setArrangeNote);
  const busy = useStudio((s) => Boolean(s.busy));
  const decorReady = useStudio((s) => s.decorReady);
  const pageSlots = useStudio((s) => s.pageSlots);
  const selectedOfferId = useStudio((s) => s.selectedOfferId);

  /*
   * The feed's products first, then any the document has that the feed
   * does not. After an import by link there is no feed at all and the
   * document is the whole list; after an upload the two overlap, and the
   * feed's copy is the current one.
   */
  const offers = useMemo(() => {
    const seen = new Set(feedOffers.map((offer) => offer.id));
    return [...feedOffers, ...(document?.offers ?? []).filter((offer) => !seen.has(offer.id))];
  }, [feedOffers, document]);

  /** Which page, if any, is already showing each product. */
  const placed = useMemo(() => {
    const map = new Map<string, string>();
    document?.pages.forEach((page, index) => {
      for (const placement of page.placements) map.set(placement.offerId, `s. ${index + 1}`);
    });
    return map;
  }, [document]);

  const groups = useMemo(() => grouped(offers, search), [offers, search]);
  const searching = search.trim() !== '';

  /*
   * Which cell "Saml i pladsen" means.
   *
   * The tile selected on the canvas, when one is — that is the cell the
   * person is pointing at, and asking them to name it again in a
   * dropdown they are not looking at is how a control gets ignored.
   * Otherwise the first empty cell, and otherwise the first.
   */
  const slots = activePageId ? pageSlots(activePageId) : [];
  const page = document?.pages.find((entry) => entry.id === activePageId);
  const selectedSlot = page?.placements.find((p) => p.offerId === selectedOfferId)?.slotId;
  const empty = slots.find((slot) => slot.label.endsWith('tom'))?.slotId;
  const [chosen, setSlot] = useState<string | null>(null);
  const slotId = (chosen && slots.some((slot) => slot.slotId === chosen) ? chosen : null)
    ?? selectedSlot ?? empty ?? slots[0]?.slotId ?? '';
  const pages = (document?.pages ?? [])
    .map((page, index) => ({ page, number: index + 1 }))
    .filter((entry) => entry.page.kind === 'offers');

  if (!open) {
    return (
      <button className="library__tab" onClick={() => setOpen(true)} title="Vis varerne i feedet">
        Varer{offers.length > 0 ? ` (${offers.length})` : ''}
      </button>
    );
  }

  return (
    <aside className="library">
      <header className="library__head">
        <strong>Varer</strong>
        <span className="library__said">
          {reading
            ? `${reading.source.name} · ${offers.length} · ${reading.withImage} med billede`
            : `${offers.length} i avisen`}
        </span>
        <button className="library__close" title="Skjul listen" onClick={() => setOpen(false)}>×</button>
      </header>

      <input
        className="library__search"
        value={search}
        placeholder="søg i varerne…"
        onChange={(event) => setSearch(event.target.value)}
      />

      {offers.length === 0 && (
        <p className="library__empty">
          Upload denne uges feed, eller hent en udgivelse via link — så står varerne her.
        </p>
      )}

      <div className="library__list">
        {groups.map((group) => {
          /*
           * A search opens everything it found.
           *
           * Folding is about a feed you are working through, not about
           * a query: a hit hidden inside a folded group is a search that
           * says "nothing here" while holding the answer.
           */
          const open = searching || !closed.includes(group.name);
          return (
            <section className="library__group" key={group.name}>
              <h4>
                <button
                  className="library__fold"
                  aria-expanded={open}
                  title={open ? 'Fold gruppen sammen' : 'Fold gruppen ud'}
                  onClick={() => toggleGroup(group.name)}
                >
                  <span className="library__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  {group.name}
                  <span>{group.offers.length}</span>
                </button>
              </h4>
              {open && (
                <ul>
                  {group.offers.map((offer) => (
                    <Card key={offer.id} offer={offer} placedOn={placed.get(offer.id) ?? null} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/*
        * The bar only exists while something is ticked.
        *
        * It is the one control that acts on several products at once,
        * and a permanently visible "add 0 products" is the kind of
        * disabled button people stop reading.
        *
        * Two rows, because there are two genuinely different answers to
        * "put these on the page" and neither is a variant of the other:
        * give each product a cell of its own and let the grid grow, or
        * put them all in ONE cell the page already has. The second is
        * the only one that leaves a printed layout where it was.
        */}
      {picked.length > 0 && (
        <footer className="library__act">
          <div className="library__act-row">
            <label className="field">
              <span>Til side</span>
              <select
                value={activePageId ?? ''}
                onChange={(event) => setActivePage(event.target.value || null)}
              >
                {pages.length === 0 && <option value="">ingen sider</option>}
                {pages.map((entry) => (
                  <option key={entry.page.id} value={entry.page.id}>
                    {entry.number}{entry.page.title ? ` · ${entry.page.title}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={clear} title="Fjern markeringen">Ryd</button>
          </div>

          <button
            className="primary"
            disabled={!activePageId}
            title="Hver vare får sin egen plads — siden får flere celler, hvis den mangler"
            onClick={() => { if (activePageId) add(activePageId, picked); }}
          >
            Nye pladser · {count(picked.length, 'vare', 'varer')}
          </button>

          {/*
            * Filling a cell needs to know WHICH cell, and there is no
            * sensible default: the page is somebody's design and the
            * one they mean is the one they are looking at. The picker
            * follows the selection on the canvas when there is one.
            */}
          <div className="library__act-row">
            <label className="field">
              <span>I plads</span>
              <select
                value={slotId}
                disabled={slots.length === 0}
                onChange={(event) => setSlot(event.target.value)}
              >
                {slots.length === 0 && <option value="">ingen pladser</option>}
                {slots.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>{slot.label}</option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !activePageId || !slotId || picked.length > 8}
              title={picked.length > 8
                ? 'En plads kan bære otte varer'
                : 'Samme layout — modellen ser varerne og sætter dem op som en avis.'
                  + ' Hver vare kan stadig flyttes for sig.'}
              onClick={() => {
                if (activePageId && slotId) void fill(activePageId, slotId, picked);
              }}
            >
              Saml i pladsen
            </button>
          </div>

          {/*
            * The second way to fill the cell, and it is a different
            * thing rather than a setting on the first — so it is its
            * own button with its own sentence under it. One gives
            * cutouts you can move one at a time; this gives a
            * photograph that looks like a printed page and cannot be
            * taken apart again.
            */}
          {picked.length > 1 && (
            <>
              <button
                className="library__compose"
                disabled={busy || !activePageId || !slotId || !decorReady || picked.length > 8}
                title={decorReady
                  ? 'Billedmodellen fotograferer varerne sammen — ét billede, som en avis'
                  : 'Kræver GEMINI_API_KEY i .env'}
                onClick={() => {
                  if (activePageId && slotId) {
                    void fill(activePageId, slotId, picked, { compose: true });
                  }
                }}
              >
                Saml som ét fotografi
              </button>
              <p className="library__aside">
                {decorReady
                  ? 'Ét billede af varerne sammen. Kan ikke redigeres vare for vare bagefter.'
                  : 'Kræver GEMINI_API_KEY og fakturering på Google-projektet.'}
              </p>
            </>
          )}

          {/*
            * A steer for the model that sets the group up, and nothing
            * more: it never reaches the page. Shown only where it
            * applies — two or more products in one cell is the only
            * case anybody is arranged.
            */}
          {picked.length > 1 && (
            <input
              className="library__note"
              value={note}
              placeholder="retning, fx “osten forrest” (valgfri)"
              title="Gives til modellen der sætter varerne op"
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </footer>
      )}
    </aside>
  );
}
