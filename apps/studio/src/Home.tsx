import { useMemo, useRef, useState } from 'react';
import { nextWeek, weekOf, weekRange, type CatalogWeek } from '@incitio/schema';
import type { CatalogStatus, CatalogSummary } from './api.js';
import { useStudio } from './state.js';
import { usePopover } from './popover.js';

/**
 * Forsiden — where a week's work starts.
 *
 * Two questions on a Monday: is this week's avis done, and has next
 * week's been started. So the page is those two weeks, large, each with
 * its avis or one button that makes it. Everything older is a short
 * list under them. What an avis is called, its status and putting it
 * away are there when asked for, behind its ⋯ — not on every row.
 */

const STATUS_WORDS: Record<CatalogStatus, string> = {
  kladde: 'Kladde',
  klar: 'Klar til godkendelse',
  udgivet: 'Udgivet',
  skjult: 'Lagt væk',
};

const sameWeek = (a: CatalogWeek | null, b: CatalogWeek) => Boolean(a && a.year === b.year && a.week === b.week);
const order = (w: CatalogWeek | null) => (w ? w.year * 100 + w.week : 0);

/** "i dag 14.32", "i går", "25. sep." — when it was last worked on, as a person says it. */
function lately(iso: string): string {
  const then = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `i dag ${then.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'i går';
  return then.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

const SHORT_LIST = 5;

export function Home() {
  const s = useStudio();
  const [all, setAll] = useState(false);
  const [making, setMaking] = useState<CatalogWeek | null>(null);
  const today = weekOf(new Date());
  const coming = nextWeek(today);
  const openId = (s.variantBase ?? s.document)?.id ?? null;

  const { thisWeek, nextOne, others, latest, awayFor } = useMemo(() => {
    const visible = s.catalogues.filter((c) => c.status !== 'skjult');
    const dated = visible.filter((c) => c.week).sort((a, b) => order(b.week) - order(a.week) || b.updatedAt.localeCompare(a.updatedAt));
    const mine = visible.filter((c) => sameWeek(c.week, today));
    const next = visible.filter((c) => sameWeek(c.week, coming));
    const shown = new Set([mine[0]?.id, next[0]?.id]);
    const away = s.catalogues.filter((c) => c.status === 'skjult');
    return {
      thisWeek: mine,
      nextOne: next,
      // A week whose avis was put away says so, rather than "no avis".
      awayFor: (week: CatalogWeek) => away.find((c) => sameWeek(c.week, week)) ?? null,
      // Everything else, newest first; the put-away ones only when the whole list is asked for.
      others: s.catalogues
        .filter((c) => !shown.has(c.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      // What a new week is made from: the newest avis with a week before it.
      latest: (week: CatalogWeek) => dated.find((c) => order(c.week) < order(week)) ?? null,
    };
  }, [s.catalogues, today.week, today.year]);

  const listed = others.filter((c) => all || c.status !== 'skjult');
  const shortList = all ? listed : listed.slice(0, SHORT_LIST);
  const current = s.brands.find((brand) => brand.id === s.brandId);

  return (
    <main className="book home">
      <header className="home__head">
        <h2>Uge {today.week}</h2>
        <span>{weekRange(today)}</span>
      </header>

      <div className="home__weeks">
        <WeekCard label="Denne uge" week={today} avis={thisWeek[0] ?? null} away={awayFor(today)} openId={openId} onMake={() => setMaking(today)} />
        <WeekCard label="Næste uge" week={coming} avis={nextOne[0] ?? null} away={awayFor(coming)} openId={openId} onMake={() => setMaking(coming)} />
      </div>

      {listed.length > 0 && (
        <section className="home__archive">
          <h3>Andre aviser</h3>
          <div className="home__rows">
            {shortList.map((c) => <Row key={c.id} item={c} openId={openId} />)}
          </div>
          {others.length > SHORT_LIST && (
            <button className="linkish home__toggle" onClick={() => setAll(!all)}>
              {all ? 'Vis færre' : `Vis alle ${others.length}`}
            </button>
          )}
        </section>
      )}

      {s.brands.length > 1 && (
        <footer className="home__foot">
          <label>
            <span>Kæde</span>
            <select value={s.brandId ?? ''} disabled={Boolean(s.busy)} onChange={(event) => void s.signInAs(event.target.value)}>
              {s.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          {current && <span className="home__muted">Du arbejder i {current.name}</span>}
        </footer>
      )}

      {making && <NewAvis week={making} from={latest(making)} onClose={() => setMaking(null)} />}
    </main>
  );
}

/** One of the two weeks that matter: its avis, or one button that makes it. */
function WeekCard({ label, week, avis, away, openId, onMake }: {
  label: string;
  week: CatalogWeek;
  avis: CatalogSummary | null;
  away: CatalogSummary | null;
  openId: string | null;
  onMake: () => void;
}) {
  const s = useStudio();
  const open = avis?.id === openId;
  if (!avis) {
    return (
      <section className="home__week home__week--empty">
        <span className="home__label">{label} · uge {week.week}</span>
        <p className="home__muted">Ingen avis endnu</p>
        <button className="go home__make" disabled={Boolean(s.busy)} onClick={onMake}>+ Lav uge {week.week}</button>
        {away && (
          <button className="linkish home__toggle" onClick={() => void s.setCatalogueMeta(away.id, { status: 'kladde' })}>
            eller hent «{away.name}» frem igen
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="home__week">
      <span className="home__label">{label} · uge {week.week}</span>
      <b className="home__title">{avis.name}</b>
      <span className="home__meta">
        {avis.pages} {avis.pages === 1 ? 'side' : 'sider'} · rettet {lately(avis.updatedAt)}
        {avis.status !== 'kladde' && <i className={`home__pill home__pill--${avis.status}`}>{STATUS_WORDS[avis.status]}</i>}
      </span>
      <div className="home__acts">
        <OpenButton item={avis} open={open} primary />
        <RowMenu item={avis} />
      </div>
    </section>
  );
}

function OpenButton({ item, open, primary }: { item: CatalogSummary; open: boolean; primary?: boolean }) {
  const s = useStudio();
  return (
    <button
      className={primary ? 'go' : 'thin'}
      disabled={Boolean(s.busy)}
      onClick={async () => {
        if (!open) await s.openCatalogue(item.id);
        s.openPage(null);
      }}
    >{open ? 'Fortsæt' : 'Åbn'}</button>
  );
}

/** One saved avis in the short list: its name, when, and open. */
function Row({ item, openId }: { item: CatalogSummary; openId: string | null }) {
  const open = item.id === openId;
  return (
    <div className={`home__row${open ? ' is-open' : ''}${item.status === 'skjult' ? ' is-away' : ''}`}>
      <div className="home__what">
        <b>{item.name}</b>
        <small>
          {item.week ? `uge ${item.week.week} · ` : ''}rettet {lately(item.updatedAt)}
          {item.status !== 'kladde' && ` · ${STATUS_WORDS[item.status].toLowerCase()}`}
        </small>
      </div>
      <OpenButton item={item} open={open} />
      <RowMenu item={item} />
    </div>
  );
}

/** Rename, status, put away — asked for, not shown on every row. */
function RowMenu({ item }: { item: CatalogSummary }) {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  usePopover(open, () => { setOpen(false); setNaming(null); });
  const set = (patch: { name?: string; status?: CatalogStatus }) => { setOpen(false); void s.setCatalogueMeta(item.id, patch); };

  return (
    <div className="home__more">
      <button className="home__dots" aria-label={`Mere om ${item.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <>
          <div className="sheetaway" onPointerDown={() => setOpen(false)} />
          <div className="docmenu docmenu--right home__menu">
            {naming === null ? (
              <button className="docmenu__do" onClick={() => setNaming(item.name)}>Omdøb</button>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); if (naming.trim()) set({ name: naming.trim() }); }}>
                <input autoFocus value={naming} onChange={(event) => setNaming(event.target.value)} />
              </form>
            )}
            <span className="home__menuhead">Status</span>
            {(['kladde', 'klar', 'udgivet'] as const).map((status) => (
              <button key={status} className={`docmenu__do${item.status === status ? ' is-on' : ''}`} onClick={() => set({ status })}>
                {item.status === status ? '✓ ' : ''}{STATUS_WORDS[status]}
              </button>
            ))}
            <button className="docmenu__do" onClick={() => set({ status: item.status === 'skjult' ? 'kladde' : 'skjult' })}>
              {item.status === 'skjult' ? 'Hent frem igen' : 'Læg væk'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A new week's avis, in one short form.
 *
 * Two answers and a file: reuse last week's pages or start from the
 * chain's sections, and this week's products. The theme is a third
 * answer only when the chain has any. Nothing happens until "Lav
 * avisen", so choosing is free.
 */
function NewAvis({ week, from, onClose }: { week: CatalogWeek; from: CatalogSummary | null; onClose: () => void }) {
  const s = useStudio();
  const [reuse, setReuse] = useState(Boolean(from));
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [themeId, setThemeId] = useState<string | null | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  usePopover(true, onClose);

  return (
    <div className="secgal" role="dialog" aria-label={`Ny avis for uge ${week.week}`}>
      <div className="secgal__away" onPointerDown={onClose} />
      <div className="secgal__sheet newavis">
        <header className="newavis__head">
          <h2>Ny avis · uge {week.week}</h2>
          <span>{weekRange(week)}</span>
          <div className="weekly__gap" />
          <button className="weekly__x" onClick={onClose} title="Luk (Esc)">×</button>
        </header>

        <div className="newavis__body">
          <div className="newavis__step">
            <b>Sider</b>
            <div className="newavis__ways">
              {from && (
                <button className={`newavis__way${reuse ? ' is-on' : ''}`} onClick={() => setReuse(true)}>
                  <b>Genbrug {from.week ? `uge ${from.week.week}` : from.name}</b>
                  <span>Siderne og designet bliver. Ugens varer sættes ind.</span>
                </button>
              )}
              <button className={`newavis__way${!reuse ? ' is-on' : ''}`} onClick={() => setReuse(false)}>
                <b>Start fra bunden</b>
                <span>Byg siderne op fra kædens sektioner.</span>
              </button>
            </div>
          </div>

          <div className="newavis__step">
            <b>Ugens varer</b>
            <input ref={input} type="file" accept=".csv,.json,.txt,.xml" hidden onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }} />
            <button
              className={`newavis__drop${over ? ' is-over' : ''}${file ? ' has-file' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(event) => { event.preventDefault(); setOver(false); setFile(event.dataTransfer.files[0] ?? null); }}
            >
              {file ? <><b>{file.name}</b><span>Klik for at vælge en anden fil</span></> : <><b>Vælg varefilen</b><span>eller træk den hertil</span></>}
            </button>
          </div>

          {reuse && s.themes.length > 0 && (
            <div className="newavis__step">
              <b>Tema</b>
              <select
                className="newavis__select"
                value={themeId === undefined ? '*' : themeId ?? ''}
                onChange={(event) => setThemeId(event.target.value === '*' ? undefined : event.target.value || null)}
              >
                <option value="*">Samme som {from?.week ? `uge ${from.week.week}` : 'sidst'}</option>
                <option value="">Intet tema</option>
                {s.themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <footer className="newavis__foot">
          <button className="thin" onClick={onClose}>Annullér</button>
          <button
            className="go"
            disabled={!file || Boolean(s.busy)}
            onClick={() => {
              if (!file) return;
              onClose();
              void s.startWeek(reuse && from ? from.id : null, file, week, reuse ? themeId : undefined);
            }}
          >Lav avisen</button>
        </footer>
      </div>
    </div>
  );
}
