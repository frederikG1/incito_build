import { useMemo, useState } from 'react';
import { departmentOf } from '@incitio/compose';
import { isImagePage, type CatalogDocument, type CatalogPage, type Offer } from '@incitio/schema';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { THUMB_PX, useStudio } from './state.js';
import { DEMO_NOTE, HOUSEHOLDS, SIGNALS_ARE_DEMO, type Household } from './signals.js';
import { onList, orderFor } from './audience.js';
import { templateOf } from './inventory.js';

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
 */

const kr = (value: number) => (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

function when(iso: string): string {
  const then = new Date(iso);
  const today = new Date().toDateString() === then.toDateString();
  const time = then.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  return today ? time : `${then.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export function LiveBoard() {
  const s = useStudio();
  const document = s.variantBase ?? s.document;
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const household = HOUSEHOLDS.find((h) => h.id === householdId) ?? null;
  const pages = useMemo(() => (document ? orderFor(document, household) : []), [document, household]);
  if (!document || !s.brand) return null;

  const published = document.status === 'udgivet';
  const events = document.live ?? [];
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const listHits = household
    ? document.offers.filter((o) => document.pages.some((p) => p.placements.some((pl) => pl.offerId === o.id)) && onList(o, household))
    : [];

  return (
    <main className="book board liveboard">
      <div className="book__head">
        <h2>Live</h2>
        <span className="book__said">
          {published
            ? `Udgivet · ${events.length} ${events.length === 1 ? 'ændring' : 'ændringer'} siden`
            : 'Ikke udgivet endnu — sådan vil den se ud på telefonen'}
        </span>
        <div className="book__gap" />
        {SIGNALS_ARE_DEMO && <span className="demo" title={DEMO_NOTE}>Eksempel-husstande</span>}
        {published && (
          <button
            className="thin"
            disabled={Boolean(s.busy)}
            title="Avisen vises ikke længere. Den kan udgives igen fra Godkend."
            onClick={() => {
              if (!window.confirm('Træk avisen tilbage? Kunderne ser den ikke, før den er udgivet igen.')) return;
              const who = (() => { try { return window.localStorage.getItem('incitio.who') ?? ''; } catch { return ''; } })();
              void s.unpublish(who);
            }}
          >Træk avisen tilbage</button>
        )}
      </div>

      <div className="liveboard__body">
        <section className="liveboard__phonecol">
          <div className="seg liveboard__who" role="tablist" aria-label="Hvem læser">
            <button className={!household ? 'is-on' : ''} onClick={() => setHouseholdId(null)}>Alle</button>
            {HOUSEHOLDS.map((h) => (
              <button key={h.id} className={householdId === h.id ? 'is-on' : ''} onClick={() => setHouseholdId(h.id)}>{h.name}</button>
            ))}
          </div>
          <p className="liveboard__said">
            {household
              ? <>{household.said}. Samme sider, samme pladser — rækkefølgen følger det, de køber.</>
              : 'Avisen som kæden har sat den. Vælg en husstand for at se den i deres rækkefølge.'}
          </p>
          <Phone document={document} pages={pages} household={household} listHits={listHits} />
        </section>

        <section className="liveboard__side">
          <LiveChanges document={document} published={published} />
          <div className="liveboard__log">
            <h3>Sket siden udgivelse</h3>
            {events.length === 0 && <p className="slotpanel__muted">Intet endnu. Når en vare bliver udsolgt eller får ny pris, står det her — med tidspunkt.</p>}
            <ol>
              {[...events].reverse().map((event) => {
                const name = offers.get(event.offerId)?.name ?? 'vare';
                const sub = event.substituteId ? offers.get(event.substituteId)?.name : null;
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
          </div>
        </section>
      </div>
    </main>
  );
}

function Phone({ document, pages, household, listHits }: {
  document: CatalogDocument; pages: CatalogPage[]; household: Household | null; listHits: Offer[];
}) {
  const brand = useStudio((s) => s.brand)!;
  const offers = useMemo(() => new Map(document.offers.map((o) => [o.id, o])), [document.offers]);
  // What the reader should be told about a tile: it stands in for a sold-out one, or its price just changed.
  const marks = new Map<string, string>();
  const standing = new Map<string, string>();
  const out = new Set<string>();
  for (const event of document.live ?? []) {
    if (event.kind === 'udsolgt') {
      if (event.substituteId) standing.set(event.substituteId, event.offerId);
      else out.add(event.offerId);
    }
    if (event.kind === 'tilbage') {
      out.delete(event.offerId);
      for (const [sub, from] of standing) if (from === event.offerId) standing.delete(sub);
    }
    if (event.kind === 'pris') marks.set(event.offerId, 'Ny pris');
  }
  for (const id of out) marks.set(id, 'Udsolgt');
  for (const [sub, from] of standing) marks.set(sub, `I stedet for ${offers.get(from)?.name ?? 'en udsolgt vare'}`);
  const listed = new Set(listHits.map((o) => o.id));

  return (
    <div className="phone">
      <div className="phone__bar"><i style={{ background: brand.tokens.brand }} /><b>{brand.name.split(' — ')[0]}</b><span>{document.week ? `Uge ${document.week.week}` : ''}</span></div>
      <div className="phone__screen">
        {household && listHits.length > 0 && (
          <div className="phone__list">
            <b>{listHits.length} {listHits.length === 1 ? 'vare' : 'varer'} fra din indkøbsliste er på tilbud</b>
            <span>{listHits.slice(0, 4).map((o) => o.name).join(' · ')}</span>
          </div>
        )}
        {pages.map((page) => {
          const index = document.pages.findIndex((p) => p.id === page.id);
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
            <div key={page.id} className="phone__page" style={{ background: page.ground ?? brand.tokens.ground, ['--aspect' as string]: String(brand.pageAspect) }}>
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
        })}
      </div>
    </div>
  );
}

/** Find a product on the pages and say what happened to it. */
function LiveChanges({ document, published }: { document: CatalogDocument; published: boolean }) {
  const s = useStudio();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [substitute, setSubstitute] = useState('');
  const who = (() => { try { return window.localStorage.getItem('incitio.who') ?? ''; } catch { return ''; } })();

  const placed = new Set(document.pages.flatMap((p) => p.placements.map((pl) => pl.offerId)));
  const onPages = document.offers.filter((o) => placed.has(o.id));
  const soldOut = new Set<string>();
  for (const event of document.live ?? []) {
    if (event.kind === 'udsolgt') soldOut.add(event.offerId);
    if (event.kind === 'tilbage') soldOut.delete(event.offerId);
  }
  const needle = query.trim().toLowerCase();
  const hits = needle ? onPages.filter((o) => `${o.name} ${o.brand}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const offer = document.offers.find((o) => o.id === picked) ?? null;

  // Stand-ins: products in the avis's reserve, the same department first.
  // Not already on a page, nor inside a grouped tile on one, and something with a price of its own.
  const shown = new Set(document.offers.filter((o) => placed.has(o.id)).flatMap((o) => o.members));
  const reserve = document.offers.filter((o) => !placed.has(o.id) && !shown.has(o.id) && !soldOut.has(o.id)
    && o.members.length === 0 && o.price > 0);
  const department = offer ? departmentOf(offer) : null;
  const stands = [...reserve].sort((a, b) => Number(departmentOf(b) === department) - Number(departmentOf(a) === department)).slice(0, 30);

  const done = () => { setPicked(null); setQuery(''); setPrice(''); setSubstitute(''); };

  return (
    <div className="liveboard__change">
      <h3>Ret i den udgivne avis</h3>
      {!published && <p className="slotpanel__muted">Avisen er ikke udgivet endnu. Ændringer her gælder med det samme, når den er.</p>}
      <div className="liveboard__soldout">
        {[...soldOut].map((id) => (
          <span key={id} className="liveboard__pill">
            Udsolgt: {document.offers.find((o) => o.id === id)?.name}
            <button
              className="linkish"
              disabled={Boolean(s.busy)}
              onClick={() => void s.liveChange({ kind: 'tilbage', offerId: id, substituteId: null, before: null, after: null, who })}
            >tilbage på lager</button>
          </span>
        ))}
      </div>
      {!offer ? (
        <>
          <input className="editions__search liveboard__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find en vare i avisen" />
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
          <div className="slotpanel__head"><b>{offer.name}</b><button className="weekly__x" onClick={done} title="Annullér">×</button></div>
          <div className="liveboard__act">
            <span>Udsolgt — vis i stedet</span>
            <select value={substitute} onChange={(event) => setSubstitute(event.target.value)}>
              <option value="">Ingen — vis den som udsolgt</option>
              {stands.map((o) => <option key={o.id} value={o.id}>{o.name} · {kr(o.price)}</option>)}
            </select>
            <button
              className="thin"
              disabled={Boolean(s.busy)}
              onClick={() => {
                void s.liveChange({ kind: 'udsolgt', offerId: offer.id, substituteId: substitute || null, before: null, after: null, who });
                done();
              }}
            >Meld udsolgt</button>
          </div>
          <div className="liveboard__act">
            <span>Ny pris</span>
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            <button
              className="thin"
              disabled={Boolean(s.busy)}
              onClick={() => {
                const after = Number(price.replace(',', '.'));
                if (!Number.isFinite(after) || after <= 0 || after === offer.price) return;
                void s.liveChange({ kind: 'pris', offerId: offer.id, substituteId: null, before: offer.price, after, who });
                done();
              }}
            >Ret prisen</button>
          </div>
        </div>
      )}
    </div>
  );
}
