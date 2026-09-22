import { useState } from 'react';
import { imagePrompt, normaliseStyle, STYLE_LIMIT } from '@incitio/decor/prompt';
import { useStudio } from './state.js';

/**
 * The mood-artwork controls, as a panel the toolbar folds out.
 *
 * They were one nameless input squeezed between two buttons on the bar,
 * which was survivable while there was one field and stopped being so
 * the moment there were two: the whole point is that they steer
 * DIFFERENT models, and two unlabelled boxes side by side say the
 * opposite. A strip has room for the labels that carry that distinction.
 *
 * It used to be a strip that folded, which meant it cost a line of
 * chrome above the page even when it was shut — for a step most
 * sessions never run. Folded away it is now nothing at all: a button
 * in the toolbar, and what it opens lies over the canvas. See `panel`.
 */

/**
 * Stands in for the motif, which is the one part of the prompt this
 * strip does NOT decide — the text model picks a different one per page.
 * A placeholder rather than a plausible example, so nobody reads the
 * preview as the prompt for some particular page.
 */
const MOTIF_SLOT = '‹motivet for siden›';

/**
 * Where an editor puts their own key for the image model.
 *
 * In the browser and nowhere else. It goes into this browser's own
 * storage and onto the requests that draw, as a header — never into
 * the repo, never into a document, never onto the server's disk, and
 * never into a chat with anybody. `GEMINI_API_KEY` in the server's
 * `.env` still works and still wins when no key is pasted here; this
 * is for the ordinary case where the person who has the key is not the
 * person who started the server.
 *
 * What is shown back is the last four characters. Enough to tell two
 * keys apart, useless to a shoulder.
 */
function KeyField() {
  const s = useStudio();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function keep(value: string) {
    s.setImageKey(value);
    setDraft('');
    setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="decor__key"
        onSubmit={(e) => { e.preventDefault(); keep(draft); }}
      >
        <input
          type="password"
          className="decor__keyinput"
          value={draft}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Indsæt Gemini-nøgle"
          aria-label="Gemini-nøgle"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="decor__toggle" disabled={draft.trim().length < 20}>
          Gem i browseren
        </button>
        <button
          type="button"
          className="decor__toggle"
          onClick={() => { setDraft(''); setEditing(false); }}
        >
          Fortryd
        </button>
      </form>
    );
  }

  return (
    <span className="decor__key">
      {s.imageKeyTail && (
        <span className="decor__badge" title="Nøglen ligger kun i denne browser">
          nøgle i browseren ···{s.imageKeyTail}
        </span>
      )}
      {!s.imageKeyTail && s.serverKey && (
        <span className="decor__badge" title="GEMINI_API_KEY på serveren">nøgle på serveren</span>
      )}
      {!s.imageKeyTail && !s.serverKey && <span className="decor__off">ingen nøgle</span>}
      <button
        className="decor__toggle"
        onClick={() => setEditing(true)}
        title="Nøglen bliver i denne browser — hverken i projektet eller på serveren"
      >
        {s.imageKeyTail ? 'Skift' : 'Indsæt nøgle'}
      </button>
      {s.imageKeyTail && (
        <button className="decor__toggle" onClick={() => keep('')} title="Glem nøglen i denne browser">
          Ryd
        </button>
      )}
    </span>
  );
}

export function DecorBar() {
  const s = useStudio();
  const [open, setOpen] = useState(false);

  if (!s.brand) return null;

  const style = s.decorStyle.trim();
  const over = style.length > STYLE_LIMIT;

  /*
   * The prompt as it will actually be sent, built by the SAME function
   * the server calls — imported rather than reimplemented, or the
   * preview would drift from the truth on the first edit to either.
   *
   * Shown because the request behind this whole strip was "my words, in
   * addition to the automatic ones", and a field that swallows your
   * words and shows you nothing cannot answer whether it did.
   */
  const preview = imagePrompt(MOTIF_SLOT, {
    brandName: s.brand.name,
    ...(style ? { style } : {}),
  });
  // The editor's own sentence, exactly as it was folded in — so it can
  // be marked in place rather than merely described.
  const mine = normaliseStyle(style);
  const at = mine ? preview.indexOf(mine) : -1;

  return (
    <section className="decor" aria-label="Stemningsbilleder">
      {/*
        * The key, and which model is about to be billed.
        *
        * The key used to sit in the row that was always on screen, on
        * the argument that every button which draws is dark without
        * one and the control that lights them up must not hide. That
        * job belongs to the toolbar button now — it carries a mark
        * when nothing can draw — and the key itself belongs here,
        * with the fields it pays for. The model's name is said once,
        * in the row at the foot beside the prompt it is sent.
        */}
      <div className="decor__head">
        <KeyField />
      </div>

      <div className="decor__row">
        <label className="decor__field">
          <span className="decor__label">Motiv <em>— hvad skal tegnes?</em></span>
          <input
            type="text"
            value={s.decorNote}
            onChange={(e) => s.setDecorNote(e.target.value)}
            placeholder='fx "efterår" eller "grill"'
            disabled={!s.decorReady}
          />
          <span className="decor__hint">Styrer Geminis valg af motiv pr. side.</span>
        </label>

        <label className="decor__field decor__field--wide">
          <span className="decor__label">
            Din prompt <em>— hvordan skal det se ud?</em>
          </span>
          <input
            type="text"
            value={s.decorStyle}
            onChange={(e) => s.setDecorStyle(e.target.value)}
            placeholder='fx "akvarel, dæmpede farver" eller "tæt makro med dugdråber"'
            disabled={!s.decorReady}
          />
          <span className={over ? 'decor__hint decor__hint--warn' : 'decor__hint'}>
            {over
              ? `For lang — kun de første ${STYLE_LIMIT} tegn kommer med.`
              : 'Lægges oven i den faste prompt, på hvert eneste billede.'}
          </span>
        </label>

        <button
          className="primary decor__go"
          onClick={() => void s.decorate()}
          disabled={Boolean(s.busy) || !s.document || !s.decorReady}
          title={s.decorReady
            ? 'Lad Gemini vælge et motiv pr. side og tegne det bag varerne'
            : 'Tilføj GEMINI_API_KEY i .env og genstart API-serveren'}
        >
          Tegn billeder
        </button>
      </div>

      <div className="decor__row decor__row--meta">
        <button className="decor__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Skjul' : 'Vis'} den fulde prompt
        </button>
        {mine && !open && <span className="decor__badge">din tekst er med</span>}
        {s.decorModel && <code className="decor__model" title="Billedmodellen der kaldes">{s.decorModel}</code>}
        {!s.decorReady && (
          <span className="decor__off">
            Ingen nøgle. Indsæt din egen ovenfor — den bliver i denne browser — eller sæt{' '}
            <code>GEMINI_API_KEY</code> i <code>.env</code>. Nøgle:{' '}
            <a href="https://ai.dev" target="_blank" rel="noreferrer">ai.dev</a>
          </span>
        )}
      </div>

      {open && (
        <p className="decor__prompt">
          {at >= 0
            ? <>
                {preview.slice(0, at)}
                <mark>{mine}</mark>
                {preview.slice(at + mine.length)}
              </>
            : preview}
        </p>
      )}
    </section>
  );
}
