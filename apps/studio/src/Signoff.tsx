import { useEffect, useMemo, useState } from 'react';
import { APPROVAL_ROLE_NAMES, type CatalogDocument } from '@incitio/schema';
import * as api from './api.js';
import { useStudio } from './state.js';
import type { Finding } from './findings.js';
import { CHANGE_NAMES, LANE_SAID, familiarity, lanesOf, type Change, type Lane } from './approvals.js';
import { priceVerdicts, type PriceVerdict } from './pricerules.js';
import { DEMO_NOTE, SIGNALS_ARE_DEMO } from './signals.js';

/**
 * Godkend — the avis by its exceptions.
 *
 * The question on a Wednesday is not "what does the avis look like" but
 * "what still needs a person". Everything the studio can check, it
 * checks; this screen is only what it could not decide: what stops the
 * print, what breaks a price rule, what a supplier paid for and is not
 * getting, and what changed since somebody signed. When all four are
 * empty and every role has signed, the avis goes out from here.
 */

const WHO_KEY = 'incitio.who';

function rememberedWho(): string {
  try { return window.localStorage.getItem(WHO_KEY) ?? ''; } catch { return ''; }
}

function when(iso: string): string {
  const then = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = then.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `i dag ${time}`;
  if (days === 1) return `i går ${time}`;
  return `${then.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${time}`;
}

/** A change, as something `goToFinding` can walk to. */
function asFinding(change: Change, document: CatalogDocument): Finding {
  const index = change.pageId ? document.pages.findIndex((page) => page.id === change.pageId) : -1;
  return {
    id: change.id,
    kind: change.kind === 'pris' ? 'pris' : 'plads',
    said: change.said,
    pageId: index >= 0 ? change.pageId : null,
    pageNumber: index >= 0 ? index + 1 : null,
    offerId: change.offerId,
    weight: 'se',
  };
}

interface Bucket {
  key: string;
  title: string;
  said: string;
  /** What was checked and found in order — so a clean bucket says what it looked at. */
  clean?: string;
  lines: { id: string; said: string; go: () => void }[];
}

