import { useMemo, useState } from 'react';
import { resolveTemplate } from '@incitio/brands';
import { DEPARTMENTS, DEPARTMENT_NAMES, DIFF_FIELD_NAMES, type Department } from '@incitio/compose';
import { ImagePage, PageView } from '@incitio/renderer';
import { weekRange } from '@incitio/schema';
import { sameAvis, useStudio } from './state.js';
import type * as api from './api.js';

/**
 * The week, as the person making it lives it.
 *
 * Three things happen to a leaflet between Monday and print, and none
 * of them had a place in the studio:
 *
 *   **Next week starts from this week.** The meat spread stays the meat
 *   spread. `FeedArrival` offers it the moment a new file is dropped,
 *   and `CarryReport` says what it could not fill.
 *
 *   **The feed changes after the layout.** A price drops, a supplier
 *   pulls a product. `FeedArrival` offers that too — the same file can
 *   be either, and only the person knows which — and `FeedChanges` is
 *   the list to walk through afterwards.
 *
 *   **Pages are reused designs.** `SectionGallery` is the chain's own
 *   library of them, the way the CMS keeps its Sections.
 */

/** A tag as a person reads it: a department's name, or the word capitalised. */
function tagName(tag: string): string {
  return DEPARTMENT_NAMES[tag as Department] ?? `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

const kr = (value: unknown) => (typeof value === 'number'
  ? value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : String(value ?? '—'));

function said(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return kr(value);
  if (typeof value === 'boolean') return value ? 'ja' : 'nej';
  if (typeof value === 'object' && 'value' in (value as object)) {
    const unit = (value as { value: number; unit: string });
    return `${kr(unit.value)}/${unit.unit}`;
  }
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 26)}…` : text;
}

/* ------------------------------------------------------ a file arrives */

export function FeedArrival() {
  const arrival = useStudio((s) => s.feedArrival);
  const document = useStudio((s) => s.document);
  const apply = useStudio((s) => s.applyFeedChanges);
  const carry = useStudio((s) => s.carryWeek);
  const dismiss = useStudio((s) => s.dismissFeedArrival);
  if (!arrival || !document) return null;

  const { changed, removed, added } = arrival.diff;
  const onPages = changed.filter((change) => change.pageId).length;
  const same = sameAvis(arrival);
  const pages = document.pages.length;
  const nothing = changed.length + removed.length + added.length === 0;

  return (
    <section className="weekly weekly--arrival" aria-label="Nyt feed">
      <header className="weekly__head">
        <span className="weekly__kicker">Nyt feed</span>
        <b>{arrival.name}</b>
        <span className="weekly__muted">{arrival.count} varer</span>
        <div className="weekly__gap" />
        <button className="weekly__x" onClick={dismiss} title="Luk">×</button>
      </header>
      {/*
        * Said as a fact before it is asked as a question: of the products
        * the pages show, this many are in the file. That one number is
        * what decides between the two answers, and hiding it behind a
        * recommendation is how 132 products got marked as pulled.
        */}
      <p className="weekly__ask">
        {arrival.onPages === 0 ? (
          <>Siderne har pladser, men ingen varer fra et feed endnu — filen kan fylde dem.</>
        ) : (<>
        <b>{arrival.matched} af {arrival.onPages}</b> varer på siderne findes i filen.{' '}
        {same
          ? 'Det ligner rettelser til den samme avis.'
          : 'Det er en anden avis end den på siderne — en anden uge eller udgave — så filen kan ikke rette i den.'}
        </>)}
      </p>
      <div className="weekly__choices">
        <button className={`choice${same ? ' choice--best' : ''}`} onClick={apply} disabled={!same || nothing}>
          <span className="choice__what">
            <b>Rettelser til {document.name}</b>
            <span>
              {!same
                ? `Ville markere ${removed.length} varer som udgået, som bare ikke er med i filen`
                : nothing
                  ? 'Ingen forskel på filen og avisen'
                  : [
                    `${onPages} ${onPages === 1 ? 'ændring' : 'ændringer'} på siderne`,
                    `${removed.length} udgået`,
                    `${added.length} nye`,
                  ].join(' · ')}
            </span>
          </span>
          <span className="choice__price">Opdatér</span>
        </button>
        <button className={`choice${same ? '' : ' choice--best'}`} onClick={carry}>
          <span className="choice__what">
            <b>Fyld siderne med filens varer</b>
            <span>
              Behold alle {pages} sider og deres design — felterne fyldes med de {arrival.count} varer
              fra filen, afdeling for afdeling. Det der ikke passer ind, står tomt og er listet.
            </span>
          </span>
          <span className="choice__price">Fyld siderne</span>
        </button>
      </div>
    </section>
  );
}

