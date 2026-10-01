import { useEffect, useState } from 'react';
import * as api from './api.js';
import { useStudio } from './state.js';
import { usePopover } from './popover.js';

/**
 * Saving, as something that simply happens — and a history to go back in.
 *
 * The avis is saved to the server a few seconds after every change, so
 * the header does not ask to be pressed; it says where things stand.
 * Clicking it shows every saved point of this avis, and any of them can
 * be brought back — itself one undo step, and a point of its own.
 */

const clock = (iso: string | null) => (iso
  ? new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
  : '');

const LABELS: Record<string, string> = {
  auto: 'Gemt automatisk',
  manuel: 'Gemt',
  'til tryk': 'Tryk-PDF hentet',
  'før print': 'PDF hentet',
  genskabt: 'Genskabt',
  ops: 'Rettet udefra',
};
const labelOf = (label: string) => (label.startsWith('gendannet fra ')
  ? `Gendannet fra udgave ${label.slice('gendannet fra '.length)}`
  : LABELS[label] ?? (label || 'Gemt'));

export function SaveStatus() {
  const s = useStudio();
  usePopover(s.historyOpen, () => s.setHistoryOpen(false));
  const said = {
    saved: s.savedAt ? `Gemt ${clock(s.savedAt)}` : 'Gemt',
    dirty: 'Gemmer snart…',
    saving: 'Gemmer…',
    failed: 'Ikke gemt · prøver igen',
    conflict: 'Gemt af en anden',
  }[s.saveState];
  return (
    <div className="saving">
      <button
        className={`top__save saving__state saving__state--${s.saveState}`}
        disabled={!s.document}
        onClick={() => s.setHistoryOpen(!s.historyOpen)}
        title="Avisen gemmes af sig selv. Klik for historikken — ⌘S gemmer et navngivet punkt nu."
      >
        <span className="saving__dot" aria-hidden="true" />
        {said}
      </button>
      {s.historyOpen && <History />}
    </div>
  );
}

function History() {
  const s = useStudio();
  const [versions, setVersions] = useState<api.CatalogueVersion[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const id = (s.variantBase ?? s.document)?.id;

  useEffect(() => {
    if (!s.brandId || !id) return;
    let live = true;
    api.fetchVersions(s.brandId, id)
      .then((list) => { if (live) setVersions(list); })
      .catch((error: unknown) => { if (live) setFailed(error instanceof Error ? error.message : 'kunne ikke hentes'); });
    return () => { live = false; };
  }, [s.brandId, id, s.savedAt]);

  const day = (iso: string) => new Date(iso).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <>
      <div className="sheetaway" onPointerDown={() => s.setHistoryOpen(false)} />
      <div className="docmenu saving__menu" role="dialog" aria-label="Historik">
        <div className="saving__head">
          <b>Historik</b>
          <button className="thin" onClick={() => void s.save()} disabled={s.saveState === 'saving'}>Gem nu</button>
        </div>
        <p className="saving__hint">Avisen gemmes af sig selv, mens du arbejder. Hent en tidligere udgave tilbage her — ⌘Z fortryder det igen.</p>
        {failed && <p className="saving__hint">Historikken kunne ikke hentes: {failed}</p>}
        {!versions && !failed && <p className="saving__hint">Henter…</p>}
        {versions?.length === 0 && <p className="saving__hint">Avisen er ikke gemt endnu.</p>}
        <ol className="saving__list">
          {versions?.map((version, index) => (
            <li key={version.version}>
              <span>
                <b>{labelOf(version.label)}</b>
                <small>{day(version.createdAt)} kl. {clock(version.createdAt)} · udgave {version.version}</small>
              </span>
              {index === 0
                ? <i>den du ser</i>
                : <button className="thin" onClick={() => void s.restoreVersion(version.version)}>Hent tilbage</button>}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/** Under the header when somebody else saved the same avis in between. */
export function ConflictNote() {
  const s = useStudio();
  if (s.saveState !== 'conflict') return null;
  return (
    <div className="edition-note edition-note--conflict" role="alert">
      <span>
        <b>En anden har gemt avisen, mens du arbejdede.</b> Intet er overskrevet — vælg hvilken udgave der gælder.
      </span>
      <span className="edition-note__do">
        <button className="thin" onClick={() => void s.resolveConflict('theirs')}>Åbn deres</button>
        <button className="go" onClick={() => void s.resolveConflict('mine')}>Gem min alligevel</button>
      </span>
    </div>
  );
}
