import { useState } from 'react';
import { imagePrompt, normaliseStyle, STYLE_LIMIT } from '@incitio/decor/prompt';
import { useStudio } from './state.js';

/**
 * The mood-artwork controls, as a strip of their own under the toolbar.
 *
 * They were one nameless input squeezed between two buttons on the bar,
 * which was survivable while there was one field and stopped being so
 * the moment there were two: the whole point is that they steer
 * DIFFERENT models, and two unlabelled boxes side by side say the
 * opposite. A strip has room for the labels that carry that distinction.
 *
 * Always on screen rather than behind a disclosure, for the same reason
 * the "Genskab side" panel is not: artwork is a thing you iterate on —
 * draw, look, reword, draw again — and a control you reopen every round
 * is a control you stop using.
 */

/**
 * Stands in for the motif, which is the one part of the prompt this
 * strip does NOT decide — the text model picks a different one per page.
 * A placeholder rather than a plausible example, so nobody reads the
 * preview as the prompt for some particular page.
 */
const MOTIF_SLOT = '‹motivet for siden›';

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
      <div className="decor__row">
        <h2 className="decor__title">Stemningsbillede</h2>

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
        {!s.decorReady && <span className="decor__off">ingen GEMINI_API_KEY på serveren</span>}
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
