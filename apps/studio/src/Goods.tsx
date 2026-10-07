import { useEffect, useMemo, useState } from 'react';
import type { Offer } from '@incitio/schema';
import { DEPARTMENTS, DEPARTMENT_NAMES, departmentOf, offerImportance, type Department } from '@incitio/compose';
import { formatPrice, sizedImage } from '@incitio/renderer';
import { THUMB_PX, count, isVariantPiece, useStudio, useStudioPick } from './state.js';

/**
 * Varer — the whole week's products on one screen.
 *
 * The shelf beside a page answers "what can go HERE"; this answers "is
 * the week in the avis": every product, where it stands, and what is
 * wrong with it before it prints — no picture, no price, a strong offer
 * nobody placed. Picked products go onto a page from here in one step.
 */

type Show = 'alle' | 'ikke' | 'skalmed' | 'skalmed-mangler' | 'staerke' | 'billede' | 'pris' | 'placeret';
type SortKey = 'afdeling' | 'navn' | 'pris' | 'styrke' | 'side';

const SHOW_WORDS: Record<Show, string> = {
  alle: 'Alle',
  ikke: 'Ikke placeret',
  skalmed: '★ Skal med',
  'skalmed-mangler': '★ Skal med, mangler',
  staerke: 'Stærke, ikke med',
  billede: 'Uden billede',
  pris: 'Uden pris',
  placeret: 'På en side',
};

interface Row {
  offer: Offer;
  department: Department;
  strength: number;
  /** The page it prints on, by id and number — null in the reserve. */
  page: { id: string; number: number } | null;
  strong: boolean;
  /** The chain says it must be in the avis. */
  must: boolean;
}

