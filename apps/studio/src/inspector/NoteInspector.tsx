import { useStudio, useStudioPick } from '../state.js';
import { Measure } from '../Measure.js';
import { noteToBox } from '../box.js';

/*
 * Free text on the page, in hand. The words are typed here and show on
 * the sheet as they are typed; the box is dragged on the sheet itself.
 */
const NOTE_INKS = ['#16181d', '#ffffff', '#c31414', '#871623', '#1c5c34'];
const NOTE_BACKINGS: [string | null, string][] = [
  [null, 'Ingen'], ['#ffffff', 'Hvid'], ['#c31414', 'Rød'], ['#16181d', 'Sort'], ['#fff1b8', 'Gul'],
];

export function NoteInspector({ noteId }: { noteId: string }) {
  const { document, updateNote, removeNote, selectNote, endGesture } = useStudioPick('document', 'updateNote', 'removeNote', 'selectNote', 'endGesture');
  const page = document?.pages.find((entry) => (entry.notes ?? []).some((n) => n.id === noteId));
  const note = page?.notes.find((n) => n.id === noteId);
  if (!page || !note) return null;
  const set = (patch: Parameters<typeof updateNote>[2], gesture?: string) =>
    updateNote(page.id, note.id, patch, gesture);

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>Tekst på siden</h2>
        <button className="inspector__close" onClick={() => selectNote(null)} aria-label="Luk">×</button>
      </header>
      <p className="inspector__meta">Træk den rundt på siden · piletaster flytter den · ⌫ tager den af siden</p>

      <Measure target={{
        key: `note:${note.id}`,
        pageId: page.id,
        selectors: [`[data-note-id="${CSS.escape(note.id)}"]`],
        rotated: note.rotate !== 0,
        free: true,
        fixedHeight: !(note.h !== null && (note.background !== null || note.image !== null)),
        exact: true,
        model: (size) => ({
          x: note.x * size.w,
          y: note.y * size.h,
          w: note.w * size.w,
          ...(note.h !== null && (note.background !== null || note.image !== null) ? { h: note.h * size.h } : {}),
        }),
        write: (to, _from, size, gesture) => set(noteToBox(note, to, size), gesture),
      }} />

      <label className="inspector__field">
        <span>Tekst</span>
        <textarea
          className="notepanel__text"
          value={note.text}
          rows={3}
          /* Only a text just added takes the cursor: on one picked off the
             page the keys stay the page's, so ⌫ takes it off like the rest. */
          autoFocus={note.text === 'Skriv din tekst'}
          onFocus={(event) => { if (event.target.value === 'Skriv din tekst') event.target.select(); }}
          onChange={(event) => set({ text: event.target.value }, `note-text:${note.id}`)}
          onBlur={endGesture}
        />
      </label>

      <label className="inspector__field">
        <span>Størrelse <b>{Math.round(note.size * 1000) / 10}</b></span>
        <input
          type="range" min={0.8} max={16} step={0.1} value={note.size * 100}
          onChange={(e) => set({ size: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Bredde <b>{Math.round(note.w * 100)} %</b></span>
        <input
          type="range" min={5} max={100} value={Math.round(note.w * 100)}
          onChange={(e) => set({ w: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Drejning <b>{note.rotate}°</b></span>
        <input
          type="range" min={-45} max={45} value={note.rotate}
          onChange={(e) => set({ rotate: Number(e.target.value) })}
          onPointerUp={endGesture}
        />
      </label>

      <div className="inspector__field">
        <span>Farve</span>
        <div className="notepanel__swatches">
          {NOTE_INKS.map((ink) => (
            <button
              key={ink}
              className={note.color === ink ? 'is-on' : ''}
              style={{ background: ink }}
              title={ink}
              onClick={() => set({ color: ink })}
            />
          ))}
          <input type="color" value={note.color} onChange={(e) => set({ color: e.target.value }, `note-ink:${note.id}`)} title="Anden farve" />
        </div>
      </div>

      <div className="inspector__field">
        <span>Bagved</span>
        <div className="segment" role="group" aria-label="Bagved">
          {NOTE_BACKINGS.map(([backing, name]) => (
            <button
              key={name}
              className={note.background === backing ? 'is-on' : ''}
              onClick={() => set({ background: backing })}
            >{name}</button>
          ))}
        </div>
      </div>

      <div className="inspector__field">
        <span>Skrift</span>
        <div className="segment" role="group" aria-label="Skrift">
          <button className={note.bold ? 'is-on' : ''} onClick={() => set({ bold: !note.bold })}><b>Fed</b></button>
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              className={note.align === align ? 'is-on' : ''}
              title={align === 'left' ? 'Venstre' : align === 'right' ? 'Højre' : 'Midte'}
              onClick={() => set({ align })}
            >{align === 'left' ? '⇤' : align === 'right' ? '⇥' : '↔'}</button>
          ))}
        </div>
      </div>

      <button className="inspector__drop" onClick={() => removeNote(page.id, note.id)}>
        Tag af siden
      </button>
    </aside>
  );
}