export function SignoffBoard() {
  const s = useStudio();
  const document = s.variantBase ?? s.document;
  const [who, setWho] = useState(rememberedWho);
  const [previous, setPrevious] = useState<CatalogDocument | null>(null);

  // Last week's avis, for how much of this one a reader will recognise.
  useEffect(() => {
    if (!document?.week || !s.brandId) return;
    const order = (w: { year: number; week: number } | null) => (w ? w.year * 100 + w.week : 0);
    const before = s.catalogues
      .filter((c) => c.id !== document.id && c.week && order(c.week) < order(document.week) && c.status !== 'skjult')
      .sort((a, b) => order(b.week) - order(a.week))[0];
    if (!before) { setPrevious(null); return; }
    let live = true;
    void api.fetchCatalogue(s.brandId, before.id).then((doc) => { if (live) setPrevious(doc); }, () => {});
    return () => { live = false; };
  }, [document?.id, s.brandId, s.catalogues.length]);

  const lanes = useMemo(() => (document ? lanesOf(document) : []), [document]);
  const verdicts = useMemo(() => (document ? priceVerdicts(document) : []), [document]);
  if (!document) return null;

  const saveWho = (value: string) => {
    setWho(value);
    try { window.localStorage.setItem(WHO_KEY, value); } catch { /* the field still holds it */ }
  };

  const go = (finding: Finding) => () => s.goToFinding(finding);
  const stops = s.findings.filter((f) => f.weight === 'stop' && f.kind !== 'førpris' && f.kind !== 'solgt');
  const prices = s.findings.filter((f) => f.kind === 'førpris');
  const sold = s.findings.filter((f) => f.kind === 'solgt');
  const changed = new Map<string, Change>();
  for (const lane of lanes) for (const change of lane.changes) changed.set(change.id, change);

  const buckets: Bucket[] = [
    {
      key: 'tryk', title: 'Skal rettes før tryk', said: 'Tomme pladser, tekst der er skåret af, varer uden pris',
      clean: 'Alle sider er tjekket',
      lines: stops.map((f) => ({ id: f.id, said: f.said, go: go(f) })),
    },
    {
      key: 'pris', title: 'Prisregler', said: 'Førpris mod laveste pris i 30 dage, spar-beløb, medlemspris',
      clean: verdicts.length ? `${verdicts.length} ${verdicts.length === 1 ? 'førpris' : 'førpriser'} tjekket mod 30 dages laveste pris` : 'Ingen førpriser i avisen',
      lines: prices.map((f) => ({ id: f.id, said: f.said, go: go(f) })),
    },
    {
      key: 'solgt', title: 'Solgte pladser', said: 'Leverandører der har betalt for en plads',
      clean: document.bookings?.length ? `${document.bookings.length} solgte ${document.bookings.length === 1 ? 'plads viser' : 'pladser viser'} det aftalte` : 'Ingen pladser solgt',
      lines: sold.map((f) => ({ id: f.id, said: f.said, go: go(f) })),
    },
    {
      key: 'ændret', title: 'Ændret efter godkendelse', said: 'Det der skal ses igen — kun det',
      clean: lanes.some((lane) => lane.approval) ? 'Intet ændret siden underskrift' : 'Ingen har skrevet under endnu',
      lines: [...changed.values()].map((c) => ({ id: c.id, said: c.said, go: go(asFinding(c, document)) })),
    },
  ];
  const open = buckets.reduce((sum, bucket) => sum + bucket.lines.length, 0);
  const blocking = stops.length + prices.filter((f) => f.weight === 'stop').length + sold.length;
  const unsigned = lanes.filter((lane) => lane.state !== 'godkendt');
  const published = document.status === 'udgivet';
  const known = previous ? familiarity(previous, document) : null;

  return (
    <main className="book board signoff">
      <div className="book__head">
        <h2>Godkend</h2>
        <span className="book__said">
          {open === 0
            ? 'Intet venter på en person'
            : `${open} ${open === 1 ? 'ting venter' : 'ting venter'} på en person — resten er tjekket`}
        </span>
        <div className="book__gap" />
        <label className="signoff__who">
          <span>Du godkender som</span>
          <input value={who} onChange={(event) => saveWho(event.target.value)} placeholder="Dit navn" />
        </label>
        <button
          className="go"
          disabled={published || blocking > 0 || unsigned.length > 0 || Boolean(s.busy)}
          title={published ? 'Avisen er udgivet' : blocking > 0
            ? `${blocking} skal rettes først`
            : unsigned.length > 0 ? `Mangler godkendelse fra ${unsigned.map((l) => l.name).join(', ')}` : 'Udgiv avisen'}
          onClick={() => void s.publish(who.trim())}
        >{published ? 'Udgivet ✓' : 'Udgiv avisen'}</button>
      </div>

      <section className="signoff__buckets">
        {buckets.map((bucket) => (
          <div key={bucket.key} className={`signoff__bucket${bucket.lines.length ? ' has-lines' : ''} signoff__bucket--${bucket.key}`}>
            <div className="signoff__bhead">
              <b className="signoff__n">{bucket.lines.length || '✓'}</b>
              <span><b>{bucket.title}</b><small>{bucket.said}</small></span>
            </div>
            {bucket.lines.length === 0 && bucket.clean && <p className="signoff__clean">{bucket.clean}</p>}
            {bucket.lines.length > 0 && (
              <ol className="signoff__lines">
                {bucket.lines.slice(0, 6).map((line) => (
                  <li key={line.id}><button onClick={line.go}>{line.said}</button></li>
                ))}
                {bucket.lines.length > 6 && <li className="signoff__more">+ {bucket.lines.length - 6} mere</li>}
              </ol>
            )}
          </div>
        ))}
      </section>

      <section className="signoff__lanes">
        <div className="home__archhead"><h3>Godkendelser</h3><span className="home__muted">hver ser kun det, der er ændret siden de skrev under</span></div>
        <div className="signoff__lanegrid">
          {lanes.map((lane) => <LaneCard key={lane.role} lane={lane} who={who} document={document} />)}
        </div>
      </section>

      {verdicts.length > 0 && <PriceTable verdicts={verdicts} />}

      <section className="signoff__facts">
        {known && (
          <div className="signoff__fact">
            <b>{Math.round((known.same / Math.max(1, known.of)) * 100)}%</b>
            <span>
              genkendeligt — {known.same} af {known.of} sider står, hvor de stod i {previous?.week ? `uge ${previous.week.week}` : 'sidste avis'}.
              <small> Læserne finder vej efter vane; jo flere sider der flytter, jo mere leder de.</small>
            </span>
          </div>
        )}
        <History document={document} />
      </section>
    </main>
  );
}

function LaneCard({ lane, who, document }: { lane: Lane; who: string; document: CatalogDocument }) {
  const s = useStudio();
  const busy = Boolean(s.busy);
  const name = who.trim();
  return (
    <div className={`signoff__lane signoff__lane--${lane.state}`}>
      <div className="signoff__lanehead">
        <b>{lane.name}</b>
        <i className={`signoff__state signoff__state--${lane.state}`}>
          {lane.state === 'godkendt' ? 'Godkendt' : lane.state === 'forældet' ? `${lane.changes.length} ${lane.changes.length === 1 ? 'ændring' : 'ændringer'}` : 'Mangler'}
        </i>
      </div>
      <small className="signoff__covers">{LANE_SAID[lane.role]}</small>
      {lane.approval && (
        <span className="signoff__by">
          {lane.state === 'forældet' ? 'Godkendte' : 'Godkendt af'} {lane.approval.who} · {when(lane.approval.at)}
        </span>
      )}
      {lane.state === 'forældet' && (
        <ul className="signoff__changes">
          {lane.changes.slice(0, 8).map((change) => (
            <li key={change.id}>
              <button onClick={() => s.goToFinding(asFinding(change, document))}>
                <i>{CHANGE_NAMES[change.kind]}</i>{change.said}
              </button>
            </li>
          ))}
          {lane.changes.length > 8 && <li className="signoff__more">+ {lane.changes.length - 8} mere</li>}
        </ul>
      )}
      <div className="signoff__acts">
        {lane.state !== 'godkendt' && (
          <button
            className="go"
            disabled={!name || busy}
            title={name ? '' : 'Skriv dit navn øverst'}
            onClick={() => void s.approve(lane.role, name)}
          >
            {lane.state === 'forældet'
              ? `Godkend ${lane.changes.length === 1 ? 'ændringen' : `de ${lane.changes.length} ændringer`}`
              : `Godkend som ${APPROVAL_ROLE_NAMES[lane.role].toLowerCase()}`}
          </button>
        )}
        {lane.approval && (
          <button className="linkish" disabled={busy} onClick={() => void s.unapprove(lane.role)}>Træk tilbage</button>
        )}
      </div>
    </div>
  );
}

