import { useMemo, useRef, useState } from 'react';
import { sectionsBehind, variantSummary } from '@incitio/edit/core';
import { checkEditions, DIFF_FIELD_NAMES, type EditionCheck } from '@incitio/compose';
import { useStudio } from './state.js';
import { Chevron } from './Chevron.js';
import { usePopover } from './popover.js';

/**
 * Udgaver — one avis, many stores.
 *
 * Tjek's CMS keeps a chain's store editions as whole copies — Biltema's
 * September avis is nineteen publications — and staff push designs from
 * one to the others by hand. Here there is one avis and each store's
 * edition is its difference from it: pick "Holbæk", edit its pages like
 * any pages, and what is kept is "the affaldsposer on page 14". Back on
 * "Alle butikker", an edit reaches every store at once.
 */
export function EditionPicker() {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false));
  const [name, setName] = useState('');
  const base = open ? s.storedDocument() : null;
  const variants = (s.variantBase ?? s.document)?.variants ?? [];
  const current = variants.find((v) => v.id === s.variantId);

  const summaries = useMemo(() => {
    if (!base || !s.brand) return new Map<string, string>();
    return new Map((base.variants ?? []).map((variant) => {
      const d = variantSummary(base, variant, s.brand!);
      const said = [
        d.added ? `+${d.added} ${d.added === 1 ? 'vare' : 'varer'}` : '',
        d.removed ? `−${d.removed}` : '',
        d.moved ? `${d.moved} flyttet` : '',
        d.repriced ? `${d.repriced} ${d.repriced === 1 ? 'anden pris' : 'andre priser'}` : '',
        d.conflicts ? `${d.conflicts} passer ikke` : '',
      ].filter(Boolean).join(' · ');
      return [variant.id, said || 'som alle butikker'];
    }));
  }, [base, s.brand]);

  if (!s.document) return null;

  return (
    <div className="docwrap">
      <button
        className={`edition${current ? ' edition--local' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Hvilken butiks udgave du ser og retter"
      >
        <span className="edition__label">Udgave</span>
        <strong>{current?.name ?? 'Alle butikker'}</strong>
        <Chevron />
      </button>

      {open && (
        <>
          <div className="sheetaway" onPointerDown={() => setOpen(false)} />
          <div className="docmenu edition__menu">
            <button
              className={`docmenu__do docmenu__do--big${!s.variantId ? ' is-on' : ''}`}
              onClick={() => { setOpen(false); s.openVariant(null); }}
            >
              <b>Alle butikker</b>
              <span>Det fælles — en rettelse her når alle udgaver</span>
            </button>
            {variants.map((variant) => (
              <div className="edition__row" key={variant.id}>
                <button
                  className={`docmenu__do docmenu__do--big${variant.id === s.variantId ? ' is-on' : ''}`}
                  onClick={() => { setOpen(false); s.openVariant(variant.id); }}
                >
                  <b>{variant.name}</b>
                  <span>{summaries.get(variant.id) ?? ''}</span>
                </button>
                <button
                  className="edition__remove"
                  title={`Fjern udgaven ${variant.name}`}
                  onClick={() => { if (window.confirm(`Fjern udgaven ${variant.name}? Dens rettelser forsvinder.`)) s.removeVariant(variant.id); }}
                >×</button>
              </div>
            ))}
            <form
              className="edition__new"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                s.addVariant(name);
                setName('');
                setOpen(false);
              }}
            >
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ny udgave, fx Holbæk" />
              <button className="docmenu__do" disabled={!name.trim()}>Tilføj</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/** Under the top bar while a store's edition is open: whose pages these are, and what did not carry. */
export function EditionNote() {
  const s = useStudio();
  const current = (s.variantBase?.variants ?? []).find((v) => v.id === s.variantId);
  if (!current) return null;
  return (
    <div className="edition-note" role="status">
      <span>
        Du retter <b>{current.name}</b> — det du gør her gælder kun den udgave.
        {' '}<button className="linkish" onClick={() => s.openVariant(null)}>Tilbage til alle butikker</button>
      </span>
      {s.variantNotes.length > 0 && (
        <details>
          <summary>{s.variantNotes.length} {s.variantNotes.length === 1 ? 'ting' : 'ting'} passer ikke længere</summary>
          <ul>{s.variantNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * Pages whose section design has a newer version. Offered, never done
 * behind anyone's back: a page may have been changed on purpose.
 */
export function SectionUpdates() {
  const s = useStudio();
  const behind = useMemo(
    () => (s.document ? sectionsBehind(s.document, s.sections) : []),
    [s.document, s.sections],
  );
  if (behind.length === 0) return null;
  const numberOf = new Map(s.document!.pages.map((page, index) => [page.id, index + 1]));
  const names = [...new Set(behind.map((b) => b.section.name))];
  return (
    <div className="edition-note edition-note--sections" role="status">
      <span>
        {behind.length === 1 ? 'Én side' : `${behind.length} sider`} bruger en ældre udgave af {names.length === 1 ? `sektionen «${names[0]}»` : `${names.length} sektioner`}
        {' '}(side {behind.map((b) => numberOf.get(b.pageId)).join(', ')}).
        {' '}<button className="linkish" onClick={() => s.pullSections()}>Hent det nye design</button>
        <span className="edition-note__muted"> — varerne bliver stående</span>
      </span>
    </div>
  );
}

type EditionFilter = 'alle' | 'fejl' | 'uden';

const kr = (value: unknown) => (typeof value === 'number' ? value.toFixed(2).replace('.', ',') : String(value ?? '—'));

/**
 * Udgaver, as a screen: every store's and region's edition at once.
 *
 * The picker in the top bar answers "which one am I in"; this answers
 * "are they all right". One row each, with what it carries and whether
 * that matches the file it was sent — the base against the week's feed,
 * an edition against its own. Each edition takes its own file, and all
 * of them leave as the one merged feed the platform reads.
 */
export function EditionsBoard() {
  const s = useStudio();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EditionFilter>('alle');
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [stores, setStores] = useState('');
  const merged = useRef<HTMLInputElement>(null);

  const document = s.variantBase ?? s.document;
  const checks = useMemo(() => {
    if (!document || !s.brand) return [];
    const baseFeed = s.feedOffers.length ? { name: s.feed?.source ?? 'ugens feed', offers: s.feedOffers } : null;
    return checkEditions(document, baseFeed, s.brand);
  }, [document, s.brand, s.feedOffers, s.feed?.source]);

  if (!document) return null;
  const numberOf = new Map(document.pages.map((page, index) => [page.id, index + 1]));
  const needle = query.trim().toLowerCase();
  const counts = {
    alle: checks.length,
    fejl: checks.filter((c) => c.problems > 0).length,
    uden: checks.filter((c) => c.variantId && !c.feed).length,
  };
  const feeds = checks.some((c) => Boolean(c.feed));
  const shown = checks.filter((c) => (filter === 'fejl' ? c.problems > 0 : filter === 'uden' ? Boolean(c.variantId && !c.feed) : true))
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.stores.some((id) => id.toLowerCase().includes(needle)));

  return (
    <main className="book editions">
      <div className="book__head">
        <h2>Udgaver</h2>
        <span className="book__said" title="Hver butik og region — og om den passer med sit eget feed">
          {counts.alle} {counts.alle === 1 ? 'udgave' : 'udgaver'}
          {counts.fejl > 0 && <> · <b className="book__open book__open--stop">{counts.fejl} med fejl</b></>}
        </span>
        <div className="book__gap" />
        <input ref={merged} type="file" accept=".json" hidden onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) await s.loadMergedFeed(file.name, await file.text());
        }} />
        <button className="thin" onClick={() => merged.current?.click()} title="Et feed der allerede er samlet af flere, med udgaver på rækkerne">Indlæs samlet feed</button>
        <button className="thin" onClick={() => s.downloadMergedFeed()} title="Alle udgavers feeds som det ene feed platformen læser">Saml til ét feed ↓</button>
      </div>

      <div className="editions__bar">
        <input className="editions__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg by, region eller butik" />
        <div className="seg" role="group" aria-label="Vis">
          {([['alle', 'Alle'], ['fejl', 'Med fejl'], ['uden', 'Uden eget feed']] as const)
            .filter(([key]) => key === 'alle' || key === filter || counts[key] > 0)
            .map(([key, label]) => (
            <button key={key} className={filter === key ? 'is-on' : ''} onClick={() => setFilter(key)}>
              {label} · {counts[key]}
            </button>
          ))}
        </div>
      </div>

      {/* No store has a feed of its own yet: a column of dashes says nothing. */}
      <div className={`editions__table${feeds ? '' : ' editions__table--nofeed'}`} role="table">
        <div className="editions__row editions__row--head" role="row">
          <span>Udgave</span><span>Butikker</span><span>På siderne</span>{feeds && <span>Feed</span>}<span>Status</span>
        </div>
        {shown.map((check) => (
          <EditionRow
            key={check.variantId ?? '*'}
            check={check}
            open={openId === (check.variantId ?? '*')}
            onToggle={() => setOpenId(openId === (check.variantId ?? '*') ? null : check.variantId ?? '*')}
            numberOf={numberOf}
            feeds={feeds}
          />
        ))}
        {shown.length === 0 && <p className="editions__empty">Ingen udgaver passer på søgningen.</p>}
      </div>

      <form
        className="editions__new"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          s.addVariant(name);
          const after = useStudio.getState();
          const made = (after.variantBase ?? after.document)?.variants?.at(-1);
          const ids = stores.split(/[,\n]/).map((id) => id.trim()).filter(Boolean);
          // `addVariant` opens the new edition; the list is of the base, so back out of it.
          useStudio.getState().openEditions();
          if (made && ids.length) useStudio.getState().setVariantStores(made.id, ids);
          setName('');
          setStores('');
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ny udgave, fx Jylland eller Holbæk" />
        <input value={stores} onChange={(event) => setStores(event.target.value)} placeholder="Butikker, adskilt med komma (valgfrit)" />
        <button className="thin" disabled={!name.trim()}>Tilføj udgave</button>
      </form>
    </main>
  );
}

function EditionRow({ check, open, onToggle, numberOf, feeds }: {
  check: EditionCheck;
  open: boolean;
  onToggle: () => void;
  numberOf: Map<string, number>;
  /** Whether any edition has a feed — the column is left out when none does. */
  feeds: boolean;
}) {
  const s = useStudio();
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [stores, setStores] = useState(check.stores.join(', '));
  const id = check.variantId;
  const take = async (picked: File | undefined) => {
    if (!picked) return;
    const text = await picked.text();
    if (id) await s.setEditionFeed(id, picked.name, text);
    else await s.uploadFeed(picked.name, text);
  };

  const status = check.problems > 0
    ? <span className="editions__bad">{check.problems} {check.problems === 1 ? 'fejl' : 'fejl'}</span>
    : check.feed
      ? <span className="editions__ok">passer</span>
      : <span className="editions__muted">{id ? 'følger alle butikker' : 'intet feed'}</span>;

  return (
    <div
      className={`editions__item${open ? ' is-open' : ''}${over ? ' is-over' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); void take(event.dataTransfer.files[0]); }}
    >
      <button className="editions__row" role="row" onClick={onToggle} aria-expanded={open}>
        <span><b>{check.name}</b></span>
        {/* How many, in words; the platform's ids are for the tooltip, not for reading. */}
        <span className="editions__muted" title={check.stores.join(', ')}>{id ? (check.stores.length ? `${check.stores.length} ${check.stores.length === 1 ? 'butik' : 'butikker'}` : 'ingen valgt') : 'resten'}</span>
        <span>{check.onPages} varer</span>
        {feeds && <span className="editions__muted">{check.feed ? `${check.feed.name} · ${check.feed.offers}` : '—'}</span>}
        <span>{status}{check.unplaced.length > 0 && <span className="editions__muted"> · {check.unplaced.length} ikke med</span>}</span>
      </button>

      {open && (
        <div className="editions__detail">
          <div className="editions__actions">
            <input ref={file} type="file" hidden onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ''; void take(picked); }} />
            <button className="thin" onClick={() => file.current?.click()}>
              {id ? (check.feed ? 'Nyt feed til udgaven' : 'Upload udgavens feed') : 'Nyt ugefeed'}
            </button>
            {id && <button className="thin" onClick={() => { s.openVariant(id); useStudio.setState({ view: 'bog' }); }}>Åbn udgaven</button>}
            {id && (
              <button className="thin thin--drop" onClick={() => {
                if (window.confirm(`Fjern udgaven ${check.name}? Dens rettelser forsvinder.`)) s.removeVariant(id);
              }}>Fjern</button>
            )}
            <span className="editions__muted">eller træk en fil hen på rækken</span>
          </div>

          {id && (
            <label className="editions__stores">
              <span>Butikker</span>
              <input
                value={stores}
                onChange={(event) => setStores(event.target.value)}
                onBlur={() => {
                  const ids = stores.split(/[,\n]/).map((one) => one.trim()).filter(Boolean);
                  if (ids.join('|') !== check.stores.join('|')) s.setVariantStores(id, ids);
                }}
                placeholder="Butikkernes id'er, adskilt med komma"
              />
            </label>
          )}

          {!check.feed && (
            <p className="editions__muted">
              {id ? 'Ingen egen fil — udgaven sælger det samme som alle butikker, plus det der er rettet i den.' : 'Intet ugefeed indlæst.'}
            </p>
          )}
          <Findings title="På siderne, men ikke i feedet" items={check.missing.map((m) => `${m.offer.name} · side ${numberOf.get(m.pageId) ?? '?'}`)} bad />
          <Findings
            title="Feedet siger noget andet"
            bad
            items={check.differs.map((change) => `${change.next.name}: ${change.fields.map((f) => (
              f.field === 'price' || f.field === 'prePrice'
                ? `${DIFF_FIELD_NAMES[f.field]} ${kr(f.before)} → ${kr(f.after)}`
                : DIFF_FIELD_NAMES[f.field])).join(', ')}${change.pageId ? ` · side ${numberOf.get(change.pageId) ?? '?'}` : ''}`)}
          />
          <Findings title="Passer ikke længere" items={check.conflicts} bad />
          <Findings title="I feedet, men ikke på siderne" items={check.unplaced.map((offer) => `${offer.name} · ${kr(offer.price)}`)} />
          {check.feed && check.problems === 0 && check.unplaced.length === 0 && (
            <p className="editions__ok">Alt på siderne står i feedet med samme pris.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Findings({ title, items, bad }: { title: string; items: string[]; bad?: boolean }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className={`editions__findings${bad ? ' editions__findings--bad' : ''}`}>
      <h3>{title} · {items.length}</h3>
      <ul>{shown.map((item, index) => <li key={index}>{item}</li>)}</ul>
      {items.length > shown.length && (
        <button className="linkish" onClick={() => setAll(true)}>og {items.length - shown.length} mere</button>
      )}
    </section>
  );
}
