import { useMemo, useState, type CSSProperties } from 'react';
import { isImagePage, type CatalogDocument, type CatalogPage } from '@incitio/schema';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { DEPARTMENT_NAMES } from '@incitio/compose';
import { THUMB_PX, departmentOfPage, useStudio } from './state.js';
import { DEMO_NOTE, SIGNALS_ARE_DEMO, slotResult, weeklyReach } from './signals.js';
import { slotName, slotsOf, templateOf, type SlotInfo } from './inventory.js';

/**
 * Pladser — the avis as places that are worth something.
 *
 * Every place on every page, coloured by how many people will see it,
 * with who has bought it. A buyer sells the front page's big place to a
 * supplier here; the place is then locked, the checks guard it, and
 * after the week the supplier gets the numbers it did. The worth of a
 * place is Tjek's data — a stand-in until it is connected, and said so.
 */

const n = (value: number) => value.toLocaleString('da-DK');
const kr = (value: number) => `kr. ${value.toLocaleString('da-DK')}`;
const pct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')} %`;

type Mode = 'plan' | 'resultat';

/** Cool to warm by how much a place is seen, against the rest of this avis. */
function heat(warmth: number): string {
  const hue = 215 - warmth * 205;
  return `hsl(${hue} 88% 50% / ${0.3 + warmth * 0.32})`;
}