/* --------------------------------------------- what the carry-over did */

export function CarryReport() {
  const report = useStudio((s) => s.carryReport);
  const document = useStudio((s) => s.document);
  const week = useStudio((s) => s.week);
  const openPage = useStudio((s) => s.openPage);
  const dismiss = useStudio((s) => s.dismissCarryReport);
  const undo = useStudio((s) => s.undo);
  if (!report || !document) return null;

  const numberOf = new Map(document.pages.map((page, index) => [page.id, index + 1]));
  const short = report.pages.filter((page) => page.filled < page.cells);
  const empty = report.cells - report.filled;
  const share = report.cells ? report.filled / report.cells : 1;

  return (
    <section className="weekly weekly--carry" aria-label="Ny uge">
      <header className="weekly__head">
        <span className="weekly__kicker weekly__kicker--ok">Ny uge</span>
        <b>{document.name}</b>
        {week && <span className="weekly__muted">{weekRange(week)}</span>}
        <span className="weekly__muted">· startet fra {report.from}</span>
        <div className="weekly__gap" />
        <button className="thin" onClick={() => { undo(); dismiss(); }} title="Tilbage til den gamle avis">Fortryd</button>
        <button className="weekly__x" onClick={dismiss} title="Luk">×</button>
      </header>

      <div className="weekly__stats">
        <div className="stat">
          <b>{document.pages.length}</b>
          <span>sider genbrugt</span>
        </div>
        <div className="stat">
          <b>{report.filled}<i>/{report.cells}</i></b>
          <span>pladser fyldt</span>
          <span className="stat__bar"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
        </div>
        <div className={`stat${empty ? ' stat--todo' : ''}`}>
          <b>{empty}</b>
          <span>venter på dig</span>
        </div>
        <div className="stat">
          <b>{report.reserve}</b>
          <span>i reserven</span>
        </div>
        {report.datedNotes.length > 0 && (
          <div className="stat stat--todo">
            <b>{report.datedNotes.length}</b>
            <span>tekster med datoer</span>
          </div>
        )}
      </div>

      {(short.length > 0 || report.datedNotes.length > 0) && (
        <div className="weekly__todo">
          {short.length > 0 && <span className="weekly__muted">Sider med tomme pladser:</span>}
          {short.map((page) => (
            <button key={page.pageId} className="chip" onClick={() => openPage(page.pageId)}>
              s. {numberOf.get(page.pageId)}
              {page.department && <i> {DEPARTMENT_NAMES[page.department]}</i>}
              <em>{page.cells - page.filled}</em>
            </button>
          ))}
          {report.datedNotes.length > 0 && <span className="weekly__muted">Tjek datoerne:</span>}
          {[...new Set(report.datedNotes.map((note) => note.pageId))].map((pageId) => (
            <button key={`d-${pageId}`} className="chip chip--date" onClick={() => openPage(pageId)}>
              s. {numberOf.get(pageId)} <i>dato</i>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------- what the new file changed */

export function FeedChanges() {
  const changes = useStudio((s) => s.feedChanges);
  const document = useStudio((s) => s.document);
  const openPage = useStudio((s) => s.openPage);
  const goToOffer = useStudio((s) => s.goToOffer);
  const takeOff = useStudio((s) => s.removeOfferFromPage);
  const clear = useStudio((s) => s.clearFeedChanges);
  const [all, setAll] = useState(false);
  if (!changes || !document) return null;

  const numberOf = new Map(document.pages.map((page, index) => [page.id, index + 1]));
  const onPage = changes.changed.filter((change) => change.pageId && numberOf.has(change.pageId));
  const gone = changes.removed.filter((entry) => document.pages
    .find((page) => page.id === entry.pageId)
    ?.placements.some((placement) => placement.offerId === entry.offer.id));
  const shown = all ? onPage : onPage.slice(0, 8);

  const walk = (pageId: string, offerId: string) => {
    openPage(pageId);
    window.setTimeout(() => goToOffer(offerId), 60);
  };

  return (
    <section className="weekly weekly--changes" aria-label="Ændringer fra feedet">
      <header className="weekly__head">
        <span className="weekly__kicker weekly__kicker--warn">Rettet</span>
        <b>{onPage.length} {onPage.length === 1 ? 'vare' : 'varer'} på siderne har nye tal</b>
        {gone.length > 0 && <span className="weekly__stop">{gone.length} udgået — skal af siden</span>}
        <span className="weekly__muted">{changes.added.length} nye ligger i reserven</span>
        <div className="weekly__gap" />
        <button className="weekly__x" onClick={clear} title="Færdig">×</button>
      </header>
      <ul className="changes">
        {gone.map((entry) => (
          <li key={`gone-${entry.offer.id}`} className="changes__row changes__row--gone">
            <button className="changes__where" onClick={() => walk(entry.pageId, entry.offer.id)}>s. {numberOf.get(entry.pageId)}</button>
            <span className="changes__name">{entry.offer.name}</span>
            <span className="changes__what">findes ikke i den nye fil</span>
            <button className="thin" onClick={() => takeOff(entry.pageId, entry.offer.id)}>Tag af siden</button>
          </li>
        ))}
        {shown.map((change) => (
          <li key={change.offerId} className="changes__row">
            <button className="changes__where" onClick={() => walk(change.pageId!, change.offerId)}>s. {numberOf.get(change.pageId!)}</button>
            <span className="changes__name">{change.next.name}</span>
            <span className="changes__what">
              {change.fields.slice(0, 3).map((field) => (
                <span key={field.field} className="delta">
                  {DIFF_FIELD_NAMES[field.field]} <s>{said(field.before)}</s> → <b>{said(field.after)}</b>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {onPage.length > shown.length && (
        <button className="weekly__more" onClick={() => setAll(true)}>Vis alle {onPage.length}</button>
      )}
    </section>
  );
}

/* --------------------------------------------------- the section library */

function SectionCard({ section }: { section: api.Section }) {
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const insert = useStudio((s) => s.insertSection);
  const remove = useStudio((s) => s.removeSection);
  const at = useStudio((s) => s.sectionsAt);
  const offers = useMemo(() => new Map(section.preview.map((offer) => [offer.id, offer])), [section.preview]);
  if (!brand) return null;

  const template = resolveTemplate(brand, section.page.templateId)
    ?? document?.templates.find((entry) => entry.id === section.page.templateId)
    ?? section.template
    ?? undefined;
  const live = section.page.kind === 'image'
    ? <ImagePage page={section.page} brand={brand} pageIndex={0} pageNumber={1} />
    : template
      ? <PageView page={section.page} template={template} brand={brand} offers={offers} pageIndex={0} pageNumber={1} />
      : null;

  return (
    <div className="sec">
      <button className="sec__card" onClick={() => insert(section.id, at)} title={`Indsæt som side ${at + 1}`}>
        <div className="card__live" aria-hidden="true">{live}</div>
        <span className="sec__use">+ Indsæt</span>
      </button>
      <div className="sec__name">{section.name}</div>
      <div className="sec__tags">
        {section.tags.map((tag) => (
          <span key={tag} className="tag">{tagName(tag)}</span>
        ))}
        <button className="sec__drop" onClick={() => remove(section.id)} title="Slet sektionen">Slet</button>
      </div>
    </div>
  );
}

export function SectionGallery() {
  const open = useStudio((s) => s.sectionsOpen);
  const setOpen = useStudio((s) => s.setSectionsOpen);
  const sections = useStudio((s) => s.sections);
  const document = useStudio((s) => s.document);
  const saveAll = useStudio((s) => s.saveAllSections);
  const busy = useStudio((s) => Boolean(s.busy));
  const at = useStudio((s) => s.sectionsAt);
  const setAt = useStudio((s) => s.setSectionsAt);
  const pages = document?.pages ?? [];
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  if (!open) return null;

  const tags = [...new Set(sections.flatMap((section) => section.tags))]
    .sort((a, b) => (DEPARTMENTS as readonly string[]).indexOf(a) - (DEPARTMENTS as readonly string[]).indexOf(b));
  const needle = query.trim().toLowerCase();
  const shown = sections.filter((section) => (!tag || section.tags.includes(tag))
    && (!needle || section.name.toLowerCase().includes(needle)
      || section.tags.some((entry) => entry.includes(needle))));

  return (
    <div className="secgal" role="dialog" aria-label="Sektioner">
      <div className="secgal__away" onPointerDown={() => setOpen(false)} />
      <div className="secgal__sheet">
        <header className="secgal__head">
          <h2>Sektioner</h2>
          <span className="weekly__muted">
            Kædens egne sidedesigns — pladserne fyldes fra reserven efter sektionens tags.
          </span>
          <div className="weekly__gap" />
          {document && (
            <label className="secgal__where">
              <span>Indsæt som</span>
              <select value={at} onChange={(event) => setAt(Number(event.target.value))}>
                {Array.from({ length: pages.length + 1 }, (_, index) => (
                  <option key={index} value={index}>
                    side {index + 1}
                    {index === 0 ? ' — forrest' : index === pages.length ? ' — bagerst' : ` — efter side ${index}`}
                    {index > 0 && pages[index - 1]?.title ? ` (${pages[index - 1]!.title})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="weekly__x" onClick={() => setOpen(false)} title="Luk (Esc)">×</button>
        </header>

        <div className="secgal__tools">
          <input
            className="secgal__search"
            placeholder="Søg i sektioner…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <div className="secgal__tags">
            <button className={`tag tag--pick${tag === null ? ' is-on' : ''}`} onClick={() => setTag(null)}>Alle · {sections.length}</button>
            {tags.map((entry) => (
              <button key={entry} className={`tag tag--pick${tag === entry ? ' is-on' : ''}`} onClick={() => setTag(tag === entry ? null : entry)}>
                {tagName(entry)}
              </button>
            ))}
          </div>
          {document && (
            <button className="thin" disabled={busy} onClick={() => void saveAll()}>
              Gem avisens {document.pages.length} sider som sektioner
            </button>
          )}
        </div>

        {sections.length === 0 ? (
          <div className="secgal__empty">
            <b>Ingen sektioner endnu</b>
            <p>
              En sektion er et sidedesign der genbruges uge efter uge — frostsiden med ballonerne,
              bagsiden, fredag & lørdag. Gem en side fra ⋯-menuen på siden, eller start biblioteket
              med alle siderne i den avis der er åben.
            </p>
          </div>
        ) : (
          <div className="secgal__grid">
            {shown.map((section) => <SectionCard key={section.id} section={section} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Gem som sektion", inline in a page's ⋯ menu. */
export function SaveSection({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const document = useStudio((s) => s.document);
  const save = useStudio((s) => s.saveSection);
  const index = document?.pages.findIndex((page) => page.id === pageId) ?? -1;
  const [name, setName] = useState(() => {
    const page = document?.pages[index];
    return page?.title || '';
  });
  const [tags, setTags] = useState('');
  if (!document || index < 0) return null;

  return (
    <form
      className="savesec"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        void save(pageId, name || `Side ${index + 1}`, tags.split(',').map((tag) => tag.trim()).filter(Boolean));
        onDone();
      }}
    >
      <label>
        <span>Navn</span>
        <input value={name} placeholder={`fx Frost med balloner`} onChange={(event) => setName(event.target.value)} autoFocus />
      </label>
      <label>
        <span>Tags <i>— afdeling styrer hvilke varer der fyldes i</i></span>
        <input value={tags} placeholder="frost, weekend" onChange={(event) => setTags(event.target.value)} />
      </label>
      <div className="savesec__tags">
        {DEPARTMENTS.map((department) => (
          <button
            type="button"
            key={department}
            className="tag tag--pick"
            onClick={() => setTags((was) => [...new Set([...was.split(',').map((t) => t.trim()).filter(Boolean), department])].join(', '))}
          >{DEPARTMENT_NAMES[department]}</button>
        ))}
      </div>
      <button type="submit" className="go">Gem som sektion</button>
    </form>
  );
}
