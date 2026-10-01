import { useEffect, useState } from 'react';
import { THEME_PLACES, Theme, type ThemePiece, type ThemePlace } from '@incitio/schema';
import * as api from './api.js';
import { useStudio } from './state.js';
import { usePopover } from './popover.js';

/**
 * Temaer — the chain's dress for an occasion, for the whole avis at once.
 *
 * SuperBrugsen's birthday has its flags, Halloween its pumpkins, Black
 * Friday its black band. A theme is those pictures — from the chain's
 * own library or a file uploaded here — each with a place on the page
 * and the pages it goes on. Made once, chosen in a click every year;
 * choosing another, or none, takes exactly the theme's pictures off.
 */

const PLACE_WORDS: Record<ThemePlace, string> = {
  top: 'Hen over toppen',
  bottom: 'Hen over bunden',
  'top-left': 'Hjørne øverst til venstre',
  'top-right': 'Hjørne øverst til højre',
  'bottom-left': 'Hjørne nederst til venstre',
  'bottom-right': 'Hjørne nederst til højre',
};
const ON_WORDS: Record<ThemePiece['on'], string> = { alle: 'Alle sider', forside: 'Forsiden', bagside: 'Bagsiden' };

const slug = (name: string) => name.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tema';

export function ThemesPanel() {
  const s = useStudio();
  const [editing, setEditing] = useState<Theme | null>(null);
  const [library, setLibrary] = useState<api.LibraryImage[]>([]);
  const close = () => { s.setThemesOpen(false); setEditing(null); };
  usePopover(s.themesOpen, close);

  useEffect(() => {
    if (!s.themesOpen || !s.brandId) return;
    api.fetchUploads(s.brandId).then(setLibrary).catch(() => setLibrary([]));
  }, [s.themesOpen, s.brandId]);

  if (!s.themesOpen) return null;
  const current = (s.variantBase ?? s.document)?.theme?.id ?? null;

  const fresh = () => {
    const taken = new Set(s.themes.map((theme) => theme.id));
    let id = 'nyt-tema';
    for (let n = 2; taken.has(id); n += 1) id = `nyt-tema-${n}`;
    setEditing(Theme.parse({ id, name: 'Nyt tema', pieces: [] }));
  };

  const store = async (theme: Theme, use: boolean) => {
    // The id follows the name the first time it is saved, so it reads in the avis's data.
    const known = s.themes.some((entry) => entry.id === theme.id);
    let id = known ? theme.id : slug(theme.name);
    const taken = new Set(s.themes.map((entry) => entry.id));
    if (!known) for (let n = 2; taken.has(id); n += 1) id = `${slug(theme.name)}-${n}`;
    const saved = { ...theme, id };
    await s.saveThemes(known ? s.themes.map((entry) => (entry.id === theme.id ? saved : entry)) : [...s.themes, saved]);
    setEditing(saved);
    if (use || current === saved.id) s.applyTheme(saved.id);
  };

  return (
    <div className="secgal" role="dialog" aria-label="Temaer">
      <div className="secgal__away" onPointerDown={close} />
      <div className="secgal__sheet themes">
        <header className="secgal__head">
          <h2>Temaer</h2>
          <span className="weekly__muted">Kædens pynt til en anledning — fødselsdag, Halloween, Black Friday — lagt på hele avisen på én gang.</span>
          <div className="weekly__gap" />
          <button className="weekly__x" onClick={close} title="Luk (Esc)">×</button>
        </header>

        <div className="themes__body">
          <aside className="themes__list">
            <button
              className={`themes__card${current === null ? ' is-on' : ''}`}
              disabled={!s.document}
              onClick={() => s.applyTheme(null)}
            >
              <b>Intet tema</b>
              <span>Kædens almindelige sider</span>
            </button>
            {s.themes.map((theme) => (
              <div key={theme.id} className={`themes__card${current === theme.id ? ' is-on' : ''}${editing?.id === theme.id ? ' is-editing' : ''}`}>
                <button className="themes__pick" onClick={() => setEditing(theme)} title="Ret temaet">
                  <b>{theme.name}</b>
                  <span className="themes__shots">
                    {theme.ground && <i className="themes__ground" style={{ background: theme.ground }} />}
                    {theme.pieces.slice(0, 4).map((piece, index) => <img key={index} src={piece.imageUrl} alt="" />)}
                    {theme.pieces.length === 0 && 'ingen billeder endnu'}
                  </span>
                </button>
                <button className="go" disabled={!s.document || current === theme.id} onClick={() => s.applyTheme(theme.id)}>
                  {current === theme.id ? 'På avisen' : 'Brug på avisen'}
                </button>
              </div>
            ))}
            <button className="thin" onClick={fresh}>+ Nyt tema</button>
          </aside>

          <section className="themes__edit">
            {editing
              ? <ThemeEditor key={editing.id} theme={editing} library={library} onLibrary={setLibrary} onSave={store} onDelete={async () => {
                if (!window.confirm(`Slet temaet «${editing.name}»? Aviser der bruger det, beholder billederne.`)) return;
                await s.saveThemes(s.themes.filter((entry) => entry.id !== editing.id));
                setEditing(null);
              }} known={s.themes.some((entry) => entry.id === editing.id)} />
              : (
                <div className="secgal__empty">
                  <b>Vælg et tema for at rette det — eller lav et nyt</b>
                  <p>Et tema er kædens egne billeder til en anledning: flagene til fødselsdagen, græskarrene til Halloween. Hvert billede får en plads på siden, og du vælger om det skal på alle sider, forsiden eller bagsiden.</p>
                </div>
              )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ThemeEditor({ theme, library, onLibrary, onSave, onDelete, known }: {
  theme: Theme;
  library: api.LibraryImage[];
  onLibrary: (library: api.LibraryImage[]) => void;
  onSave: (theme: Theme, use: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  known: boolean;
}) {
  const s = useStudio();
  const [draft, setDraft] = useState(theme);
  const [uploading, setUploading] = useState(false);
  const piece = (index: number, patch: Partial<ThemePiece>) =>
    setDraft({ ...draft, pieces: draft.pieces.map((entry, n) => (n === index ? { ...entry, ...patch } : entry)) });
  const add = (imageUrl: string, subject: string) => setDraft({
    ...draft,
    // The first picture across the top of every page — where occasion flags hang — the rest in a corner.
    pieces: [...draft.pieces, draft.pieces.length === 0
      ? { imageUrl, subject, place: 'top' as const, size: 0.14, on: 'alle' as const, front: false }
      : { imageUrl, subject, place: 'bottom-right' as const, size: 0.26, on: 'forside' as const, front: false }].slice(0, 8),
  });

  const upload = async (file: File) => {
    if (!s.brandId) return;
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const { url } = await api.uploadImage(s.brandId, btoa(binary), file.name);
      add(url, file.name.replace(/\.[a-z0-9]+$/i, ''));
      onLibrary(await api.fetchUploads(s.brandId).catch(() => library));
    } catch (error) {
      useStudio.setState({ error: `${file.name} kunne ikke lægges op: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setUploading(false);
    }
  };

  const changed = JSON.stringify(draft) !== JSON.stringify(theme);

  return (
    <div className="themes__form">
      <label className="inspector__field">
        <span>Navn</span>
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="fx Fødselsdag" />
      </label>

      <label className="themes__groundrow">
        <input type="checkbox" checked={draft.ground !== null} onChange={(event) => setDraft({ ...draft, ground: event.target.checked ? '#fff4d6' : null })} />
        <span>Egen sidefarve</span>
        {draft.ground !== null && (
          <input type="color" value={draft.ground} onChange={(event) => setDraft({ ...draft, ground: event.target.value })} />
        )}
      </label>

      <h3 className="inspector__group">Billeder · {draft.pieces.length}</h3>
      {draft.pieces.length === 0 && <p className="weekly__muted">Vælg et billede fra kædens bibliotek herunder, eller læg din egen fil op.</p>}
      <ol className="themes__pieces">
        {draft.pieces.map((entry, index) => (
          <li key={index}>
            <img src={entry.imageUrl} alt="" />
            <div className="themes__fields">
              <b>{entry.subject || 'Billede'}</b>
              <div className="themes__row">
                <select value={entry.place} onChange={(event) => piece(index, { place: event.target.value as ThemePlace })}>
                  {THEME_PLACES.map((place) => <option key={place} value={place}>{PLACE_WORDS[place]}</option>)}
                </select>
                <select value={entry.on} onChange={(event) => piece(index, { on: event.target.value as ThemePiece['on'] })}>
                  {(Object.keys(ON_WORDS) as ThemePiece['on'][]).map((on) => <option key={on} value={on}>{ON_WORDS[on]}</option>)}
                </select>
              </div>
              <div className="themes__row">
                <label className="themes__size">
                  <span>Størrelse</span>
                  <input type="range" min={0.05} max={0.6} step={0.01} value={entry.size} onChange={(event) => piece(index, { size: Number(event.target.value) })} />
                </label>
                <label className="themes__front">
                  <input type="checkbox" checked={entry.front} onChange={(event) => piece(index, { front: event.target.checked })} />
                  Foran varerne
                </label>
              </div>
            </div>
            <button
              className="thin themes__cut"
              title="Gør den hvide baggrund gennemsigtig — til et foto af flag eller balloner på hvidt"
              onClick={async () => {
                if (!s.brandId) return;
                try {
                  const bytes = new Uint8Array(await (await fetch(entry.imageUrl)).arrayBuffer());
                  let binary = '';
                  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                  const { url } = await api.uploadImage(s.brandId, btoa(binary), `${entry.subject || 'tema'}-udklip.png`, true);
                  piece(index, { imageUrl: url });
                } catch (error) {
                  useStudio.setState({ error: `Baggrunden kunne ikke fjernes: ${error instanceof Error ? error.message : String(error)}` });
                }
              }}
            >Fjern hvid</button>
            <button className="edition__remove" title="Fjern billedet fra temaet" onClick={() => setDraft({ ...draft, pieces: draft.pieces.filter((_, n) => n !== index) })}>×</button>
          </li>
        ))}
      </ol>

      <h3 className="inspector__group">Tilføj et billede</h3>
      <div className="themes__library">
        <label className="themes__upload" title="Læg din egen fil op — den kommer også i kædens bibliotek">
          <input type="file" accept="image/*" hidden disabled={uploading} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }} />
          {uploading ? 'Lægger op…' : '+ Din egen fil'}
        </label>
        {library.map((image) => (
          <button key={image.ref} className="themes__shot" title={image.name} onClick={() => add(image.ref, image.name.replace(/\.[a-z0-9]+$/i, ''))}>
            <img src={image.ref} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      <div className="themes__do">
        {known && <button className="thin thin--drop" onClick={() => void onDelete()}>Slet tema</button>}
        <div className="weekly__gap" />
        <button className="thin" disabled={!draft.name.trim() || (!changed && known)} onClick={() => void onSave(draft, false)}>Gem tema</button>
        <button className="go" disabled={!draft.name.trim() || draft.pieces.length === 0 || !s.document} onClick={() => void onSave(draft, true)}>
          Gem og brug på avisen
        </button>
      </div>
    </div>
  );
}
