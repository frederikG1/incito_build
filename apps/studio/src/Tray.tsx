import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Offer } from '@incitio/schema';
import { DEPARTMENTS, DEPARTMENT_NAMES, byImportance, departmentOf, type Department } from '@incitio/compose';
import { formatPrice, incitoSlotOf, pageBlocks, sizedImage } from '@incitio/renderer';
import { THUMB_PX, count, isVariantPiece, useStudio, useStudioPick } from './state.js';

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

type ShelfOrder = 'afdeling' | 'staerkest' | 'pris';

/*
 * The shelf's width, the reader's own: dragged at its edge, kept in this
 * browser. Columns follow the width — two at the narrowest, as many as
 * fit when it is pulled wide to see the whole week at once.
 */
const WIDTH_KEY = 'incitio.shelfWidth';
const NARROW = 272;
const WIDE = 600;
function rememberedWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY));
    return value >= 240 && value <= 900 ? value : NARROW;
  } catch {
    return NARROW;
  }
}

/** A product as a card on the shelf. */
/*
 * Memoised: the shelf holds the whole feed, and without it every product
 * in it was drawn again on every change anywhere — 4,800 of the 6,000
 * component renders ten arrow-key nudges caused. Its props are the offer
 * (the same object while the feed is) and two primitives.
 */
const Good = memo(function Good({ offer, where, must }: { offer: Offer; where?: string; must?: boolean }) {
  const picked = useStudio((s) => s.librarySelection.includes(offer.id));
  const toggle = useStudio((s) => s.toggleLibraryPick);

  return (
    <button
      className={`good${picked ? ' good--picked' : ''}${where ? ' good--placed' : ''}`}
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
      {where && <span className="good__where">{where}</span>}
      {must && <span className="good__must" title="Skal med i avisen">★</span>}
      <span className="good__shot">
        {offer.imageUrl
          ? <img src={sizedImage(offer.imageUrl, THUMB_PX)} alt="" loading="lazy" decoding="async" draggable={false} />
          : <span>uden billede</span>}
      </span>
      <span className="good__name">{offer.name}</span>
      <b className="good__price">{formatPrice(offer.price, offer.currency)}</b>
    </button>
  );
});