export function SlotsBoard() {
  const s = useStudio();
  const document = s.variantBase ?? s.document;
  const [mode, setMode] = useState<Mode>(document?.status === 'udgivet' ? 'resultat' : 'plan');
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<'værdi' | 'side'>('værdi');

  const slots = useMemo(() => (document && s.brand ? slotsOf(document, s.brand) : []), [document, s.brand]);
  if (!document || !s.brand) return null;

  const sold = slots.filter((slot) => slot.booking);
  const income = sold.reduce((sum, slot) => sum + (slot.booking?.price ?? 0), 0);
  const reach = weeklyReach(document.brandId);
  const chosen = slots.find((slot) => slot.key === selected) ?? null;
  const ranked = [...slots].sort((a, b) => (sort === 'værdi'
    ? b.signal.views - a.signal.views
    : a.pageIndex - b.pageIndex || b.signal.views - a.signal.views));

  return (
    <main className="book board slotsboard">
      <div className="book__head">
        <h2>Pladser</h2>
        <span className="book__said">
          {sold.length} af {slots.length} pladser solgt · {kr(income)} · {n(reach)} læsere om ugen
        </span>
        <div className="book__gap" />
        {SIGNALS_ARE_DEMO && <span className="demo" title={DEMO_NOTE}>Eksempeltal</span>}
        <div className="seg" role="tablist" aria-label="Vis">
          <button className={mode === 'plan' ? 'is-on' : ''} onClick={() => setMode('plan')}>Plan</button>
          <button className={mode === 'resultat' ? 'is-on' : ''} onClick={() => setMode('resultat')}>Resultat</button>
        </div>
      </div>

      <div className="slotsboard__body">
        <section className="slotsboard__pages" aria-label="Siderne med pladsernes værdi">
          {document.pages.map((page, index) => (
            <Sheet
              key={page.id}
              page={page}
              index={index}
              document={document}
              slots={slots}
              selected={selected}
              mode={mode}
              onPick={setSelected}
            />
          ))}
          <div className="slotsboard__legend">
            <span>Færre ser den</span><i /><span>Flere ser den</span>
            <span className="slotsboard__key"><b>◆</b> solgt og låst</span>
          </div>
        </section>

        <aside className="slotsboard__side">
          {chosen
            ? <SlotPanel key={chosen.key} slot={chosen} mode={mode} document={document} onClose={() => setSelected(null)} />
            : <Overview slots={slots} mode={mode} />}
        </aside>
      </div>

      <section className="slotsboard__table">
        <div className="home__archhead">
          <h3>Alle pladser</h3>
          <div className="seg">
            <button className={sort === 'værdi' ? 'is-on' : ''} onClick={() => setSort('værdi')}>Mest set</button>
            <button className={sort === 'side' ? 'is-on' : ''} onClick={() => setSort('side')}>Side for side</button>
          </div>
        </div>
        <div className="slotsboard__rows" role="table">
          <div className="slotsboard__row slotsboard__row--head" role="row">
            <span>Plads</span><span>Vare nu</span>
            <span>{mode === 'plan' ? 'Forventet set' : 'Set'}</span>
            <span>{mode === 'plan' ? 'Klikrate' : 'Klik'}</span>
            <span>{mode === 'plan' ? 'Listepris' : 'På indkøbsliste'}</span>
            <span>Solgt til</span>
          </div>
          {ranked.map((slot) => {
            const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
            return (
              <button
                key={slot.key}
                role="row"
                className={`slotsboard__row${slot.key === selected ? ' is-on' : ''}${slot.booking ? ' is-sold' : ''}`}
                onClick={() => setSelected(slot.key)}
              >
                <span><i className="slotsboard__chip" style={{ background: heat(slot.warmth) }} />Side {slot.pageIndex + 1} · {placeName(slot, slots)}</span>
                <span className="slotsboard__offer">{slot.offer?.name ?? <em>tom</em>}</span>
                <span>{n(mode === 'plan' ? slot.signal.views : result.views)}</span>
                <span>{mode === 'plan' ? pct(slot.signal.clickRate) : n(result.clicks)}</span>
                <span>{mode === 'plan' ? kr(slot.signal.listPrice) : n(result.lists)}</span>
                <span>{slot.booking ? <b>◆ {slot.booking.supplier}</b> : <em>ledig</em>}</span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

/** "Topplads", "Plads 3" — counted within its page. */
function placeName(slot: SlotInfo, all: SlotInfo[]): string {
  const order = all.filter((other) => other.pageId === slot.pageId).findIndex((other) => other.key === slot.key);
  return slotName(slot, order);
}

function Sheet({ page, index, document, slots, selected, mode, onPick }: {
  page: CatalogPage;
  index: number;
  document: CatalogDocument;
  slots: SlotInfo[];
  selected: string | null;
  mode: Mode;
  onPick: (key: string) => void;
}) {
  const brand = useStudio((s) => s.brand)!;
  const offers = useMemo(() => new Map(document.offers.map((offer) => [offer.id, offer])), [document.offers]);
  const mine = new Map(slots.filter((slot) => slot.pageId === page.id).map((slot) => [slot.slotId, slot]));
  const template = isImagePage(page) ? undefined : templateOf(document, brand, page.templateId);

  const mark = (slot: SlotInfo, style?: CSSProperties) => {
    const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
    return (
      <div
        key={slot.key}
        className={`heat${slot.key === selected ? ' is-on' : ''}${slot.booking ? ' is-sold' : ''}`}
        style={{ background: heat(slot.warmth), ...style }}
        onClick={(event) => { event.stopPropagation(); onPick(slot.key); }}
        title={`${placeName(slot, slots)} · ${n(slot.signal.views)} forventet set`}
      >
        <span className="heat__n">{mode === 'plan' ? slot.index : n(Math.round(result.views / 1000))}{mode === 'resultat' ? 'k' : ''}</span>
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
}

function Overview({ slots, mode }: { slots: SlotInfo[]; mode: Mode }) {
  const document = useStudio((s) => s.variantBase ?? s.document)!;
  const sold = slots.filter((slot) => slot.booking);
  const free = slots.filter((slot) => !slot.booking).sort((a, b) => b.signal.views - a.signal.views);
  const listValue = free.reduce((sum, slot) => sum + slot.signal.listPrice, 0);

  if (mode === 'resultat') {
    return (
      <div className="slotpanel">
        <h3>Resultat for leverandørerne</h3>
        <p className="slotpanel__said">Hvad de solgte pladser gav, når ugen er gået — til at sende videre.</p>
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
      <p className="slotpanel__said">
        Klik en plads på en side for at sælge den. En solgt plads låses, så intet automatisk flytter varen — og tjekket
        før tryk siger til, hvis den alligevel viser noget andet.
      </p>
      <div className="slotpanel__stats">
        <div><b>{sold.length}</b><span>solgt</span></div>
        <div><b>{free.length}</b><span>ledige</span></div>
        <div><b>{kr(listValue)}</b><span>ledige til listepris</span></div>
      </div>
      <h4>Mest sete ledige</h4>
      <ol className="slotpanel__top">
        {free.slice(0, 5).map((slot) => (
          <li key={slot.key}>
            <i className="slotsboard__chip" style={{ background: heat(slot.warmth) }} />
            <span>Side {slot.pageIndex + 1} · {placeName(slot, slots)}</span>
            <b>{n(slot.signal.views)}</b>
          </li>
        ))}
      </ol>
      <p className="slotpanel__demo">{DEMO_NOTE}.</p>
    </div>
  );
}

function SlotPanel({ slot, mode, document, onClose }: { slot: SlotInfo; mode: Mode; document: CatalogDocument; onClose: () => void }) {
  const s = useStudio();
  const all = useMemo(() => (s.brand ? slotsOf(document, s.brand) : []), [document, s.brand]);
  const suppliers = useMemo(
    () => [...new Set([...document.offers, ...s.feedOffers].map((o) => o.brand.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'da')),
    [document.offers, s.feedOffers],
  );
  const [supplier, setSupplier] = useState(slot.offer?.brand ?? '');
  const [offerId, setOfferId] = useState<string>(slot.offer?.id ?? '');
  const [price, setPrice] = useState(String(slot.signal.listPrice));
  const [note, setNote] = useState('');
  const result = slotResult(slot.signal, `${document.id}:${slot.key}`);
  const candidates = document.offers
    .filter((o) => !supplier.trim() || o.brand.trim().toLowerCase() === supplier.trim().toLowerCase() || o.id === slot.offer?.id)
    .slice(0, 60);

  return (
    <div className="slotpanel">
      <div className="slotpanel__head">
        <h3>Side {slot.pageIndex + 1} · {placeName(slot, all)}</h3>
        <button className="weekly__x" onClick={onClose} title="Tilbage til oversigten">×</button>
      </div>
      <p className="slotpanel__said">{slot.offer ? `Viser nu: ${slot.offer.name}` : 'Pladsen er tom'}</p>

      <div className="slotpanel__stats">
        {mode === 'plan' ? (
          <>
            <div><b>{n(slot.signal.views)}</b><span>forventet set</span></div>
            <div><b>{pct(slot.signal.clickRate)}</b><span>klikrate</span></div>
            <div><b>{slot.index}</b><span>af 100</span></div>
          </>
        ) : (
          <>
            <div><b>{n(result.views)}</b><span>set</span></div>
            <div><b>{n(result.clicks)}</b><span>klik</span></div>
            <div><b>{n(result.lists)}</b><span>på indkøbslister</span></div>
          </>
        )}
      </div>

      {slot.booking ? (
        <div className="slotpanel__deal slotpanel__deal--on">
          <b>◆ Solgt til {slot.booking.supplier}</b>
          <span>{kr(slot.booking.price)}{slot.booking.offerId ? ` · for ${document.offers.find((o) => o.id === slot.booking!.offerId)?.name ?? 'en vare'}` : ' · leverandøren vælger varen'}</span>
          {slot.booking.note && <span className="slotpanel__muted">{slot.booking.note}</span>}
          <span className="slotpanel__muted">Varen er låst på pladsen.</span>
          <button className="thin" onClick={() => void s.releaseSlot(slot.booking!.id)}>Frigiv pladsen</button>
        </div>
      ) : (
        <form
          className="slotpanel__form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(price.replace(/\./g, '').replace(',', '.'));
            if (!supplier.trim() || !Number.isFinite(value)) return;
            void s.bookSlot({
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
          <label><span>Pris</span>
            <input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} />
            <small>Listepris {kr(slot.signal.listPrice)}</small>
          </label>
          <label><span>Aftale</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Aftalenummer eller note" />
          </label>
          <button className="go" disabled={!supplier.trim()}>Sælg pladsen</button>
        </form>
      )}
      <p className="slotpanel__demo">{DEMO_NOTE}.</p>
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
    >{done ? 'Kopieret ✓' : 'Kopiér rapporten'}</button>
  );
}
