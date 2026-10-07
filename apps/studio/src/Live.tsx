import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isImagePage, type Brand, type CatalogDocument, type CatalogPage, type Offer } from '@incitio/schema';
import { ImagePage, ImageSize, PageView, sizedImage } from '@incitio/renderer';
import { resolveVariant } from '@incitio/edit/core';
import { THUMB_PX, useStudio } from './state.js';
import { templateOf } from './inventory.js';
import { liveStatus, standIns, type LiveStatus } from './live-model.js';
import { count, kr, when } from './format.js';
import { readWho } from './who.js';
import { BoardHead, Section } from './Board.js';
import styles from './Live.module.css';

/**
 * Live — the avis after Thursday.
 *
 * A printed avis is frozen the day it is approved; the one people read
 * is on a phone and need not be. A product sells out on Wednesday: it
 * says so, and its stand-in takes the place. A price is corrected: the
 * avis shows the right one within the minute, and the log says when.
 *
 * Every product on the pages is a row with its two acts on it — no
 * search-then-form — and a tile tapped on the phone opens its row, so
 * the change is made where the product is seen. Before publishing the
 * same rows are there, read-only, so the screen says what it will do.
 */

export function LiveBoard() {
  const { document, brand, busy, unpublish, openBoard } = useStudio(useShallow((s) => ({
    document: s.variantBase ?? s.document, brand: s.brand, busy: Boolean(s.busy), unpublish: s.unpublish, openBoard: s.openBoard,
  })));
  /*
   * Which store's avis is on the phone. A store reads its own edition —
   * the base with its extra offers and changes — so the preview shows
   * that, without opening the edition in the editor behind it.
   */
  const [editionId, setEditionId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const editions = document?.variants ?? [];
  const shown = useMemo(() => {
    if (!document || !brand || !editionId || !editions.some((v) => v.id === editionId)) return document;
    try { return resolveVariant(document, editionId, brand).document; } catch { return document; }
  }, [document, brand, editionId, editions]);
  const status = useMemo(() => (document ? liveStatus(document) : null), [document]);
  const rows = useMemo(() => (document ? rowsOf(document) : []), [document]);
  if (!document || !brand || !status || !shown) return null;

  const published = document.status === 'udgivet';
  const events = document.live ?? [];
  const needle = query.trim().toLowerCase();
  const listed = needle ? rows.filter((row) => `${row.offer.name} ${row.offer.brand}`.toLowerCase().includes(needle)) : rows;
  const repriced = [...status.marks.values()].filter((mark) => mark === 'Ny pris').length;

  return (
    <main className="book board liveboard">
      <BoardHead
        title="Live"
        said={published ? 'Det kunderne ser lige nu — ret det, og telefonen viser det med det samme' : 'Sådan kommer avisen til at se ud på telefonen'}
      >
        {published && (
          <button
            className="linkish"
            disabled={busy}
            title="Avisen vises ikke længere. Den kan udgives igen fra Godkend."
            onClick={() => {
              if (!window.confirm('Træk avisen tilbage? Kunderne ser den ikke, før den er udgivet igen.')) return;
              void unpublish(readWho());
            }}
          >Træk avisen tilbage</button>
        )}
      </BoardHead>

      <div className="liveboard__body">
        <section className="liveboard__phonecol">
          {editions.length > 0 && (
            <label className="liveboard__edition">
              <span>Butik</span>
              <select value={editionId ?? ''} onChange={(event) => setEditionId(event.target.value || null)}>
                <option value="">Alle butikker (grundavisen)</option>
                {editions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <Phone
            document={shown} brand={brand} marks={status.marks} focus={focus}
            onPick={(offerId) => { setQuery(''); setFocus(offerId); }}
            store={editions.find((v) => v.id === editionId)?.name}
          />
          <p className={styles.hint}>Klik på en vare på telefonen for at rette den</p>
        </section>

        <section className="liveboard__side">
          <div className={`${styles.status} ${published ? styles.on : ''}`}>
            <div className={styles.state}>
              <span className={styles.pulse} aria-hidden="true" />
              <div>
                <b>{published ? 'Live nu' : 'Ikke udgivet'}</b>
                <small>
                  {published
                    ? events.length ? `Sidst ændret ${when(events.at(-1)!.at)}` : 'Ingen ændringer siden udgivelse'
                    : 'Udsolgt og nye priser kan meldes, når avisen er udgivet'}
                </small>
              </div>
              {!published && <button className="thin" onClick={() => openBoard('godkend')}>Til Godkend</button>}
            </div>
            <dl className={styles.stats}>
              <div><dt>Varer i avisen</dt><dd>{rows.length}</dd></div>
              <div className={status.soldOut.size ? styles.hot : ''}><dt>Udsolgt</dt><dd>{status.soldOut.size}</dd></div>
              <div><dt>Nye priser</dt><dd>{repriced}</dd></div>
              <div><dt>Ændringer</dt><dd>{events.length}</dd></div>
            </dl>
          </div>

          <Section
            title="Varerne i avisen"
            aside={<input className={`field-input ${styles.search}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find en vare" />}
          >
            <ul className={styles.rows}>
              {listed.map((row, index) => (
                <OfferRow
                  key={row.offer.id}
                  row={row}
                  heading={index === 0 || listed[index - 1]!.page !== row.page}
                  document={document}
                  status={status}
                  published={published}
                  open={focus === row.offer.id}
                  onOpen={(on) => setFocus(on ? row.offer.id : null)}
                />
              ))}
              {listed.length === 0 && <li className={styles.none}>Ingen vare i avisen hedder sådan</li>}
            </ul>
          </Section>

          {published && (
            <Section title="Sket siden udgivelse">
              {events.length === 0
                ? <p className="bsection__said">Intet endnu. Udsolgte varer og nye priser står her med tidspunkt og navn.</p>
                : <LiveLog document={document} />}
            </Section>
          )}
        </section>
      </div>
    </main>
  );
}

interface Row { offer: Offer; page: number }

/** Every product on the pages, once, in the order the avis is read. */
function rowsOf(document: CatalogDocument): Row[] {
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const rows: Row[] = [];
  document.pages.forEach((page, index) => {
    for (const placement of page.placements) {
      const offer = offers.get(placement.offerId);
      if (!offer || seen.has(offer.id)) continue;
      seen.add(offer.id);
      rows.push({ offer, page: index + 1 });
    }
  });
  return rows;
}

/**
 * One product, its state and its two acts. Closed it is a line; open it
 * offers "udsolgt" with a stand-in from the reserve, and a new price.
 */
function OfferRow({ row, heading, document, status, published, open, onOpen }: {
  row: Row; heading: boolean; document: CatalogDocument; status: LiveStatus; published: boolean;
  open: boolean; onOpen: (on: boolean) => void;
}) {
  const { busy, liveChange } = useStudio(useShallow((s) => ({ busy: Boolean(s.busy), liveChange: s.liveChange })));
  const { offer } = row;
  const [price, setPrice] = useState('');
  const [substitute, setSubstitute] = useState('');
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    setPrice(String(offer.price).replace('.', ','));
    setSubstitute('');
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, offer.price]);

  const out = status.soldOut.has(offer.id);
  const mark = status.marks.get(offer.id);
  const stands = open && !out ? standIns(document, offer, status.soldOut) : [];
  const off = !published || busy;
  const why = published ? undefined : 'Udgiv avisen fra Godkend først';
  const after = Number(price.replace(',', '.'));
  const priceOk = Number.isFinite(after) && after > 0 && after !== offer.price;

  return (
    <>
      {heading && <li className={styles.page}>Side {row.page}</li>}
      <li ref={ref} className={`${styles.row} ${open ? styles.open : ''} ${out ? styles.out : ''}`}>
        <button className={styles.line} onClick={() => onOpen(!open)} aria-expanded={open}>
          <span className={styles.thumb}>
            {offer.imageUrl && <img src={sizedImage(offer.imageUrl, THUMB_PX)} alt="" loading="lazy" decoding="async" />}
          </span>
          <span className={styles.name}><b>{offer.name}</b>{offer.brand && <small>{offer.brand}</small>}</span>
          {mark && <span className={`${styles.chip} ${mark === 'Udsolgt' ? styles.chipOut : ''}`}>{mark}</span>}
          <span className={styles.price}>{kr(offer.price)}</span>
        </button>
        {open && (
          <div className={styles.acts}>
            {out ? (
              <div className={styles.act}>
                <span>Udsolgt nu</span>
                <button
                  className="thin" disabled={off} title={why}
                  onClick={() => { void liveChange({ kind: 'tilbage', offerId: offer.id, substituteId: null, before: null, after: null, who: readWho() }); onOpen(false); }}
                >Tilbage på lager</button>
              </div>
            ) : (
              <div className={styles.act}>
                <span>Udsolgt</span>
                <select value={substitute} disabled={off} onChange={(event) => setSubstitute(event.target.value)}>
                  <option value="">Vis den som udsolgt</option>
                  {stands.map((o) => <option key={o.id} value={o.id}>Vis i stedet: {o.name} · {kr(o.price)}</option>)}
                </select>
                <button
                  className={`thin ${styles.danger}`} disabled={off} title={why}
                  onClick={() => { void liveChange({ kind: 'udsolgt', offerId: offer.id, substituteId: substitute || null, before: null, after: null, who: readWho() }); onOpen(false); }}
                >Meld udsolgt</button>
              </div>
            )}
            <form
              className={styles.act}
              onSubmit={(event) => {
                event.preventDefault();
                if (!priceOk || off) return;
                void liveChange({ kind: 'pris', offerId: offer.id, substituteId: null, before: offer.price, after, who: readWho() });
                onOpen(false);
              }}
            >
              <span>Ny pris</span>
              <label className={styles.kr}>
                <input inputMode="decimal" value={price} disabled={off} onChange={(event) => setPrice(event.target.value)} aria-label="Ny pris" />
                <i>kr.</i>
              </label>
              <button className="thin" disabled={off || !priceOk} title={why}>Ret prisen</button>
            </form>
            {!published && <p className={styles.note}>Udgiv avisen fra Godkend, så kan du ændre den her.</p>}
          </div>
        )}
      </li>
    </>
  );
}

function LiveLog({ document }: { document: CatalogDocument }) {
  const offers = new Map(document.offers.map((o) => [o.id, o.name]));
  return (
    <ol className="log">
      {[...(document.live ?? [])].reverse().map((event) => {
        const name = offers.get(event.offerId) ?? 'vare';
        const sub = event.substituteId ? offers.get(event.substituteId) : null;
        return (
          <li key={event.id}>
            <time>{when(event.at)}</time>
            <span>
              {event.kind === 'udsolgt' && <><b>{name}</b> udsolgt{sub ? <> — {sub} står i stedet</> : ''}</>}
              {event.kind === 'pris' && <><b>{name}</b> {kr(event.before ?? 0)} → {kr(event.after ?? 0)}</>}
              {event.kind === 'tilbage' && <><b>{name}</b> er tilbage</>}
              {event.who && <small> · {event.who}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Phone({ document, brand, marks, focus, onPick, store }: {
  document: CatalogDocument; brand: Brand; marks: Map<string, string>;
  focus: string | null; onPick: (offerId: string) => void;
  /** The store whose edition is shown, for the bar; none for the base avis. */
  store?: string;
}) {
  const offers = useMemo(() => new Map(document.offers.map((o) => [o.id, o])), [document.offers]);
  const screen = useRef<HTMLDivElement>(null);
  // The row opened from the list: bring its tile into view on the phone.
  useEffect(() => {
    if (!focus) return;
    const tile = screen.current?.querySelector(`[data-offer-id="${CSS.escape(focus)}"]`);
    tile?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  return (
    <div className="phone">
      <div className="phone__bar"><i style={{ background: brand.tokens.brand }} /><b>{brand.name.split(' — ')[0]}{store ? ` ${store}` : ''}</b><span>{document.week ? `Uge ${document.week.week}` : ''}</span></div>
      <div
        className="phone__screen"
        ref={screen}
        onClick={(event) => {
          const id = (event.target as Element).closest?.('[data-offer-id]')?.getAttribute('data-offer-id');
          if (id) onPick(id);
        }}
      >
        {document.pages.map((page, index) => (
          <PhonePage key={page.id} page={page} index={index} document={document} brand={brand} offers={offers} marks={marks} focus={focus} />
        ))}
      </div>
    </div>
  );
}

/** One page on the phone. Memoised: a page redraws when what it shows changes, not with the board. */
const PhonePage = memo(function PhonePage({ page, index, document, brand, offers, marks, focus }: {
  page: CatalogPage; index: number; document: CatalogDocument; brand: Brand;
  offers: Map<string, Offer>; marks: Map<string, string>; focus: string | null;
}) {
  const template = isImagePage(page) ? undefined : templateOf(document, brand, page.templateId);
  const decorate = (slotId: string) => {
    const placement = page.placements.find((p) => p.slotId === slotId);
    if (!placement) return null;
    const mark = marks.get(placement.offerId);
    const here = placement.offerId === focus;
    if (!mark && !here) return null;
    return (
      <div className={`livemark${here ? ' livemark--here' : ''}`}>
        {mark && <span className={`livemark__tag${mark === 'Udsolgt' ? ' livemark__tag--out' : ''}`}>{mark}</span>}
      </div>
    );
  };
  return (
    <div className="phone__page" style={{ background: page.ground ?? brand.tokens.ground, ['--aspect' as string]: String(brand.pageAspect) }}>
      <div className="phone__live">
        <ImageSize.Provider value={THUMB_PX}>
          {isImagePage(page)
            ? <ImagePage page={page} brand={brand} pageIndex={index} pageNumber={index + 1} />
            : template
              ? <PageView page={page} template={template} brand={brand} offers={offers} pageIndex={index} pageNumber={index + 1} slotDecorator={decorate} />
              : null}
        </ImageSize.Provider>
      </div>
    </div>
  );
});

