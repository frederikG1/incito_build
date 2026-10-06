import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isImagePage, type Brand, type CatalogDocument, type CatalogPage, type Offer } from '@incitio/schema';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { DEPARTMENT_NAMES } from '@incitio/compose';
import { THUMB_PX, departmentOfPage, useStudio } from './state.js';
import { slotResult, weeklyReach } from './signals.js';
import { slotsOf, templateOf, type SlotInfo } from './inventory.js';
import { n, pct, sum } from './format.js';
import { BoardHead, StandIn } from './Board.js';

/**
 * Pladser — the avis as places that are worth something.
 *
 * Every place on every page, shaded by how many people will see it,
 * with who has bought it. A buyer sells the front page's big place to a
 * supplier here; the place is then locked, the checks guard it, and
 * after the week the supplier gets the numbers it did. The worth of a
 * place is Tjek's data — a stand-in until it is connected, and said so.
 *
 * The pages are the expensive part (a full PageView each), so each
 * sheet is memoised on its own slots and on whether the selection is
 * on it: picking a place redraws the one or two sheets it touches.
 */

type Mode = 'plan' | 'resultat';

/** One ink, deeper for the places more people see. Sequential, not a rainbow. */
function heat(warmth: number): string {
  return `rgb(var(--heat-rgb) / ${(0.06 + warmth * 0.42).toFixed(3)})`;
}

export function SlotsBoard() {
  const { document, brand } = useStudio(useShallow((s) => ({ document: s.variantBase ?? s.document, brand: s.brand })));
  const published = document?.status === 'udgivet';
  const [chosenMode, setMode] = useState<Mode>(published ? 'resultat' : 'plan');
  // Before the week has run there is no result to show.
  const mode: Mode = published ? chosenMode : 'plan';
  const [selected, setSelected] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('alle');
  const [department, setDepartment] = useState<string>('');

  const slots = useMemo(() => (document && brand ? slotsOf(document, brand) : []), [document, brand]);
  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of document?.pages ?? []) {
      const said = isImagePage(page) ? null : departmentOfPage(document!, page.id);
      if (said) map.set(page.id, said);
    }
    return map;
  }, [document]);
  /*
   * What a buyer is looking for, not every place at once: the free ones,
   * the sold ones, the most seen, one department. A place that does not
   * match draws no mark; a page with none left is not shown.
   */
  const visible = useMemo(() => {
    const top = new Set([...slots].sort((a, b) => b.signal.views - a.signal.views)
      .slice(0, Math.max(10, Math.round(slots.length * 0.15))).map((slot) => slot.key));
    return slots.filter((slot) => (show === 'alle'
      || (show === 'ledige' && !slot.booking)
      || (show === 'solgte' && slot.booking)
      || (show === 'top' && !slot.booking && top.has(slot.key)))
      && (!department || departments.get(slot.pageId) === department));
  }, [slots, show, department, departments]);
  const filtering = show !== 'alle' || Boolean(department);
  const byPage = useMemo(() => {
    const map = new Map<string, SlotInfo[]>();
    for (const slot of visible) map.set(slot.pageId, [...(map.get(slot.pageId) ?? []), slot]);
    return map;
  }, [visible]);
  const offers = useMemo(() => new Map((document?.offers ?? []).map((offer) => [offer.id, offer])), [document?.offers]);
  const pick = useCallback((key: string) => setSelected(key), []);
  if (!document || !brand) return null;

  const sold = slots.filter((slot) => slot.booking);
  const income = sold.reduce((total, slot) => total + (slot.booking?.price ?? 0), 0);
  const chosen = slots.find((slot) => slot.key === selected) ?? null;

  return (
    <main className="book board slotsboard">
      <BoardHead
        title="Pladser"
        said={`${sold.length} af ${slots.length} pladser solgt · ${sum(income)} · ${n(weeklyReach(document.brandId))} læsere om ugen`}
      >
        <StandIn what="Eksempeltal" />
        {published && (
          <div className="seg" role="tablist" aria-label="Vis">
            <button className={mode === 'plan' ? 'is-on' : ''} onClick={() => setMode('plan')}>Plan</button>
            <button className={mode === 'resultat' ? 'is-on' : ''} onClick={() => setMode('resultat')}>Resultat</button>
          </div>
        )}
      </BoardHead>

      <div className="slotsboard__filter">
        <div className="seg" role="group" aria-label="Vis pladser">
          {SHOWS.map(([key, label]) => (
            <button key={key} className={show === key ? 'is-on' : ''} aria-pressed={show === key} onClick={() => setShow(key)}>
              {label}
            </button>
          ))}
        </div>
        {departments.size > 0 && (
          <select className="slotsboard__dept" value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Afdeling">
            <option value="">Alle afdelinger</option>
            {[...new Set(departments.values())].sort().map((key) => (
              <option key={key} value={key}>{DEPARTMENT_NAMES[key as keyof typeof DEPARTMENT_NAMES] ?? key}</option>
            ))}
          </select>
        )}
        {filtering && <span className="bsection__said">{visible.length} af {slots.length} pladser</span>}
      </div>

      <div className="slotsboard__body">
        <section className="slotsboard__pages" aria-label="Siderne med pladsernes værdi">
          {filtering && visible.length === 0 && <p className="slotpanel__muted">Ingen pladser passer.</p>}
          {document.pages.map((page, index) => (filtering && !byPage.has(page.id) ? null : (
            <Sheet
              key={page.id}
              page={page}
              index={index}
              document={document}
              brand={brand}
              offers={offers}
              slots={byPage.get(page.id) ?? EMPTY}
              selected={selected?.startsWith(`${page.id}/`) ? selected : null}
              mode={mode}
              onPick={pick}
            />
          )))}
          <div className="slotsboard__legend">
            <span>Færre ser den</span><i /><span>Flere ser den</span>
            <span className="slotsboard__key"><b>◆</b> solgt og låst</span>
          </div>
        </section>

        <aside className="slotsboard__side">
          {chosen
            ? <SlotPanel key={chosen.key} slot={chosen} mode={mode} document={document} onClose={() => setSelected(null)} />
            : <Overview slots={slots} mode={mode} document={document} onPick={pick} />}
        </aside>
      </div>

      <AllSlots slots={slots} mode={mode} document={document} selected={selected} onPick={pick} />
    </main>
  );
}

