import { useEffect, useMemo, useRef, useState } from 'react';
import { DEPARTMENT_NAMES } from '@incitio/compose';
import type { Offer } from '@incitio/schema';
import { formatPrice } from '@incitio/renderer';
import { departmentOfPage, useStudio } from './state.js';

/**
 * ⌘K — everything in the studio, one keystroke away.
 *
 * The question somebody asks forty times on a Wednesday is "where is
 * the Lurpak?" — which page, which cell — and the answer was to scroll
 * the book and squint at thumbnails. Here it is typed: products on the
 * pages (and in the reserve), the pages themselves, and the handful of
 * things the studio does, all in one list that reads the same whether
 * you know the tool or not.
 */

interface Item {
  id: string;
  group: 'Handlinger' | 'Varer på siderne' | 'Ikke placeret' | 'Sider';
  label: string;
  hint?: string;
  keys?: string;
  run: () => void;
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Every word typed must start a word somewhere in the text — "lur sm" finds "Lurpak smør". */
function matches(text: string, query: string): boolean {
  const words = fold(text).split(/[^a-z0-9æøå]+/u);
  return fold(query).split(/\s+/).filter(Boolean)
    .every((part) => words.some((word) => word.startsWith(part)) || fold(text).includes(part));
}

export function Palette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const s = useStudio();

  // ⌘K / ctrl+K from anywhere — even with the caret in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((was) => !was);
        setQuery('');
        setAt(0);
      }
    };
    const onAsk = () => { setOpen(true); setQuery(''); setAt(0); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('incitio:palette', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('incitio:palette', onAsk);
    };
  }, []);
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 0); }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const document = s.document;
    const close = () => setOpen(false);
    const actions: Item[] = [
      ...(document ? [
        { id: 'pdf', group: 'Handlinger' as const, label: 'Hent PDF', hint: 'korrektur, skåret til', run: () => { close(); void s.downloadPdf(); } },
        { id: 'print', group: 'Handlinger' as const, label: 'Hent tryk-PDF', hint: '3 mm beskæring og skæremærker', run: () => { close(); void s.downloadPdf(true); } },
        { id: 'save', group: 'Handlinger' as const, label: 'Gem avisen', keys: '⌘S', run: () => { close(); void s.save(); } },
        { id: 'checks', group: 'Handlinger' as const, label: 'Hvad mangler før tryk?', hint: `${s.findings.length} punkter`, run: () => { close(); s.setFindingsOpen(true); } },
        { id: 'sections', group: 'Handlinger' as const, label: 'Sektioner', hint: 'kædens gemte sidedesigns', run: () => { close(); s.openPage(null); s.setSectionsOpen(true); } },
        { id: 'book', group: 'Handlinger' as const, label: 'Tilbage til avisen', keys: 'Esc', run: () => { close(); s.openPage(null); } },
      ] : []),
      ...(document && s.feedOffers.length > 0 ? [
        { id: 'carry', group: 'Handlinger' as const, label: 'Næste uges avis, fra denne', hint: `med ${s.feedOffers.length} af ugens varer`, run: () => { close(); s.carryWeek(); } },
      ] : []),
      { id: 'keys', group: 'Handlinger' as const, label: 'Alle genveje', keys: '?', run: () => { close(); window.dispatchEvent(new Event('incitio:keys')); } },
    ];
    if (!document) return actions.filter((item) => matches(`${item.label} ${item.hint ?? ''}`, query));

    const number = new Map(document.pages.map((page, index) => [page.id, index + 1]));
    const pageOf = new Map<string, string>();
    const byId = new Map(document.offers.map((offer) => [offer.id, offer]));
    for (const page of document.pages) {
      for (const placement of page.placements) {
        pageOf.set(placement.offerId, page.id);
        for (const member of byId.get(placement.offerId)?.members ?? []) pageOf.set(member, page.id);
      }
    }
    const said = (offer: Offer) => `${offer.brand && !offer.name.startsWith(offer.brand) ? `${offer.brand} ` : ''}${offer.name}`;

    const pages: Item[] = document.pages.map((page, index) => {
      const department = departmentOfPage(document, page.id);
      return {
        id: `page-${page.id}`,
        group: 'Sider',
        label: `Side ${index + 1}`,
        hint: page.title || (page.kind === 'image' ? 'billedside' : department ? DEPARTMENT_NAMES[department] : 'blandet'),
        run: () => { close(); s.openPage(page.id); },
      };
    });

    const onPages: Item[] = [];
    const reserve: Item[] = [];
    if (query.trim()) {
      for (const offer of document.offers) {
        if (offer.members.length > 0 || !matches(`${said(offer)} ${offer.description}`, query)) continue;
        const pageId = pageOf.get(offer.id);
        if (pageId) {
          onPages.push({
            id: `offer-${offer.id}`,
            group: 'Varer på siderne',
            label: said(offer),
            hint: `side ${number.get(pageId)} · ${formatPrice(offer.price, offer.currency)}`,
            run: () => { close(); s.openPage(pageId); window.setTimeout(() => s.goToOffer(offer.id), 350); },
          });
        } else {
          reserve.push({
            id: `reserve-${offer.id}`,
            group: 'Ikke placeret',
            label: said(offer),
            hint: `ikke på en side · ${formatPrice(offer.price, offer.currency)} — vælg den i listen`,
            run: () => {
              close();
              const target = s.openPageId ?? s.activePageId ?? document.pages[0]?.id ?? null;
              if (target) s.openPage(target);
              if (!s.librarySelection.includes(offer.id)) s.toggleLibraryPick(offer.id);
              s.setLibrarySearch(offer.name);
            },
          });
        }
      }
    }

    const q = query.trim();
    const page = /^(?:s(?:ide)?\.?\s*)?(\d{1,3})$/i.exec(q);
    const pageHits = page
      ? pages.filter((item) => item.label === `Side ${page[1]}`)
      : pages.filter((item) => q && matches(`${item.label} ${item.hint}`, q));
    return [
      ...actions.filter((item) => !q || matches(`${item.label} ${item.hint ?? ''}`, q)),
      ...pageHits.slice(0, 6),
      ...onPages.slice(0, 8),
      ...reserve.slice(0, 5),
    ];
  }, [open, query, s]);

  if (!open) return null;
  const current = Math.min(at, Math.max(0, items.length - 1));

  return (
    <div className="palette" role="dialog" aria-label="Søg">
      <div className="palette__away" onPointerDown={() => setOpen(false)} />
      <div className="palette__box">
        <input
          ref={input}
          className="palette__input"
          placeholder="Søg efter en vare, en side eller en handling…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setAt(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setAt((current + 1) % Math.max(1, items.length)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setAt((current - 1 + items.length) % Math.max(1, items.length)); }
            if (event.key === 'Enter') { event.preventDefault(); items[current]?.run(); }
          }}
        />
        <div className="palette__list">
          {items.length === 0 && <p className="palette__none">Intet der hedder “{query}”.</p>}
          {items.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || items[index - 1]!.group !== item.group) && (
                <p className="palette__group">{item.group}</p>
              )}
              <button
                className={`palette__item${index === current ? ' is-at' : ''}`}
                onMouseEnter={() => setAt(index)}
                onClick={item.run}
              >
                <span className="palette__label">{item.label}</span>
                {item.hint && <span className="palette__hint">{item.hint}</span>}
                {item.keys && <kbd>{item.keys}</kbd>}
              </button>
            </div>
          ))}
        </div>
        <p className="palette__foot"><kbd>↑</kbd><kbd>↓</kbd> vælg · <kbd>↵</kbd> gå · <kbd>esc</kbd> luk</p>
      </div>
    </div>
  );
}

