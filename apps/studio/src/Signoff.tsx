import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { APPROVAL_ROLE_NAMES, type CatalogDocument } from '@incitio/schema';
import * as api from './api.js';
import { useStudio } from './state.js';
import type { Finding } from './findings.js';
import { CHANGE_NAMES, LANE_SAID, familiarity, lanesOf, type Lane } from './approvals.js';
import { priceVerdicts, type PriceVerdict } from './pricerules.js';
import { changeFinding, signoffOf, verdictFinding, type Bucket, type Signoff } from './signoff-model.js';
import { count, kr, when } from './format.js';
import { quickFixOf } from './quickfix.js';
import { usePreviousWeek } from './week-diff.js';
import { knownNames, rememberName, useWho } from './who.js';
import { useMaySign } from './session.js';
import { BoardHead, Section, StandIn } from './Board.js';

/**
 * Godkend — the avis by its exceptions.
 *
 * The question on a Wednesday is not "what does the avis look like" but
 * "what still needs a person". Everything the studio can check, it
 * checks; this screen is only what it could not decide. A check that
 * found nothing is one line of text, not a card: the eye goes to what
 * is left. One primary action — publish — and it says why it is off.
 */

export function SignoffBoard() {
  const { document, findings, busy, brandId, catalogues, goToFinding, publish } = useStudio(useShallow((s) => ({
    document: s.variantBase ?? s.document,
    findings: s.findings,
    busy: Boolean(s.busy),
    brandId: s.brandId,
    catalogues: s.catalogues,
    goToFinding: s.goToFinding,
    publish: s.publish,
  })));
  const [who] = useWho();
  const previous = usePreviousWeek(document, brandId, catalogues);

  const lanes = useMemo(() => (document ? lanesOf(document) : []), [document]);
  const verdicts = useMemo(() => (document ? priceVerdicts(document) : []), [document]);
  const model = useMemo(
    () => (document ? signoffOf(document, findings, lanes, verdicts) : null),
    [document, findings, lanes, verdicts],
  );
  if (!document || !model) return null;

  const known = previous ? familiarity(previous, document) : null;

  return (
    <main className="book board signoff">
      <BoardHead
        title="Godkend"
        said={model.waiting === 0 ? 'Intet venter på en person' : `${count(model.waiting, 'ting venter', 'ting venter')} på en person — resten er tjekket`}
      >
        <Who />
        <button
          className="go"
          disabled={Boolean(model.blockedBy) || busy}
          onClick={() => void publish(who.trim())}
        >{model.published ? 'Udgivet' : 'Udgiv avisen'}</button>
        {model.blockedBy && !model.published && <span className="bhead__why">{model.blockedBy}</span>}
      </BoardHead>

      <Overview model={model} lanes={lanes} />

      {model.open.map((bucket) => <OpenBucket key={bucket.key} bucket={bucket} onGo={goToFinding} />)}

      <Section title="Underskrifter" aside={<span className="bsection__said">hver ser kun det, der er ændret siden de skrev under</span>}>
        <ul className="lanes">
          {lanes.map((lane) => <LaneRow key={lane.role} lane={lane} document={document} />)}
        </ul>
      </Section>

      {verdicts.length > 0 && <PriceTable verdicts={verdicts} document={document} onGo={goToFinding} />}

      {(known || (document.approvals?.length ?? 0) + (document.bookings?.length ?? 0) + (document.live?.length ?? 0) > 0) && (
        <Section title="Historik">
          {known && (
            <p className="signoff__fact">
              <b>{Math.round((known.same / Math.max(1, known.of)) * 100)} % genkendeligt</b> — {known.same} af {known.of} sider
              står, hvor de stod i {previous?.week ? `uge ${previous.week.week}` : 'sidste avis'}.
            </p>
          )}
          <History document={document} />
        </Section>
      )}
    </main>
  );
}

/**
 * The whole sign-off in one glance: a verdict, a bar, and every step as a
 * tile — the checks the studio ran, then the three signatures. Each tile
 * is one of three states, so what is left is the only thing that stands out.
 */