export function Tray() {
  const s = useStudioPick(
    'addOffersToPage', 'brand', 'busy', 'clearLibraryPicks', 'composeSlot', 'decorReady', 'fillSlot',
    'librarySearch', 'librarySelection', 'openPageId', 'pageSlots', 'selectedIncito', 'selectedOfferId',
    'setLibrarySearch', 'setTrayFilter', 'trayFilter'
  );
  const feedOffers = useStudio((state) => state.feedOffers);
  const document = useStudio((state) => state.document);
  const placedAt = useStudio((state) => state.placedAt);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [order, setOrder] = useState<ShelfOrder>('afdeling');
  const [showPlaced, setShowPlaced] = useState(false);
  const [width, setWidth] = useState(rememberedWidth);
  const dragging = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* private window */ }
  }, [width]);

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
  const must = useMemo(() => new Set(document?.mustInclude ?? []), [document]);

  /* What is NOT on a page is what the shelf is for; the rest on request, marked with its page. */
  const unplaced = useMemo(() => all.filter((offer) => !placed.has(offer.id)), [all, placed]);
  const departmentFor = useMemo(() => new Map(all.map((offer) => [offer.id, departmentOf(offer)])), [all]);
  const rules = s.brand?.offerRules;
  const waiting = useMemo(() => {
    const needle = s.librarySearch.trim().toLowerCase();
    const list = (showPlaced ? all : unplaced)
      .filter((offer) => (s.trayFilter ? departmentFor.get(offer.id) === s.trayFilter : true))
      .filter((offer) => (needle
        ? `${offer.brand} ${offer.name} ${offer.description}`.toLowerCase().includes(needle)
        : true));
    const strongest = byImportance(rules);
    if (order === 'pris') return [...list].sort((a, b) => a.price - b.price);
    if (order === 'staerkest') return [...list].sort(strongest);
    return [...list].sort((a, b) => DEPARTMENTS.indexOf(departmentFor.get(a.id)!) - DEPARTMENTS.indexOf(departmentFor.get(b.id)!)
      || strongest(a, b));
  }, [all, unplaced, showPlaced, s.librarySearch, s.trayFilter, departmentFor, order, rules]);

  /* The departments with something waiting, and how much. */
  const departments = useMemo(() => {
    const counts = new Map<Department, number>();
    for (const offer of unplaced) {
      const department = departmentFor.get(offer.id)!;
      counts.set(department, (counts.get(department) ?? 0) + 1);
    }
    return DEPARTMENTS.filter((department) => counts.has(department)).map((department) => ({ department, count: counts.get(department)! }));
  }, [unplaced, departmentFor]);

  /* Under a heading per department when sorted that way, one run otherwise. */
  const groups = useMemo(() => {
    if (order !== 'afdeling') return [{ department: null as Department | null, offers: waiting }];
    const out: { department: Department | null; offers: Offer[] }[] = [];
    for (const offer of waiting) {
      const department = departmentFor.get(offer.id)!;
      if (out.at(-1)?.department !== department) out.push({ department, offers: [] });
      out.at(-1)!.offers.push(offer);
    }
    return out;
  }, [waiting, order, departmentFor]);

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
  // The cell being pointed at: a tile in hand, or an element of a published offer.
  const incitoOffer = s.selectedIncito && page?.incito && s.selectedIncito.pageId === page.id
    ? pageBlocks({ ...page, incito: page.incito }, document?.offers ?? [], document?.templates.find((t) => t.id === page.templateId))
      .find((block) => block.path === s.selectedIncito!.path)?.offerId ?? null
    : null;
  const incitoSlot = incitoOffer && page ? incitoSlotOf(page, incitoOffer) : undefined;
  const selectedSlot = page?.placements.find((p) => p.offerId === s.selectedOfferId)?.slotId ?? incitoSlot;
  const emptySlot = slots.find((slot) => slot.label.endsWith('tom'))?.slotId;
  const slotId = (chosenSlot && slots.some((slot) => slot.slotId === chosenSlot) ? chosenSlot : null)
    ?? selectedSlot ?? emptySlot ?? slots[0]?.slotId ?? '';
  const busy = Boolean(s.busy);

  const idle = unplaced.length === 0 && !showPlaced && !s.librarySearch.trim();
  return (
    <aside className="shelf" style={{ flexBasis: width }}>
      <div
        className="shelf__resize"
        role="separator"
        aria-orientation="vertical"
        title="Træk for at gøre listen bredere — dobbeltklik skifter mellem smal og bred"
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          setWidth(Math.max(240, Math.min(900, dragging.current.width + event.clientX - dragging.current.x)));
        }}
        onPointerUp={() => { dragging.current = null; }}
        onDoubleClick={() => setWidth(width > (NARROW + WIDE) / 2 ? NARROW : WIDE)}
      />
      <div className="shelf__head">
        <b>Ugens varer</b>
        <span className="shelf__count">{unplaced.length === 0 ? 'alle har en plads' : waiting.length === unplaced.length ? `${unplaced.length} ikke placeret` : `${waiting.length} vist · ${unplaced.length} ikke placeret`}</span>
        <div className="shelf__gap" />
        <button
          className="shelf__widen"
          onClick={() => setWidth(width > (NARROW + WIDE) / 2 ? NARROW : WIDE)}
          title={width > (NARROW + WIDE) / 2 ? 'Smal liste' : 'Bred liste — flere varer på én gang'}
        >{width > (NARROW + WIDE) / 2 ? '‹ Smal' : 'Bred ›'}</button>
      </div>
      <div className="shelf__tools">
        {/* Nothing waiting and nothing asked for: search and sorting have nothing to work on. */}
        {(!idle) && <>
        <input
          className="shelf__find"
          value={s.librarySearch}
          placeholder="Søg efter en vare"
          onChange={(event) => s.setLibrarySearch(event.target.value)}
        />
        <div className="shelf__row">
          <select
            className="shelf__filter"
            value={s.trayFilter ?? ''}
            onChange={(event) => s.setTrayFilter(event.target.value || null)}
          >
            <option value="">Alle afdelinger · {unplaced.length}</option>
            {departments.map(({ department, count: n }) => (
              <option key={department} value={department}>{DEPARTMENT_NAMES[department]} · {n}</option>
            ))}
          </select>
          <select className="shelf__filter" value={order} onChange={(event) => setOrder(event.target.value as ShelfOrder)} title="Rækkefølge">
            <option value="afdeling">Efter afdeling</option>
            <option value="staerkest">Stærkeste først</option>
            <option value="pris">Laveste pris først</option>
          </select>
        </div>
        </>}
        <label className="shelf__check">
          <input type="checkbox" checked={showPlaced} onChange={(event) => setShowPlaced(event.target.checked)} />
          Vis også varer der er på en side
        </label>
      </div>
      {!idle && <p className="shelf__hint"><b>Træk</b> hen på siden · <b>klik</b> flere for at samle dem</p>}

      {/* As many to a row as the width holds — two at the narrowest. */}
      <div className="shelf__grid">
        {waiting.length === 0
          ? <p className="shelf__empty">{unplaced.length === 0 && !showPlaced ? 'Alle varer har en plads.' : 'Ingen varer passer til søgningen.'}</p>
          : groups.map((group) => (
            <div className="shelf__group" key={group.department ?? 'alle'}>
              {group.department && (
                <h4 className="shelf__dept">{DEPARTMENT_NAMES[group.department]} <span>{group.offers.length}</span></h4>
              )}
              {group.offers.map((offer) => <Good key={offer.id} offer={offer} where={placed.get(offer.id)} must={must.has(offer.id)} />)}
            </div>
          ))}
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

          {/*
            * The one thing somebody making next week's avis does all day:
            * put this product where that one was. First, largest, and
            * saying in words what will happen — the product takes the
            * cell and its layout, the old one goes to the reserve.
            */}
          <div className="put">
            <span className="put__label">Sæt ind på pladsen</span>
            <select
              className="put__slot"
              value={slotId}
              disabled={slots.length === 0}
              onChange={(event) => setChosenSlot(event.target.value)}
              title="Klik på en vare på siden for at vælge dens plads"
            >
              {slots.length === 0 && <option value="">ingen pladser på siden</option>}
              {slots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>{slot.label}</option>
              ))}
            </select>
            <button
              className="go put__go"
              disabled={busy || !pageId || !slotId || picked.length > 8}
              title={picked.length > 8 ? 'En plads kan bære otte varer' : ''}
              onClick={() => { if (pageId && slotId) void s.fillSlot(pageId, slotId, picked); }}
            >
              {picked.length === 1 ? 'Erstat' : `Saml ${picked.length} i pladsen`}
            </button>
            <span className="put__said">
              {picked.length === 1
                ? 'Varen overtager pladsen — den gamle kommer tilbage på listen.'
                : 'Ét samlet tilbud: én overskrift og den laveste pris med "fra".'}
            </span>
          </div>

          <p className="put__tip">Eller træk varen direkte hen på en vare på siden.</p>

          <div className="shelf__more">
            <button
              className="shelf__do"
              disabled={busy || !pageId}
              title="Hver vare får sin egen plads — siden får flere pladser, hvis den mangler"
              onClick={() => { if (pageId) s.addOffersToPage(pageId, picked); }}
            >
              Tilføj som nye pladser
            </button>
            {picked.length > 1 && (
              <button
                className="shelf__model"
                disabled={busy || !pageId || !slotId || !s.decorReady || picked.length > 8}
                title={s.decorReady
                  ? 'Varerne samles i pladsen, og AI stiller dem pænt op'
                  : 'AI-hjælpen er slået fra på denne maskine'}
                onClick={() => { if (pageId && slotId) void s.composeSlot(pageId, slotId, picked); }}
              >
                Saml og stil pænt op <i>AI</i>
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