const EMPTY: SlotInfo[] = [];

type Show = 'alle' | 'ledige' | 'top' | 'solgte';
const SHOWS: [Show, string][] = [['alle', 'Alle'], ['ledige', 'Ledige'], ['top', 'Mest sete ledige'], ['solgte', 'Solgte']];

/** The places as a table — the same thing as the sheets, sortable; folded until asked for. */
function AllSlots({ slots, mode, document, selected, onPick }: {
  slots: SlotInfo[]; mode: Mode; document: CatalogDocument; selected: string | null; onPick: (key: string) => void;
}) {
  const [sort, setSort] = useState<'værdi' | 'side'>('værdi');
  const [open, setOpen] = useState(false);
  const ranked = useMemo(() => [...slots].sort((a, b) => (sort === 'værdi'
    ? b.signal.views - a.signal.views
    : a.pageIndex - b.pageIndex || b.signal.views - a.signal.views)), [slots, sort]);

  return (
    <details className="slotsboard__table" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><h3>Alle pladser</h3><span className="bsection__said">{slots.length} pladser som tabel</span></summary>
      {open && (
        <>
          <div className="seg slotsboard__sort">
            <button className={sort === 'værdi' ? 'is-on' : ''} onClick={() => setSort('værdi')}>Mest set</button>
            <button className={sort === 'side' ? 'is-on' : ''} onClick={() => setSort('side')}>Side for side</button>
          </div>
          <div className="rows slots" role="table">
            <div className="rows__head" role="row">
              <span>Plads</span><span>Vare nu</span>
              <span>{mode === 'plan' ? 'Forventet set' : 'Set'}</span>
              <span>{mode === 'plan' ? 'Klikrate' : 'Klik'}</span>
              <span>{mode === 'plan' ? 'Listepris' : 'På indkøbsliste'}</span>
              <span>Solgt til</span>
            </div>
            {ranked.map((slot) => {
              const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
              return (
                <button key={slot.key} role="row" className={slot.key === selected ? 'is-on' : ''} onClick={() => onPick(slot.key)}>
                  <span><i className="slotsboard__chip" style={{ background: heat(slot.warmth) }} />Side {slot.pageIndex + 1} · {slot.name}</span>
                  <span>{slot.offer?.name ?? <em>tom</em>}</span>
                  <span>{n(mode === 'plan' ? slot.signal.views : result.views)}</span>
                  <span>{mode === 'plan' ? pct(slot.signal.clickRate) : n(result.clicks)}</span>
                  <span>{mode === 'plan' ? sum(slot.signal.listPrice) : n(result.lists)}</span>
                  <span>{slot.booking ? <b>◆ {slot.booking.supplier}</b> : <em>ledig</em>}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </details>
  );
}

const Sheet = memo(function Sheet({ page, index, document, brand, offers, slots, selected, mode, onPick }: {
  page: CatalogPage;
  index: number;
  document: CatalogDocument;
  brand: Brand;
  offers: Map<string, Offer>;
  /** This page's places only. */
  slots: SlotInfo[];
  /** The selected place, when it is on this page. */
  selected: string | null;
  mode: Mode;
  onPick: (key: string) => void;
}) {
  const mine = useMemo(() => new Map(slots.map((slot) => [slot.slotId, slot])), [slots]);
  const template = isImagePage(page) ? undefined : templateOf(document, brand, page.templateId);

  const mark = (slot: SlotInfo, style?: CSSProperties) => {
    const views = mode === 'plan' ? slot.signal.views : slotResult(slot.signal, `${document.id}:${slot.key}`).views;
    return (
      <div
        key={slot.key}
        className={`heat${slot.key === selected ? ' is-on' : ''}${slot.booking ? ' is-sold' : ''}`}
        style={{ background: heat(slot.warmth), ...style }}
        onClick={(event) => { event.stopPropagation(); onPick(slot.key); }}
        title={`${slot.name} · ${n(views)} ${mode === 'plan' ? 'forventet set' : 'set'}`}
      >
        <span className="heat__n">{mode === 'plan' ? slot.index : `${n(Math.round(views / 1000))}k`}</span>
        {slot.booking && <span className="heat__sold">◆ {slot.booking.supplier}</span>}
      </div>
    );
  };
  const decorate = (slotId: string) => {
    const slot = mine.get(slotId);
    return slot ? mark(slot) : null;
  };
  /*
   * A page printed as published draws no cell for a place nobody has
   * filled, so nothing to decorate. Its places were measured off the
   * page, so they are laid over it where they were measured.
   */
  const unplaced = template
    ? template.slots.filter((slot) => slot.rect && !page.placements.some((p) => p.slotId === slot.id))
    : [];
  const department = isImagePage(page) ? null : departmentOfPage(document, page.id);

  return (
    <figure className="slotsheet">
      <div className="slotsheet__paper" style={{ background: page.ground ?? brand.tokens.ground, ['--aspect' as string]: String(brand.pageAspect) }}>
        <div className="slotsheet__live">
          <ImageSize.Provider value={THUMB_PX}>
            {isImagePage(page)
              ? <ImagePage page={page} brand={brand} pageIndex={index} pageNumber={index + 1} />
              : template
                ? <PageView page={page} template={template} brand={brand} offers={offers} pageIndex={index} pageNumber={index + 1} slotDecorator={decorate} />
                : null}
          </ImageSize.Provider>
        </div>
        {unplaced.length > 0 && (
          <div className="slotsheet__over">
            {unplaced.map((slot) => {
              const info = mine.get(slot.id);
              return info ? mark(info, {
                left: `${slot.rect!.x * 100}%`, top: `${slot.rect!.y * 100}%`,
                width: `${slot.rect!.w * 100}%`, height: `${slot.rect!.h * 100}%`, inset: 'auto',
              }) : null;
            })}
          </div>
        )}
      </div>
      <figcaption>{index + 1} · {page.title || (isImagePage(page) ? 'Billedside' : department ? DEPARTMENT_NAMES[department] : 'Blandet')}</figcaption>
    </figure>
  );
});

function Overview({ slots, mode, document, onPick }: {
  slots: SlotInfo[]; mode: Mode; document: CatalogDocument; onPick: (key: string) => void;
}) {
  const sold = slots.filter((slot) => slot.booking);
  const free = slots.filter((slot) => !slot.booking).sort((a, b) => b.signal.views - a.signal.views);
  const listValue = free.reduce((total, slot) => total + slot.signal.listPrice, 0);

  if (mode === 'resultat') {
    return (
      <div className="slotpanel">
        <h3>Resultat for leverandørerne</h3>
        {sold.length === 0 && <p className="slotpanel__muted">Ingen pladser er solgt i denne avis.</p>}
        {sold.map((slot) => {
          const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
          const hit = result.views / Math.max(1, slot.signal.views);
          return (
            <div key={slot.key} className="slotpanel__deal">
              <b>◆ {slot.booking!.supplier}</b>
              <span>Side {slot.pageIndex + 1} · {slot.offer?.name ?? 'tom'}</span>
              <span className="slotpanel__nums">
                {n(result.views)} set <em className={hit >= 1 ? 'up' : 'down'}>{hit >= 1 ? '+' : ''}{Math.round((hit - 1) * 100)} % mod plan</em>
                · {n(result.clicks)} klik · {n(result.lists)} på indkøbslister
              </span>
            </div>
          );
        })}
        {sold.length > 0 && <CopyReport slots={sold} document={document} />}
      </div>
    );
  }

  return (
    <div className="slotpanel">
      <h3>Pladser til salg</h3>
      <p className="slotpanel__said">Vælg en plads her eller på siderne for at sælge den. En solgt plads er låst.</p>
      <dl className="stats">
        <div><dt>solgt</dt><dd>{sold.length}</dd></div>
        <div><dt>ledige</dt><dd>{free.length}</dd></div>
        <div><dt>ledige til listepris</dt><dd>{sum(listValue)}</dd></div>
      </dl>
      <h4>Mest sete ledige</h4>
      <ol className="slotpanel__top">
        {free.slice(0, 8).map((slot) => (
          <li key={slot.key}>
            <button onClick={() => onPick(slot.key)} title={`Sælg ${slot.name} på side ${slot.pageIndex + 1}`}>
              <i className="slotsboard__chip" style={{ background: heat(slot.warmth) }} />
              <span>Side {slot.pageIndex + 1} · {slot.name}</span>
              <b>{n(slot.signal.views)}</b>
              <em className="slotpanel__sell">Sælg ›</em>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SlotPanel({ slot, mode, document, onClose }: { slot: SlotInfo; mode: Mode; document: CatalogDocument; onClose: () => void }) {
  const { feedOffers, bookSlot, releaseSlot } = useStudio(useShallow((s) => ({
    feedOffers: s.feedOffers, bookSlot: s.bookSlot, releaseSlot: s.releaseSlot,
  })));
  const suppliers = useMemo(
    () => [...new Set([...document.offers, ...feedOffers].map((o) => o.brand.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'da')),
    [document.offers, feedOffers],
  );
  const [supplier, setSupplier] = useState(slot.offer?.brand ?? '');
  const [offerId, setOfferId] = useState<string>(slot.offer?.id ?? '');
  const [price, setPrice] = useState(String(slot.signal.listPrice));
  const [note, setNote] = useState('');
  const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
  const wanted = supplier.trim().toLowerCase();
  const candidates = document.offers
    .filter((o) => !wanted || o.brand.trim().toLowerCase() === wanted || o.id === slot.offer?.id)
    .slice(0, 60);
  const bookedOffer = slot.booking?.offerId ? document.offers.find((o) => o.id === slot.booking!.offerId) : null;

  return (
    <div className="slotpanel">
      <div className="slotpanel__head">
        <h3>Side {slot.pageIndex + 1} · {slot.name}</h3>
        <button className="weekly__x" onClick={onClose} title="Tilbage til oversigten" aria-label="Luk">×</button>
      </div>
      <p className="slotpanel__said">{slot.offer ? `Viser nu: ${slot.offer.name}` : 'Pladsen er tom'}</p>

      <dl className="stats">
        {mode === 'plan' ? (
          <>
            <div><dt>forventet set</dt><dd>{n(slot.signal.views)}</dd></div>
            <div><dt>klikrate</dt><dd>{pct(slot.signal.clickRate)}</dd></div>
            <div><dt>af 100</dt><dd>{slot.index}</dd></div>
          </>
        ) : (
          <>
            <div><dt>set</dt><dd>{n(result.views)}</dd></div>
            <div><dt>klik</dt><dd>{n(result.clicks)}</dd></div>
            <div><dt>på indkøbslister</dt><dd>{n(result.lists)}</dd></div>
          </>
        )}
      </dl>

      {slot.booking ? (
        <div className="slotpanel__deal">
          <b>◆ Solgt til {slot.booking.supplier}</b>
          <span>{sum(slot.booking.price)} · {bookedOffer ? `for ${bookedOffer.name}` : slot.booking.offerId ? 'for en vare' : 'leverandøren vælger varen'}</span>
          {slot.booking.note && <span className="slotpanel__muted">{slot.booking.note}</span>}
          <span className="slotpanel__muted">Varen er låst på pladsen.</span>
          <button className="linkish" onClick={() => void releaseSlot(slot.booking!.id)}>Frigiv pladsen</button>
        </div>
      ) : (
        <form
          className="slotpanel__form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(price.replace(/\./g, '').replace(',', '.'));
            if (!supplier.trim() || !Number.isFinite(value)) return;
            void bookSlot({
              pageId: slot.pageId, slotId: slot.slotId, supplier: supplier.trim(),
              offerId: offerId || null, price: Math.max(0, Math.round(value)), note: note.trim(),
            });
          }}
        >
          <label><span>Leverandør</span>
            <input list="slot-suppliers" value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Fx Carlsberg" required />
            <datalist id="slot-suppliers">{suppliers.map((name) => <option key={name} value={name} />)}</datalist>
          </label>
          <label><span>Vare</span>
            <select value={offerId} onChange={(event) => setOfferId(event.target.value)}>
              <option value="">Leverandøren vælger</option>
              {candidates.map((o) => <option key={o.id} value={o.id}>{o.name}{o.id === slot.offer?.id ? ' (står her nu)' : ''}</option>)}
            </select>
          </label>
          <label><span>Pris <small>listepris {sum(slot.signal.listPrice)}</small></span>
            <input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} />
          </label>
          <label><span>Aftale</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Aftalenummer eller note" />
          </label>
          <button className="go" disabled={!supplier.trim()}>Sælg pladsen</button>
        </form>
      )}
    </div>
  );
}

/** The week's numbers per supplier, as text to paste into a mail. */
function CopyReport({ slots, document }: { slots: SlotInfo[]; document: CatalogDocument }) {
  const [done, setDone] = useState(false);
  const text = slots.map((slot) => {
    const r = slotResult(slot.signal, `${document.id}:${slot.key}`);
    return `${slot.booking!.supplier} — side ${slot.pageIndex + 1}, ${slot.offer?.name ?? 'tom plads'}: ${n(r.views)} set, ${n(r.clicks)} klik, ${n(r.lists)} på indkøbslister.`;
  }).join('\n');
  return (
    <button
      className="thin"
      onClick={() => {
        void navigator.clipboard?.writeText(`${document.name}\n\n${text}`).then(() => setDone(true), () => setDone(false));
      }}
    >{done ? 'Kopieret' : 'Kopiér rapporten'}</button>
  );
}
