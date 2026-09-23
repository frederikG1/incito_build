import { useState } from 'react';
import { STYLE_LIMIT } from '@incitio/decor/prompt';
import { backdropPrompt, DEFAULT_BACKDROP_STYLE } from '@incitio/decor/backdrop';
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
  const [tuning, setTuning] = useState(false);
  const [open, setOpen] = useState(false);
  const pageNumber = useStudio((state) => {
    const at = state.document?.pages.findIndex((page) => page.id === state.activePageId) ?? -1;
    return at >= 0 && state.document?.pages[at]?.kind !== 'image' ? at + 1 : null;
  });

  if (!s.brand) return null;

  const style = s.decorStyle.trim();
  const over = style.length > STYLE_LIMIT;
  const blocked = Boolean(s.busy) || !s.document || !s.decorReady;
  const pageIds = (s.document?.pages ?? []).filter((page) => page.kind !== 'image').map((page) => page.id);

  /*
   * The brief as it will be sent, built by the same function the server
   * calls, with the measured parts shown as what they stand for.
   */
  const preview = backdropPrompt({
    aspect: '5:4',
    colour: '#‹sidens farve›',
    regions: [{ x0: 0, x1: 100, y0: 0, y1: 100 }],
    text: ['bottom left', 'bottom right'],
    offer: '‹sidens overskrift›',
    products: ['‹varerne på siden›'],
    ...(style ? { style } : {}),
  }).replace('from 0 to 100 percent of the width and from 0 to 100 percent of the height', '‹hver vares område›');

  /*
   * One button, no prompt to write.
   *
   * The page gets one background picture in its own colour, with a
   * motif placed around the products and the words — measured off the
   * page as it is drawn. The style line and the old corner motif are
   * folded away under "Tilpas".
   */
  return (
    <section className="decor" aria-label="Motiver med AI">
      <h3 className="inspector__group">Motiver med AI</h3>
      <p className="decor__say">
        Siden får motiver der passer til varerne — fx chili og lime på en mexicansk side —
        lagt i den frie plads på sidens egen baggrund. Tag dem i hånden under siden for at flytte dem.
      </p>

      <div className="decor__actions">
        {pageNumber && (
          <button
            className="decor__go"
            disabled={blocked}
            onClick={() => void s.drawBackdrops([s.activePageId!])}
            title={s.decorReady ? 'Motiver i sidens frie plads' : 'Kræver en Gemini-nøgle — se herunder'}
          >
            Tegn til side {pageNumber}
          </button>
        )}
        <button
          className={pageNumber ? 'decor__second' : 'decor__go'}
          disabled={blocked}
          onClick={() => void s.drawBackdrops(pageIds)}
          title={s.decorReady ? 'Motiver på hver side — op til to billedkald pr. side' : 'Kræver en Gemini-nøgle — se herunder'}
        >
          Tegn til alle sider
        </button>
        <button className="decor__more" onClick={() => setTuning(!tuning)} aria-expanded={tuning}>
          {tuning ? 'Skjul' : 'Tilpas'}{style && !tuning ? ' · tilpasset' : ''} {tuning ? '▴' : '▾'}
        </button>
      </div>

      {!s.decorReady && (
        <div className="decor__row decor__row--meta">
          <span className="decor__off">
            Billedmodellen mangler en nøgle. Indsæt din egen — den bliver i denne browser.
          </span>
          <KeyField />
        </div>
      )}

      {tuning && (
        <div className="decor__tune">
          <div className="decor__row">
            <label className="decor__field decor__field--wide">
              <span className="decor__label">Stil <em>— valgfrit</em></span>
              <input
                type="text"
                value={s.decorStyle}
                onChange={(e) => s.setDecorStyle(e.target.value)}
                placeholder={DEFAULT_BACKDROP_STYLE}
              />
              <span className={over ? 'decor__hint decor__hint--warn' : 'decor__hint'}>
                {over ? `For lang — kun de første ${STYLE_LIMIT} tegn kommer med.` : 'Tomt = lys, appetitlig tilbudsavis-fotografi.'}
              </span>
            </label>
          </div>

          <div className="decor__row decor__row--meta">
            <button className="decor__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? 'Skjul' : 'Vis'} den fulde prompt
            </button>
            {s.decorModel && <code className="decor__model" title="Billedmodellen der kaldes">{s.decorModel}</code>}
            {s.decorReady && <KeyField />}
          </div>
          {open && <p className="decor__prompt">{preview}</p>}

          {/* The earlier way: one motif, cut out, pinned in a corner. */}
          <div className="decor__row decor__row--meta">
            <input
              type="text"
              className="decor__old"
              value={s.decorNote}
              onChange={(e) => s.setDecorNote(e.target.value)}
              placeholder='motiv, fx "efterår" (valgfrit)'
            />
            <button
              className="decor__toggle"
              disabled={blocked}
              onClick={() => void (pageNumber ? s.decorate([s.activePageId!]) : s.decorate())}
              title="Den gamle metode: ét motiv, skåret ud og lagt i et hjørne af siden"
            >
              Tegn ét motiv i hjørnet i stedet
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