export function GoodsBoard() {
  const s = useStudioPick(
    'addOffersToPage', 'brand', 'document', 'feed', 'feedOffers', 'goToOffer', 'goodsShow', 'openPage',
    'setMustInclude', 'uploadFeed'
  );
  const [show, setShow] = useState<Show>('alle');
  const [department, setDepartment] = useState<Department | ''>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: 'afdeling', up: true });
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState('');

  const document = s.document;
  const rules = s.brand?.offerRules;

  // Sent here by a line in the checks: open on what it was about, once.
  useEffect(() => {
    const asked = s.goodsShow;
    if (asked && asked in SHOW_WORDS) setShow(asked as Show);
    if (asked) useStudio.setState({ goodsShow: null });
  }, [s.goodsShow]);

  const rows = useMemo<Row[]>(() => {
    if (!document) return [];
    // The feed's products, then any the avis has that the feed does not — as the shelf lists them.
    const seen = new Set(s.feedOffers.map((offer) => offer.id));
    const all = [...s.feedOffers, ...document.offers.filter((offer) => !seen.has(offer.id))]
      .filter((offer) => !isVariantPiece(offer.id) && offer.members.length === 0);
    const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
    const where = new Map<string, { id: string; number: number }>();
    document.pages.forEach((page, index) => {
      for (const placement of page.placements) {
        const at = { id: page.id, number: index + 1 };
        where.set(placement.offerId, at);
        // A product inside a grouped tile prints there too.
        for (const member of byId.get(placement.offerId)?.members ?? []) where.set(member, at);
      }
    });
    const strengths = all.map((offer) => offerImportance(offer, rules));
    // "Strong" is the top quarter of this week's products by rank, not a fixed score — ties do not widen it.
    const top = new Set(strengths.map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value).slice(0, Math.ceil(all.length / 4)).map((entry) => entry.index));
    const must = new Set(document.mustInclude ?? []);
    return all.map((offer, index) => ({
      must: must.has(offer.id),
      offer,
      department: departmentOf(offer),
      strength: strengths[index]!,
      page: where.get(offer.id) ?? null,
      strong: top.has(index),
    }));
  }, [document, s.feedOffers, rules]);

  /* The chain's campaigns this week, for marking one whole campaign "skal med". */
  const campaigns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row.offer.campaign) counts.set(row.offer.campaign, (counts.get(row.offer.campaign) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const tests: Record<Show, (row: Row) => boolean> = {
    alle: () => true,
    ikke: (row) => !row.page,
    skalmed: (row) => row.must,
    'skalmed-mangler': (row) => row.must && !row.page,
    staerke: (row) => row.strong && !row.page,
    billede: (row) => !row.offer.imageUrl,
    pris: (row) => !(row.offer.price > 0),
    placeret: (row) => Boolean(row.page),
  };
  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter(tests[show])
    .filter((row) => !department || row.department === department)
    .filter((row) => !needle || `${row.offer.brand} ${row.offer.name} ${row.offer.description}`.toLowerCase().includes(needle));
  const direction = sort.up ? 1 : -1;
  const compare: Record<SortKey, (a: Row, b: Row) => number> = {
    afdeling: (a, b) => DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department) || b.strength - a.strength,
    navn: (a, b) => a.offer.name.localeCompare(b.offer.name, 'da'),
    pris: (a, b) => a.offer.price - b.offer.price,
    styrke: (a, b) => b.strength - a.strength,
    side: (a, b) => (a.page?.number ?? 999) - (b.page?.number ?? 999),
  };
  shown.sort((a, b) => compare[sort.key](a, b) * direction);

  if (!document) return null;
  const pages = document.pages.map((page, index) => ({ page, number: index + 1 })).filter(({ page }) => page.kind === 'offers');
  const toPage = target || pages[0]?.page.id || '';
  const counts = Object.fromEntries((Object.keys(SHOW_WORDS) as Show[]).map((key) => [key, rows.filter(tests[key]).length])) as Record<Show, number>;
  const sortBy = (key: SortKey) => setSort((was) => ({ key, up: was.key === key ? !was.up : true }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.up ? ' ↑' : ' ↓') : '');
  const pickable = shown;
  const allPicked = pickable.length > 0 && pickable.every((row) => picked.includes(row.offer.id));
  // Only what is in the reserve can become a new cell; the pick may hold placed ones too, for marking.
  const waiting = picked.filter((id) => !rows.find((row) => row.offer.id === id)?.page);

  const go = (row: Row) => {
    if (!row.page) return;
    s.openPage(row.page.id);
    window.setTimeout(() => s.goToOffer(row.offer.id), 60);
  };

  return (
    <main className="book goods">
      <div className="book__head">
        <h2>Varer</h2>
        <span className="book__said" title="Hele ugens varer — hvor de står, og hvad der mangler">
          {counts.alle} varer · {counts.placeret} på en side
          {counts['skalmed-mangler'] > 0 && <> · <b className="book__open book__open--stop">{counts['skalmed-mangler']} skal med, mangler</b></>}
        </span>
        <div className="book__gap" />
        {/* The week's file: new products, or Wednesday's corrections — the avis asks which. */}
        <label className="thin goods__file" title="Ugens varefil — nye varer eller rettelser til denne uge">
          <input
            type="file"
            accept=".csv,.json,.txt,.xml"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) await s.uploadFeed(file.name, await file.text());
            }}
          />
          Hent varefil{s.feed ? <i>{s.feed.source}</i> : null}
        </label>
      </div>

      <div className="goods__bar">
        <input className="editions__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg efter en vare" />
        <select className="goods__select" value={department} onChange={(event) => setDepartment(event.target.value as Department | '')}>
          <option value="">Alle afdelinger</option>
          {DEPARTMENTS.filter((d) => rows.some((row) => row.department === d)).map((d) => (
            <option key={d} value={d}>{DEPARTMENT_NAMES[d]} · {rows.filter((row) => row.department === d).length}</option>
          ))}
        </select>
        {campaigns.length > 0 && (
          <select
            className="goods__select"
            value=""
            onChange={(event) => {
              const campaign = event.target.value;
              if (!campaign) return;
              s.setMustInclude(rows.filter((row) => row.offer.campaign === campaign).map((row) => row.offer.id), true);
              setShow('skalmed');
            }}
            title="Markér alle varer i en kampagne som skal med"
          >
            <option value="">★ Markér en kampagne…</option>
            {campaigns.map(([campaign, n]) => <option key={campaign} value={campaign}>{campaign} · {n}</option>)}
          </select>
        )}
        <div className="goods__chips">
          {/* A filter that would show nothing is not offered — except the one in use, so it can be left. */}
          {(Object.keys(SHOW_WORDS) as Show[]).filter((key) => key === 'alle' || key === show || counts[key] > 0).map((key) => (
            <button
              key={key}
              className={`tag tag--pick${show === key ? ' is-on' : ''}${(key === 'billede' || key === 'pris' || key === 'staerke' || key === 'skalmed-mangler') && counts[key] > 0 ? ' goods__warn' : ''}`}
              onClick={() => setShow(key)}
            >{SHOW_WORDS[key]} · {counts[key]}</button>
          ))}
        </div>
      </div>

      <div className="goods__table" role="table">
        <div className="goods__row goods__row--head" role="row">
          <span>
            <input
              type="checkbox"
              aria-label="Vælg alle viste"
              checked={allPicked}
              disabled={pickable.length === 0}
              onChange={() => setPicked(allPicked ? [] : [...new Set([...picked, ...pickable.map((row) => row.offer.id)])])}
            />
          </span>
          <span title="Skal med">★</span>
          <span />
          <button onClick={() => sortBy('navn')}>Vare{arrow('navn')}</button>
          <button onClick={() => sortBy('afdeling')}>Afdeling{arrow('afdeling')}</button>
          <button onClick={() => sortBy('pris')}>Pris{arrow('pris')}</button>
          <button onClick={() => sortBy('styrke')}>Styrke{arrow('styrke')}</button>
          <button onClick={() => sortBy('side')}>Side{arrow('side')}</button>
        </div>
        {shown.length === 0 && <p className="editions__empty">Ingen varer passer.</p>}
        {shown.map((row) => {
          const { offer } = row;
          const saving = offer.prePrice && offer.prePrice > offer.price ? offer.prePrice - offer.price : offer.savings;
          return (
            <div key={offer.id} className={`goods__row${picked.includes(offer.id) ? ' is-picked' : ''}`} role="row">
              <span>
                <input
                  type="checkbox"
                  aria-label={`Vælg ${offer.name}`}
                  checked={picked.includes(offer.id)}
                  onChange={() => setPicked((was) => (was.includes(offer.id) ? was.filter((id) => id !== offer.id) : [...was, offer.id]))}
                />
              </span>
              <span>
                <button
                  className={`goods__must${row.must ? ' is-on' : ''}`}
                  aria-pressed={row.must}
                  title={row.must ? 'Skal med — klik for at fjerne' : 'Markér som skal med i avisen'}
                  onClick={() => s.setMustInclude([offer.id], !row.must)}
                >★</button>
              </span>
              <span className="goods__shot">
                {offer.imageUrl
                  ? <img src={sizedImage(offer.imageUrl, THUMB_PX)} alt="" loading="lazy" decoding="async" />
                  : <i>intet billede</i>}
              </span>
              <span className="goods__name">
                <b>{offer.name}</b>
                <small>{[offer.brand, offer.pack, offer.description].filter(Boolean).join(' · ').slice(0, 110)}</small>
              </span>
              <span className="goods__muted">{DEPARTMENT_NAMES[row.department]}</span>
              <span>
                {offer.price > 0 ? <b>{formatPrice(offer.price, offer.currency)}</b> : <span className="editions__bad">ingen pris</span>}
                {saving ? <small className="goods__muted"> · spar {formatPrice(saving, offer.currency)}</small> : null}
              </span>
              <span>{row.strong ? <span className="goods__strong">stærk</span> : <span className="goods__muted">—</span>}</span>
              <span>
                {row.page
                  ? <button className="linkish goods__page" onClick={() => go(row)}>side {row.page.number}</button>
                  : <span className="goods__muted">ikke placeret</span>}
              </span>
            </div>
          );
        })}
      </div>

      {picked.length > 0 && (
        <footer className="goods__picked">
          <b>{count(picked.length, 'vare valgt', 'varer valgt')}</b>
          <button className="thin" onClick={() => setPicked([])}>Ryd</button>
          <button className="thin" onClick={() => { s.setMustInclude(picked, true); setPicked([]); }}>★ Skal med</button>
          <button className="thin" onClick={() => { s.setMustInclude(picked, false); setPicked([]); }}>Fjern ★</button>
          <div className="book__gap" />
          <label className="goods__to">
            <span>Tilføj til</span>
            <select value={toPage} onChange={(event) => setTarget(event.target.value)}>
              {pages.map(({ page, number }) => (
                <option key={page.id} value={page.id}>side {number}{page.title ? ` — ${page.title}` : ''}</option>
              ))}
            </select>
          </label>
          <button
            className="go"
            disabled={!toPage || waiting.length === 0}
            onClick={() => {
              s.addOffersToPage(toPage, waiting);
              setPicked([]);
            }}
            title={waiting.length === 0 ? 'De valgte varer står allerede på en side' : 'Hver vare får sin egen plads — siden får flere pladser, hvis den mangler'}
          >{waiting.length === picked.length ? 'Tilføj som nye pladser' : `Tilføj ${waiting.length} ikke placerede`}</button>
        </footer>
      )}
    </main>
  );
}
