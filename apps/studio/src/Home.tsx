import { useEffect, useMemo, useRef, useState } from 'react';
import { APPROVAL_ROLE_NAMES, nextWeek, weekOf, weekRange, type CatalogWeek } from '@incitio/schema';
import { checkFeed, type CatalogStatus, type CatalogSummary } from './api.js';
import type { FeedHealth } from '@incitio/brands';
import { useStudio, useStudioPick } from './state.js';
import { usePopover } from './popover.js';
import { Cover } from './Cover.js';
import { avisTitle } from './names.js';
import { FeedHealthReport } from './FeedCheck.js';
import { SectionGallery } from './Weekly.js';

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
/** How many weeks after next the front page offers to plan. */
const AHEAD = 6;

export function Home() {
  const s = useStudioPick('brand', 'brandId', 'brands', 'catalogues', 'document', 'variantBase');
  const [all, setAll] = useState(false);
  const [making, setMaking] = useState<CatalogWeek | null>(null);
  const today = weekOf(new Date());
  const coming = nextWeek(today);
  // Further out than next week: an avis is often planned three or four weeks ahead.
  const ahead = useMemo(() => {
    const weeks: CatalogWeek[] = [];
    let week = coming;
    for (let i = 0; i < AHEAD; i += 1) { week = nextWeek(week); weeks.push(week); }
    return weeks;
  }, [coming.week, coming.year]);
  const openId = (s.variantBase ?? s.document)?.id ?? null;

  const { thisWeek, nextOne, later, others, latest, awayFor } = useMemo(() => {
    const visible = s.catalogues.filter((c) => c.status !== 'skjult');
    const dated = visible.filter((c) => c.week).sort((a, b) => order(b.week) - order(a.week) || b.updatedAt.localeCompare(a.updatedAt));
    const mine = visible.filter((c) => sameWeek(c.week, today));
    const next = visible.filter((c) => sameWeek(c.week, coming));
    const later = ahead.map((week) => visible.find((c) => sameWeek(c.week, week)) ?? null);
    const shown = new Set([mine[0]?.id, next[0]?.id, ...later.map((c) => c?.id)]);
    const away = s.catalogues.filter((c) => c.status === 'skjult');
    return {
      thisWeek: mine,
      nextOne: next,
      later,
      // A week whose avis was put away says so, rather than "no avis".
      awayFor: (week: CatalogWeek) => away.find((c) => sameWeek(c.week, week)) ?? null,
      // Everything else, newest first; the put-away ones only when the whole list is asked for.
      others: s.catalogues
        .filter((c) => !shown.has(c.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      // What a new week is made from: the newest avis with a week before it.
      latest: (week: CatalogWeek) => dated.find((c) => order(c.week) < order(week)) ?? null,
    };
  }, [s.catalogues, today.week, today.year, ahead]);

  const listed = others.filter((c) => all || c.status !== 'skjult');
  const shortList = all ? listed : listed.slice(0, SHORT_LIST);
  const color = s.brand?.tokens.brand ?? 'var(--ink)';
  const chain = (s.brands.find((brand) => brand.id === s.brandId)?.name ?? s.brand?.name ?? '').split(' — ')[0];

  return (
    <main className="book home">
      <header className="home__head" style={{ ['--chain' as string]: color }}>
        <span className="home__chain"><i style={{ background: color }} />{chain}</span>
        <h2>Uge {today.week}</h2>
        <span className="home__dates">{weekRange(today)}</span>
      </header>

      <div className="home__weeks">
        <WeekCard label="Denne uge" week={today} avis={thisWeek[0] ?? null} away={awayFor(today)} openId={openId} from={latest(today)} onMake={() => setMaking(today)} />
        <WeekCard label="Næste uge" week={coming} avis={nextOne[0] ?? null} away={awayFor(coming)} openId={openId} from={latest(coming)} onMake={() => setMaking(coming)} />
      </div>

      <section className="home__ahead" aria-label="Længere frem">
        <span className="home__muted">Længere frem</span>
        {ahead.map((week, i) => {
          const avis = later[i];
          return avis ? (
            <div key={week.week} className="ahead__wrap">
              <button className="ahead ahead--made" onClick={() => void openAvis(avis, avis.id === openId)} title={`Åbn ${avis.name}`}>
                <b>Uge {week.week}</b><span>{weekRange(week)}</span><i>Åbn</i>
              </button>
              <RowMenu item={avis} />
            </div>
          ) : (
            <button key={week.week} className="ahead" onClick={() => setMaking(week)} title={`Lav avisen for uge ${week.week}`}>
              <b>Uge {week.week}</b><span>{weekRange(week)}</span><i>Lav</i>
            </button>
          );
        })}
      </section>

      {listed.length > 0 && (
        <section className="home__archive">
          <div className="home__archhead">
            <h3>Andre aviser</h3>
            {others.length > SHORT_LIST && (
              <button className="linkish home__toggle" onClick={() => setAll(!all)}>
                {all ? 'Vis færre' : `Vis alle ${others.length}`}
              </button>
            )}
          </div>
          <div className="home__grid">
            {shortList.map((c) => <Tile key={c.id} item={c} openId={openId} />)}
          </div>
        </section>
      )}

      <Chain />

      {making && <NewAvis week={making} from={latest(making)} onClose={() => setMaking(null)} />}
      {/* The chain's sections, reachable before any avis is open — to look through them, or bring them in from the CMS. */}
      {!s.document && <SectionGallery />}
    </main>
  );
}

/**
 * What belongs to the chain rather than to one week: its designs, the
 * rules that pick them, its themes and its saved sections.
 *
 * They were reachable only through ⌘K, and only if you knew the word.
 * Here they are on the chain's own page, each saying how many it holds
 * and what it is for.
 */
function Chain() {
  const s = useStudioPick(
    'brand', 'busy', 'document', 'openPage', 'sections', 'setDesignsOpen', 'setRulesOpen',
    'setSectionsOpen', 'setThemesOpen', 'themes'
  );
  const designs = s.brand?.offerDesigns.length ?? 0;
  const tags = new Set((s.brand?.offerDesigns ?? []).map((design) => design.tag)).size;
  const rules = s.brand?.offerRules.length ?? 0;
  const items: { key: string; glyph: string; title: string; count: string; said: string; run: (() => void) | null }[] = [
    {
      key: 'designs', glyph: '◧', title: 'Varedesigns',
      count: designs ? `${designs} designs · ${tags} ${tags === 1 ? 'tag' : 'tags'}` : 'ingen endnu',
      said: 'Hvor billede, pris og tekst står på en vare',
      run: () => s.setDesignsOpen(true),
    },
    {
      key: 'rules', glyph: '⇄', title: 'Regler',
      count: rules ? `${rules} ${rules === 1 ? 'regel' : 'regler'}` : 'ingen endnu',
      said: 'Hvilket design en vare får, og hvornår',
      run: () => s.setRulesOpen(true),
    },
    {
      key: 'themes', glyph: '✦', title: 'Temaer',
      count: s.themes.length ? `${s.themes.length} ${s.themes.length === 1 ? 'tema' : 'temaer'}` : 'ingen endnu',
      said: 'Fødselsdag, jul, Halloween — avisens udklædning',
      run: () => s.setThemesOpen(true),
    },
    {
      key: 'sections', glyph: '▤', title: 'Sektioner',
      count: s.sections.length ? `${s.sections.length} gemte sider` : 'ingen endnu',
      said: s.document ? 'Gemte sidedesigns, fyldt med ugens varer' : 'Gemte sidedesigns — eller hent dem fra CMS’et',
      run: () => { if (s.document) s.openPage(null); s.setSectionsOpen(true); },
    },
  ];
  return (
    <section className="home__chainrow">
      <div className="home__archhead"><h3>Kæden</h3><span className="home__muted">det der gælder alle uger</span></div>
      <div className="home__tools">
        {items.map((item) => (
          <button key={item.key} className="home__tool" disabled={!item.run || Boolean(s.busy)} onClick={() => item.run?.()}>
            <span className="home__glyph" aria-hidden="true">{item.glyph}</span>
            <span className="home__toollines">
              <b>{item.title}</b>
              <small>{item.count}</small>
              <span>{item.said}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** One of the two weeks that matter: its avis, or one button that makes it. */
function WeekCard({ label, week, avis, away, from, openId, onMake }: {
  label: string;
  week: CatalogWeek;
  avis: CatalogSummary | null;
  away: CatalogSummary | null;
  /** What the new week would be made from, so the button can say so. */
  from: CatalogSummary | null;
  openId: string | null;
  onMake: () => void;
}) {
  const s = useStudioPick('brand', 'busy', 'setCatalogueMeta');
  const open = avis?.id === openId;
  if (!avis) {
    return (
      <section className="home__week home__week--empty">
        <span className="home__label">{label}</span>
        <b className="home__title">Uge {week.week}</b>
        <p className="home__muted">Ingen avis endnu · {weekRange(week)}</p>
        <button className="go home__make" disabled={Boolean(s.busy)} onClick={onMake}>Lav avisen for uge {week.week}</button>
        {from && !away && (
          <span className="home__muted home__from">Bygger videre på {from.week ? `uge ${from.week.week}` : from.name}</span>
        )}
        {away && (
          <button className="linkish home__toggle" onClick={() => void s.setCatalogueMeta(away.id, { status: 'kladde' })}>
            eller hent «{away.name}» frem igen
          </button>
        )}
      </section>
    );
  }
  return (
    <section className={`home__week${open ? ' is-open' : ''}`}>
      <button className="home__cover" onClick={() => void openAvis(avis, open)} title={`Åbn ${avis.name}`} disabled={Boolean(s.busy)}>
        <Cover id={avis.id} updatedAt={avis.updatedAt} size="hero" />
      </button>
      <div className="home__info">
      <span className="home__label">{label}</span>
      <b className="home__title">{avisTitle(avis.name, s.brand?.name)}</b>
      <span className="home__meta">
        {avis.pages} {avis.pages === 1 ? 'side' : 'sider'} · rettet {lately(avis.updatedAt)}
      </span>
      {avis.status !== 'kladde' && <i className={`home__pill home__pill--${avis.status}`}>{STATUS_WORDS[avis.status]}</i>}
      <WeekProgress avis={avis} />
      <div className="home__acts">
        <OpenButton item={avis} open={open} primary />
        <RowMenu item={avis} />
      </div>
      </div>
    </section>
  );
}

/**
 * How far the week is, in the three things that are not the pages:
 * who has signed, what is sold, and — once it is out — what changed.
 * Each one opens the screen it is about.
 */
function WeekProgress({ avis }: { avis: CatalogSummary }) {
  const s = useStudioPick('busy', 'document', 'openBoard', 'openCatalogue', 'variantBase');
  // Only signatures that still hold — one with changes since is shown as such, never counted.
  const signed = new Set(avis.approvals ?? []);
  const stale = new Set(avis.stale ?? []);
  const roles = Object.keys(APPROVAL_ROLE_NAMES) as (keyof typeof APPROVAL_ROLE_NAMES)[];
  const go = async (view: 'godkend' | 'pladser' | 'live') => {
    if ((s.variantBase ?? s.document)?.id !== avis.id) await s.openCatalogue(avis.id);
    s.openBoard(view);
  };
  return (
    <div className="home__progress">
      <button className="home__step" disabled={Boolean(s.busy)} onClick={() => void go('godkend')} title="Godkend">
        {roles.map((role) => (
          <i
            key={role}
            className={signed.has(role) ? 'is-on' : stale.has(role) ? 'is-stale' : ''}
            title={`${APPROVAL_ROLE_NAMES[role]}${signed.has(role) ? ' har godkendt' : stale.has(role) ? ' skal se ændringer igen' : ' mangler'}`}
          />
        ))}
        <span>{signed.size} af {roles.length} godkendt</span>
      </button>
      {Boolean(avis.sold) && (
        <button className="home__step" disabled={Boolean(s.busy)} onClick={() => void go('pladser')}>
          <span>◆ {avis.sold} {avis.sold === 1 ? 'plads' : 'pladser'} solgt · kr. {(avis.soldFor ?? 0).toLocaleString('da-DK')}</span>
        </button>
      )}
      {avis.status === 'udgivet' && (
        <button className="home__step" disabled={Boolean(s.busy)} onClick={() => void go('live')}>
          <i className="is-live" /><span>Live{avis.live ? ` · ${avis.live} ${avis.live === 1 ? 'ændring' : 'ændringer'}` : ''}</span>
        </button>
      )}
    </div>
  );
}

/** Open an avis — or, when it is already the open one, go back into it. */
/** Read at the click, so the buttons that open an avis need not subscribe to the store for it. */
async function openAvis(item: CatalogSummary, open: boolean) {
  const s = useStudio.getState();
  if (!open) await s.openCatalogue(item.id);
  s.openPage(null);
}

function OpenButton({ item, open, primary }: { item: CatalogSummary; open: boolean; primary?: boolean }) {
  const s = useStudioPick('busy');
  return (
    <button
      className={primary ? 'go' : 'thin'}
      disabled={Boolean(s.busy)}
      onClick={() => void openAvis(item, open)}
    >{open ? 'Fortsæt' : 'Åbn'}</button>
  );
}

/** One saved avis on the front page: its cover, its name, when — the cover opens it. */
function Tile({ item, openId }: { item: CatalogSummary; openId: string | null }) {
  const s = useStudioPick('brand', 'busy');
  const open = item.id === openId;
  const title = avisTitle(item.name, s.brand?.name);
  return (
    <div className={`home__tile${open ? ' is-open' : ''}${item.status === 'skjult' ? ' is-away' : ''}`}>
      <button className="home__cover" onClick={() => void openAvis(item, open)} title={`Åbn ${item.name}`} disabled={Boolean(s.busy)}>
        <Cover id={item.id} updatedAt={item.updatedAt} />
        {open && <span className="home__now">Åben nu</span>}
      </button>
      <div className="home__tileinfo">
        <div className="home__what">
          <b title={item.name}>{title}</b>
          {/* The week only when the name does not already say it. */}
          <small>
            {item.week && !title.toLowerCase().startsWith(`uge ${item.week.week}`) ? `uge ${item.week.week} · ` : ''}
            {item.pages} {item.pages === 1 ? 'side' : 'sider'} · {lately(item.updatedAt)}
          </small>
          {item.status !== 'kladde' && <i className={`home__pill home__pill--${item.status}`}>{STATUS_WORDS[item.status]}</i>}
        </div>
        <RowMenu item={item} />
      </div>
    </div>
  );
}

/** Rename, status, put away — asked for, not shown on every row. */
function RowMenu({ item }: { item: CatalogSummary }) {
  const s = useStudioPick('deleteCatalogue', 'setCatalogueMeta');
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  usePopover(open, () => { setOpen(false); setNaming(null); });
  const set = (patch: { name?: string; status?: CatalogStatus }) => { setOpen(false); void s.setCatalogueMeta(item.id, patch); };

  return (
    <div className="home__more">
      <button className="home__dots" aria-label={`Omdøb, skift status eller slet ${item.name}`} title="Omdøb, status, slet" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
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
            {/* Publishing is signed off on Godkend, and the server refuses it anywhere else — so it is a way there, not a status to pick. */}
            {item.status === 'udgivet' ? (
              <span className="docmenu__note">Udgivet — trækkes tilbage under Godkend</span>
            ) : (
              <>
                {(['kladde', 'klar'] as const).map((status) => (
                  <button key={status} className={`docmenu__do${item.status === status ? ' is-on' : ''}`} onClick={() => set({ status })}>
                    {item.status === status ? '✓ ' : ''}{STATUS_WORDS[status]}
                  </button>
                ))}
                <button className="docmenu__do" onClick={() => { setOpen(false); void openAvis(item, false).then(() => useStudio.getState().openBoard('godkend')); }}>
                  Udgiv… <small>under Godkend</small>
                </button>
                <button className="docmenu__do" onClick={() => set({ status: item.status === 'skjult' ? 'kladde' : 'skjult' })}>
                  {item.status === 'skjult' ? 'Hent frem igen' : 'Læg væk'}
                </button>
                <button
                  className="docmenu__do docmenu__do--danger"
                  onClick={() => {
                    setOpen(false);
                    if (window.confirm(`Slet «${item.name}» for altid? Den kan ikke hentes tilbage.`)) void s.deleteCatalogue(item.id);
                  }}
                >Slet avisen…</button>
              </>
            )}
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
  const s = useStudioPick('brandId', 'busy', 'feed', 'sections', 'sources', 'startWeek', 'themes');
  const [reuse, setReuse] = useState(Boolean(from));
  /*
   * This week's file is often already in — uploaded on Varer this
   * morning. Offered first, so making next week is two clicks rather
   * than a trip through Finder. Not the sample the repo ships with the
   * chain: that is some old week's products, and would look just as ready.
   */
  const loaded = useMemo(() => {
    if (!s.feed) return null;
    const shipped = s.sources.some((source) => source.path && source.path.split('/').pop() === s.feed!.source);
    return shipped ? null : new File([s.feed.text], s.feed.source, { type: 'text/plain' });
  }, [s.feed, s.sources]);
  const [file, setFile] = useState<File | null>(loaded);
  const [over, setOver] = useState(false);
  const [themeId, setThemeId] = useState<string | null | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  /*
   * The file judged as soon as it is chosen — the same verdict as
   * Feedtjek — so a file that drops rows or lacks pictures is seen here,
   * before the week is built from it.
   */
  const [health, setHealth] = useState<FeedHealth | null>(null);
  useEffect(() => {
    setHealth(null);
    if (!file || !s.brandId) return;
    let live = true;
    void checkFeed(s.brandId, file).then((verdict) => { if (live) setHealth(verdict); }).catch(() => undefined);
    return () => { live = false; };
  }, [file, s.brandId]);
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
                <span>{s.sections.length > 0
                  ? 'Byg siderne op fra kædens sektioner.'
                  : 'Kæden har ingen gemte sektioner endnu — du vælger bagefter, hvordan siderne laves.'}</span>
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
              {file
                ? <><b>{file.name}</b><span>{file === loaded ? 'Den indlæste varefil · klik for at vælge en anden' : 'Klik for at vælge en anden fil'}</span></>
                : <><b>Vælg varefilen</b><span>eller træk den hertil</span></>}
            </button>
            {health && (health.verdict !== 'ok' || health.noImage.count > 0) && <FeedHealthReport health={health} />}
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
            title={file ? '' : 'Vælg ugens varefil først'}
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