function Overview({ model, lanes }: { model: Signoff; lanes: Lane[] }) {
  const steps = [
    ...model.open.map((b) => ({ key: b.key, title: b.title, state: 'open' as const, said: count(b.lines.length, 'ting skal rettes', 'ting skal rettes') })),
    ...model.clean.map((b) => ({ key: b.key, title: b.title, state: 'ok' as const, said: b.clean })),
    ...lanes.map((l) => ({
      key: l.role, title: l.name,
      state: l.state === 'godkendt' ? 'ok' as const : l.state === 'forældet' ? 'open' as const : 'wait' as const,
      said: l.state === 'godkendt' ? `Godkendt af ${l.approval?.who ?? ''}` : l.state === 'forældet' ? 'Ændret siden underskrift' : 'Mangler underskrift',
    })),
  ];
  const done = steps.filter((step) => step.state === 'ok').length;
  const verdict = model.published ? 'Udgivet' : model.blockedBy ? 'Ikke klar til udgivelse' : 'Klar til udgivelse';
  const tone = model.published || !model.blockedBy ? 'ok' : model.open.length > 0 ? 'open' : 'wait';
  return (
    <section className={`overview overview--${tone}`}>
      <div className="overview__top">
        <div>
          <h3>{verdict}</h3>
          <p>{done} af {steps.length} trin er i orden{model.blockedBy && !model.published ? ` — ${model.blockedBy.toLowerCase()}` : ''}</p>
        </div>
        <div className="overview__bar" aria-hidden="true">
          {steps.map((step) => <i key={step.key} className={`is-${step.state}`} />)}
        </div>
      </div>
      <ul className="overview__steps">
        {steps.map((step) => (
          <li key={step.key} className={`step step--${step.state}`}>
            <span className="step__dot" aria-hidden="true">{step.state === 'ok' ? '✓' : step.state === 'open' ? '!' : '·'}</span>
            <b>{step.title}</b>
            <small>{step.said}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The name a signature carries: a field until it is typed, then just the name. */
function Who() {
  const [who, setWho] = useWho();
  const [editing, setEditing] = useState(!who);
  const document = useStudio((s) => s.variantBase ?? s.document);
  const names = useMemo(() => knownNames(document), [document, editing]);
  const settle = () => {
    if (!who.trim()) return;
    rememberName(who);
    setEditing(false);
  };
  if (!editing && who) {
    return (
      <span className="who">
        Som <b>{who}</b>
        <button className="linkish" onClick={() => setEditing(true)}>skift</button>
      </span>
    );
  }
  return (
    <form className="who" onSubmit={(event) => { event.preventDefault(); settle(); }}>
      <input
        autoFocus={Boolean(who)}
        value={who}
        onChange={(event) => setWho(event.target.value)}
        onBlur={settle}
        placeholder={names.length ? 'Vælg eller skriv dit navn' : 'Dit navn'}
        aria-label="Du godkender som"
        list={names.length ? 'who-names' : undefined}
      />
      {names.length > 0 && (
        <datalist id="who-names">{names.map((name) => <option key={name} value={name} />)}</datalist>
      )}
    </form>
  );
}

const MORE = 6;

function OpenBucket({ bucket, onGo }: { bucket: Bucket; onGo: (finding: Finding) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? bucket.lines : bucket.lines.slice(0, MORE);
  const { document, feed, emptySlots, quickFix } = useStudio(useShallow((s) => ({
    document: s.variantBase ?? s.document,
    feed: s.feedOffers,
    emptySlots: s.emptySlots,
    quickFix: s.quickFix,
  })));
  const fixes = useMemo(() => new Map(document
    ? shown.map((line) => [line.id, quickFixOf(document, line.finding, feed, (pageId) => emptySlots(pageId).length)] as const)
    : []), [document, shown, feed, emptySlots]);
  return (
    <section className={`exception exception--${bucket.key}`}>
      <h3><span className="exception__n">{bucket.lines.length}</span>{bucket.title}</h3>
      <ol>
        {shown.map((line) => (
          <li key={line.id} className={fixes.get(line.id) ? 'has-fix' : undefined}>
            <button onClick={() => onGo(line.finding)}>{line.said}</button>
            {fixes.get(line.id) && (
              <button className="fix" title={fixes.get(line.id)!.detail} onClick={() => quickFix(fixes.get(line.id)!)}>
                {fixes.get(line.id)!.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      {bucket.lines.length > MORE && (
        <button className="linkish" onClick={() => setAll(!all)}>
          {all ? 'Vis færre' : `Vis ${bucket.lines.length - MORE} mere`}
        </button>
      )}
    </section>
  );
}

const LaneRow = memo(function LaneRow({ lane, document }: { lane: Lane; document: CatalogDocument }) {
  const { busy, approve, unapprove, goToFinding } = useStudio(useShallow((s) => ({
    busy: Boolean(s.busy), approve: s.approve, unapprove: s.unapprove, goToFinding: s.goToFinding,
  })));
  const [who] = useWho();
  const name = who.trim();
  const allowed = useMaySign(lane.role);
  const notYours = allowed ? '' : `Kun for ${APPROVAL_ROLE_NAMES[lane.role].toLowerCase()} — bed en admin om rollen`;
  const state = lane.state === 'godkendt' ? 'Godkendt'
    : lane.state === 'forældet' ? count(lane.changes.length, 'ændring', 'ændringer') : 'Mangler';

  return (
    <li className={`lane lane--${lane.state}`}>
      <div className="lane__lines">
        <b>{lane.name}</b>
        <small>
          {lane.approval
            ? `${lane.state === 'forældet' ? 'Godkendte' : 'Godkendt af'} ${lane.approval.who} · ${when(lane.approval.at)}`
            : LANE_SAID[lane.role]}
        </small>
        {lane.state === 'forældet' && (
          <ul className="lane__changes">
            {lane.changes.slice(0, 8).map((change) => (
              <li key={change.id}>
                <button onClick={() => goToFinding(changeFinding(change, document))}>
                  <i>{CHANGE_NAMES[change.kind]}</i>{change.said}
                </button>
              </li>
            ))}
            {lane.changes.length > 8 && <li className="lane__more">+ {lane.changes.length - 8} mere</li>}
          </ul>
        )}
      </div>
      <span className="lane__state">{state}</span>
      <div className="lane__acts">
        {lane.approval && (
          <button className="linkish" disabled={busy || !allowed} title={notYours} onClick={() => void unapprove(lane.role)}>Træk tilbage</button>
        )}
        {lane.state !== 'godkendt' && (
          <button
            className="thin"
            disabled={!name || busy || !allowed}
            title={notYours || (name ? '' : 'Skriv dit navn øverst')}
            onClick={() => void approve(lane.role, name)}
          >
            {lane.state === 'forældet' ? 'Godkend ændringerne' : `Godkend som ${APPROVAL_ROLE_NAMES[lane.role].toLowerCase()}`}
          </button>
        )}
      </div>
    </li>
  );
});

/** Who signed and what happened after, newest first — the answer to "who changed the price?". */
function History({ document }: { document: CatalogDocument }) {
  const names = new Map(document.offers.map((o) => [o.id, o.name]));
  const events = [
    ...(document.approvals ?? []).map((a) => ({ at: a.at, said: `${APPROVAL_ROLE_NAMES[a.role]} godkendt af ${a.who}` })),
    ...(document.bookings ?? []).map((b) => ({ at: b.at, said: `Plads solgt til ${b.supplier}` })),
    ...(document.live ?? []).map((e) => {
      const name = names.get(e.offerId) ?? 'vare';
      return { at: e.at, said: e.kind === 'udsolgt' ? `Live: ${name} udsolgt` : e.kind === 'pris' ? `Live: ${name} ny pris` : `Live: ${name} tilbage` };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (events.length === 0) return null;
  return (
    <ol className="log">
      {events.slice(0, 12).map((event, index) => (
        <li key={index}><time>{when(event.at)}</time><span>{event.said}</span></li>
      ))}
    </ol>
  );
}

/** Thirty days of shelf price as a line, the claimed "før" as a dashed rule over it. */
function Spark({ verdict }: { verdict: PriceVerdict }) {
  const w = 120;
  const h = 22;
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
 * The evidence behind the Prisregler check. Prices that break the rule
 * are listed; the ones that hold are one click away, because nobody
 * acts on a row that says "fine".
 */
function PriceTable({ verdicts, document, onGo }: { verdicts: PriceVerdict[]; document: CatalogDocument; onGo: (finding: Finding) => void }) {
  const bad = verdicts.filter((v) => !v.ok);
  const [all, setAll] = useState(false);
  const rows = all || bad.length === 0 ? [...bad, ...verdicts.filter((v) => v.ok)] : bad;
  const go = (offerId: string) => { const finding = verdictFinding(offerId, document); if (finding) onGo(finding); };
  return (
    <Section
      title="Førpriser"
      aside={<>
        <span className="bsection__said">laveste pris de sidste 30 dage før avisen starter</span>
        <StandIn what="Eksempel-prishistorik" />
      </>}
    >
      {(all || bad.length > 0) && (
        <div className="rows prices" role="table">
          <div className="rows__head" role="row">
            <span>Vare</span><span>Pris</span><span>Førpris</span><span>Laveste 30 dage</span><span>30 dage</span><span />
          </div>
          {rows.map((v) => (
            <button key={v.offer.id} role="row" className={v.ok ? '' : 'is-bad'} onClick={() => go(v.offer.id)}>
              <span>{v.offer.name}</span>
              <span>{kr(v.offer.price)}</span>
              <span>{kr(v.claimed)}</span>
              <span>{kr(v.lowest)}</span>
              <span><Spark verdict={v} /></span>
              <span className="prices__verdict">{v.ok ? 'Må bruges' : 'For høj'}</span>
            </button>
          ))}
        </div>
      )}
      {bad.length < verdicts.length && (
        <button className="linkish" onClick={() => setAll(!all)}>
          {all ? 'Skjul dem der holder' : `Vis ${count(verdicts.length - bad.length, 'førpris', 'førpriser')} der holder`}
        </button>
      )}
    </Section>
  );
}