/** Who signed and what happened after, newest first — the answer to "who changed the price?". */
function History({ document }: { document: CatalogDocument }) {
  const events = [
    ...(document.approvals ?? []).map((a) => ({ at: a.at, said: `${APPROVAL_ROLE_NAMES[a.role]} godkendt af ${a.who}` })),
    ...(document.bookings ?? []).map((b) => ({ at: b.at, said: `Plads solgt til ${b.supplier}` })),
    ...(document.live ?? []).map((e) => {
      const name = document.offers.find((o) => o.id === e.offerId)?.name ?? 'vare';
      return {
        at: e.at,
        said: e.kind === 'udsolgt' ? `Live: ${name} udsolgt` : e.kind === 'pris' ? `Live: ${name} ny pris` : `Live: ${name} tilbage`,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (events.length === 0) return null;
  return (
    <div className="signoff__history">
      <h3>Hvem gjorde hvad</h3>
      <ol>
        {events.slice(0, 12).map((event, index) => (
          <li key={index}><time>{when(event.at)}</time><span>{event.said}</span></li>
        ))}
      </ol>
    </div>
  );
}

const kr = (value: number) => (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

/** Thirty days of shelf price as a line, the claimed "før" as a dashed rule over it. */
function Spark({ verdict }: { verdict: PriceVerdict }) {
  const w = 120;
  const h = 26;
  const top = Math.max(verdict.claimed, ...verdict.days);
  const bottom = Math.min(verdict.offer.price, ...verdict.days);
  const y = (value: number) => (top === bottom ? h / 2 : 3 + (1 - (value - bottom) / (top - bottom)) * (h - 6));
  const points = verdict.days.map((value, index) => `${(index / (verdict.days.length - 1)) * w},${y(value).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1="0" x2={w} y1={y(verdict.claimed)} y2={y(verdict.claimed)} className="spark__claim" />
      <polyline points={points} className={`spark__line${verdict.ok ? '' : ' is-bad'}`} />
    </svg>
  );
}

/**
 * Every "før" the avis prints, held against its last 30 days.
 *
 * The check is a line in the bucket above when it fails; this is the
 * evidence either way — what a price manager would otherwise rebuild
 * from the price file, one product at a time.
 */
function PriceTable({ verdicts }: { verdicts: PriceVerdict[] }) {
  const s = useStudio();
  const sorted = [...verdicts].sort((a, b) => Number(a.ok) - Number(b.ok));
  const document = s.variantBase ?? s.document;
  const walk = (offerId: string) => {
    const index = document?.pages.findIndex((page) => page.placements.some((p) => p.offerId === offerId)) ?? -1;
    if (!document || index < 0) return;
    s.goToFinding({ id: `pris:${offerId}`, kind: 'førpris', said: '', pageId: document.pages[index]!.id, pageNumber: index + 1, offerId, weight: 'se' });
  };
  return (
    <section className="signoff__prices">
      <div className="home__archhead">
        <h3>Førpriser</h3>
        <span className="home__muted">laveste pris de sidste 30 dage før avisen starter</span>
        {SIGNALS_ARE_DEMO && <span className="demo" title={DEMO_NOTE}>Eksempel-prishistorik</span>}
      </div>
      <div className="signoff__ptable" role="table">
        <div className="signoff__prow signoff__prow--head" role="row">
          <span>Vare</span><span>Pris</span><span>Førpris i avisen</span><span>Laveste 30 dage</span><span>30 dage</span><span />
        </div>
        {sorted.map((v) => (
          <button key={v.offer.id} role="row" className={`signoff__prow${v.ok ? '' : ' is-bad'}`} onClick={() => walk(v.offer.id)}>
            <span>{v.offer.name}</span>
            <span>{kr(v.offer.price)}</span>
            <span>{kr(v.claimed)}</span>
            <span>{kr(v.lowest)}</span>
            <span><Spark verdict={v} /></span>
            <span className="signoff__pverdict">{v.ok ? '✓ Må bruges' : '✕ For høj'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
