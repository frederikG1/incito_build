import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isImagePage, type Brand, type CatalogDocument, type CatalogPage, type Offer } from '@incitio/schema';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { resolveVariant } from '@incitio/edit/core';
import { THUMB_PX, useStudio } from './state.js';
import { HOUSEHOLDS, type Household } from './signals.js';
import { onList, orderFor } from './audience.js';
import { templateOf } from './inventory.js';
import { findOnPages, liveStatus, standIns } from './live-model.js';
import { count, kr, when } from './format.js';
import { readWho } from './who.js';
import { BoardHead, Section, StandIn } from './Board.js';

/**
 * Live — the avis after Thursday.
 *
 * A printed avis is frozen the day it is approved; the one people read
 * is on a phone and need not be. A product sells out on Wednesday: it
 * says so, and its stand-in takes the place. A price is corrected: the
 * avis shows the right one within the minute, and the log says when.
 *
 * And it need not be the same for everyone. The design stays the
 * chain's, place for place — only the ORDER of the pages follows the
 * household reading it, so the family sees the dairy before the wine.
 * Who is reading is Tjek's to know; the households here are stand-ins.
 *
 * Before publishing there is nothing to change and nothing logged, so
 * the side column is one sentence, not two empty forms.
 */

export function LiveBoard() {
  const { document, brand, busy, unpublish } = useStudio(useShallow((s) => ({
    document: s.variantBase ?? s.document, brand: s.brand, busy: Boolean(s.busy), unpublish: s.unpublish,
  })));
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const household = HOUSEHOLDS.find((h) => h.id === householdId) ?? null;
  /*
   * Which store's avis is on the phone. A store reads its own edition —
   * the base with its extra offers and changes — so the preview shows
   * that, without opening the edition in the editor behind it.
   */
  const [editionId, setEditionId] = useState<string | null>(null);
  const editions = document?.variants ?? [];
  const shown = useMemo(() => {
    if (!document || !brand || !editionId || !editions.some((v) => v.id === editionId)) return document;
    try { return resolveVariant(document, editionId, brand).document; } catch { return document; }
  }, [document, brand, editionId, editions]);
  const pages = useMemo(() => (shown ? orderFor(shown, household) : []), [shown, household]);
  const status = useMemo(() => (document ? liveStatus(document) : null), [document]);
  if (!document || !brand || !status) return null;

  const published = document.status === 'udgivet';
  const events = document.live ?? [];

  return (
    <main className="book board liveboard">
      <BoardHead
        title="Live"
        said={published
          ? `Udgivet · ${count(events.length, 'ændring', 'ændringer')} siden`
          : 'Ikke udgivet endnu — sådan vil den se ud på telefonen'}
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
          <div className="liveboard__whohead">
            <div className="seg liveboard__who" role="tablist" aria-label="Hvem læser">
              <button className={!household ? 'is-on' : ''} onClick={() => setHouseholdId(null)}>Alle</button>
              {HOUSEHOLDS.map((h) => (
                <button key={h.id} className={householdId === h.id ? 'is-on' : ''} onClick={() => setHouseholdId(h.id)}>{h.name}</button>
              ))}
            </div>
            <StandIn what="Eksempel-husstande" />
          </div>
          {editions.length > 0 && (
            <label className="liveboard__edition">
              <span>Butik</span>
              <select value={editionId ?? ''} onChange={(event) => setEditionId(event.target.value || null)}>
                <option value="">Alle butikker (grundavisen)</option>
                {editions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <p className="liveboard__said">
            {household
              ? <>{household.said}. Samme sider, samme pladser — rækkefølgen følger det, de køber.</>
              : 'Avisen som kæden har sat den. Vælg en husstand for at se den i deres rækkefølge.'}
          </p>
          <Phone
            document={shown ?? document} brand={brand} pages={pages} household={household} marks={status.marks}
            store={editions.find((v) => v.id === editionId)?.name}
          />
        </section>

        <section className="liveboard__side">
          {published ? (
            <>
              <LiveChanges document={document} soldOut={status.soldOut} />
              <Section title="Sket siden udgivelse">
                {events.length === 0
                  ? <p className="bsection__said">Intet endnu. Udsolgte varer og nye priser står her med tidspunkt.</p>
                  : <LiveLog document={document} />}
              </Section>
            </>
          ) : (
            <p className="liveboard__wait">
              Når avisen er udgivet fra <b>Godkend</b>, melder du udsolgt og retter priser her. Kunderne ser det med
              det samme, og hver ændring står i loggen med tidspunkt og navn.
            </p>
          )}
        </section>
      </div>
    </main>
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

function Phone({ document, brand, pages, household, marks, store }: {
  document: CatalogDocument; brand: Brand; pages: CatalogPage[]; household: Household | null; marks: Map<string, string>;
  /** The store whose edition is shown, for the bar; none for the base avis. */
  store?: string;
}) {
  const offers = useMemo(() => new Map(document.offers.map((o) => [o.id, o])), [document.offers]);
  const listHits = useMemo(() => {
    if (!household) return [];
    const placed = new Set(document.pages.flatMap((p) => p.placements.map((pl) => pl.offerId)));
    return document.offers.filter((o) => placed.has(o.id) && onList(o, household));
  }, [document, household]);
  const listed = useMemo(() => new Set(listHits.map((o) => o.id)), [listHits]);
  const indexOf = useMemo(() => new Map(document.pages.map((p, i) => [p.id, i])), [document.pages]);

  return (
    <div className="phone">
      <div className="phone__bar"><i style={{ background: brand.tokens.brand }} /><b>{brand.name.split(' — ')[0]}{store ? ` ${store}` : ''}</b><span>{document.week ? `Uge ${document.week.week}` : ''}</span></div>
      <div className="phone__screen">
        {household && listHits.length > 0 && (
          <div className="phone__list">
            <b>{count(listHits.length, 'vare', 'varer')} fra din indkøbsliste er på tilbud</b>
            <span>{listHits.slice(0, 4).map((o) => o.name).join(' · ')}</span>
          </div>
        )}
        {pages.map((page) => (
          <PhonePage
            key={page.id}
            page={page}
            index={indexOf.get(page.id) ?? 0}
            document={document}
            brand={brand}
            offers={offers}
            marks={marks}
            listed={listed}
          />
        ))}
      </div>
    </div>
  );
}

/** One page on the phone. Memoised: a page redraws when what it shows changes, not with the board. */
const PhonePage = memo(function PhonePage({ page, index, document, brand, offers, marks, listed }: {
  page: CatalogPage; index: number; document: CatalogDocument; brand: Brand;
  offers: Map<string, Offer>; marks: Map<string, string>; listed: Set<string>;
}) {
  const template = isImagePage(page) ? undefined : templateOf(document, brand, page.templateId);
  const decorate = (slotId: string) => {
    const placement = page.placements.find((p) => p.slotId === slotId);
    if (!placement) return null;
    const mark = marks.get(placement.offerId);
    const mine = listed.has(placement.offerId);
    if (!mark && !mine) return null;
    return (
      <div className="livemark">
        {mark && <span className={`livemark__tag${mark === 'Udsolgt' ? ' livemark__tag--out' : ''}`}>{mark}</span>}
        {mine && <span className="livemark__mine">På din liste</span>}
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

/** Find a product on the pages and say what happened to it. */
function LiveChanges({ document, soldOut }: { document: CatalogDocument; soldOut: Set<string> }) {
  const { busy, liveChange } = useStudio(useShallow((s) => ({ busy: Boolean(s.busy), liveChange: s.liveChange })));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [substitute, setSubstitute] = useState('');

  const offer = document.offers.find((o) => o.id === picked) ?? null;
  const hits = findOnPages(document, query);
  const stands = offer ? standIns(document, offer, soldOut) : [];
  const names = new Map(document.offers.map((o) => [o.id, o.name]));
  const done = () => { setPicked(null); setQuery(''); setPrice(''); setSubstitute(''); };

  return (
    <Section title="Ret i den udgivne avis">
      {soldOut.size > 0 && (
        <ul className="liveboard__soldout">
          {[...soldOut].map((id) => (
            <li key={id}>
              <span>Udsolgt: <b>{names.get(id)}</b></span>
              <button
                className="linkish"
                disabled={busy}
                onClick={() => void liveChange({ kind: 'tilbage', offerId: id, substituteId: null, before: null, after: null, who: readWho() })}
              >tilbage på lager</button>
            </li>
          ))}
        </ul>
      )}
      {!offer ? (
        <>
          <input className="field-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find en vare i avisen" />
          {hits.length > 0 && (
            <ul className="liveboard__hits">
              {hits.map((o) => (
                <li key={o.id}><button onClick={() => { setPicked(o.id); setPrice(String(o.price).replace('.', ',')); }}>
                  <b>{o.name}</b><span>{kr(o.price)}{o.brand ? ` · ${o.brand}` : ''}</span>
                </button></li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="liveboard__form">
          <div className="slotpanel__head"><b>{offer.name}</b><button className="weekly__x" onClick={done} title="Annullér" aria-label="Annullér">×</button></div>
          <div className="liveboard__act">
            <span>Udsolgt — vis i stedet</span>
            <select value={substitute} onChange={(event) => setSubstitute(event.target.value)}>
              <option value="">Ingen — vis den som udsolgt</option>
              {stands.map((o) => <option key={o.id} value={o.id}>{o.name} · {kr(o.price)}</option>)}
            </select>
            <button
              className="thin"
              disabled={busy}
              onClick={() => {
                void liveChange({ kind: 'udsolgt', offerId: offer.id, substituteId: substitute || null, before: null, after: null, who: readWho() });
                done();
              }}
            >Meld udsolgt</button>
          </div>
          <div className="liveboard__act">
            <span>Ny pris</span>
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            <button
              className="thin"
              disabled={busy}
              onClick={() => {
                const after = Number(price.replace(',', '.'));
                if (!Number.isFinite(after) || after <= 0 || after === offer.price) return;
                void liveChange({ kind: 'pris', offerId: offer.id, substituteId: null, before: offer.price, after, who: readWho() });
                done();
              }}
            >Ret prisen</button>
          </div>
        </div>
      )}
    </Section>
  );
}