/** The shortcuts, all of them, behind "?". */
const KEYS: [string, [string, string][]][] = [
  ['Overalt', [['⌘K', 'Søg efter varer, sider og handlinger'], ['⌘S', 'Gem'], ['⌘Z / ⇧⌘Z', 'Fortryd / gentag'], ['?', 'Denne oversigt']]],
  ['På en side', [
    ['Klik', 'Vælg en vare eller et element'],
    ['Træk', 'Flyt det — eller træk en vare fra listen hen på en vare for at bytte'],
    ['Piletaster', 'Flyt lidt — med shift længere'],
    ['+ / − · ⌘ + scroll', 'Større / mindre'],
    ['0', 'Tilbage hvor det stod'],
    ['⌫', 'Tag det af siden'],
    ['Dobbeltklik', 'Ret teksten der hvor den står'],
    ['Esc', 'Slip — og tilbage til oversigten'],
  ]],
];

export function Keys() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      if (event.key === '?') { event.preventDefault(); setOpen((was) => !was); }
      if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
    };
    const onAsk = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('incitio:keys', onAsk);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('incitio:keys', onAsk); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="palette" role="dialog" aria-label="Genveje">
      <div className="palette__away" onPointerDown={() => setOpen(false)} />
      <div className="palette__box keys">
        <h2>Genveje</h2>
        {KEYS.map(([group, rows]) => (
          <section key={group}>
            <p className="palette__group">{group}</p>
            <dl>
              {rows.map(([key, what]) => (
                <div key={key}><dt><kbd>{key}</kbd></dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The way in for somebody who does not know ⌘K yet. */
export function SearchButton() {
  return (
    <button className="find" onClick={() => window.dispatchEvent(new Event('incitio:palette'))} title="Søg efter en vare, en side eller en handling">
      <span aria-hidden="true">⌕</span> Søg <kbd>⌘K</kbd>
    </button>
  );
}
