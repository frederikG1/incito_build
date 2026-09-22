import { useState } from 'react';
import { weekRange, weeksInYear, type CatalogWeek } from '@incitio/schema';
import { suggestedWeek, useStudio } from './state.js';

/**
 * Which week is this?
 *
 * The question the studio never asked, and the one everything else
 * turns out to depend on. Without it a catalogue has nothing to be
 * called, so fifteen of them ended up called "Hentet udgivelse"; the
 * feed cannot be cut to the offers that actually run, so last week's
 * goods print alongside this week's; and nothing on screen says which
 * paper is on screen.
 *
 * Asked once, at the last possible moment — the first time somebody
 * asks for pages — and then never again. Not a wizard step and not a
 * splash screen: the studio opens on the work, and the question
 * arrives attached to the request that needs it, with the request
 * still in hand so answering it also runs the thing that was asked
 * for. See `askingWeek`.
 */
export function AskWeek() {
  const asking = useStudio((s) => s.askWeek);
  const close = useStudio((s) => s.closeAskWeek);
  const setWeek = useStudio((s) => s.setWeek);
  const brand = useStudio((s) => s.brand);

  /*
   * Prefilled with next week, because a leaflet is made before it
   * runs. Being one keystroke from right beats an empty field.
   */
  const [picked, setPicked] = useState<CatalogWeek>(suggestedWeek);

  if (!asking) return null;

  const years = [picked.year - 1, picked.year, picked.year + 1];
  const most = weeksInYear(picked.year);
  const sane = picked.week >= 1 && picked.week <= most;

  return (
    <div
      className="ask"
      role="dialog"
      aria-modal="true"
      aria-label="Hvilken uge laver I?"
      // Clicking the dimmed paper around it drops the request, the way
      // Escape does. The button is the way through, not the only way out.
      onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
    >
      <div className="ask__card">
        <h2>Hvilken uge laver I?</h2>
        <p className="ask__why">
          Avisen får navn efter ugen, gyldighedsdatoerne udfyldes, og feedet
          skæres til de varer der faktisk gælder. Spørges kun denne ene gang.
        </p>

        <div className="ask__row">
          <label className="ask__field">
            <span>Uge</span>
            <input
              type="number"
              min={1}
              max={53}
              autoFocus
              value={picked.week}
              onChange={(event) => setPicked({ ...picked, week: Number(event.target.value) })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && sane) setWeek(picked);
              }}
            />
          </label>

          <label className="ask__field">
            <span>År</span>
            <select
              value={picked.year}
              onChange={(event) => setPicked({ ...picked, year: Number(event.target.value) })}
            >
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>

          {/* The answer, before it is given. A week number is not
              something anybody reads as dates, and the dates are what
              the offers are checked against. */}
          <p className={`ask__said${sane ? '' : ' ask__said--bad'}`}>
            {sane
              ? <>gælder <b>{weekRange(picked)}</b></>
              : <>{picked.year} har kun {most} uger</>}
          </p>
        </div>

        <div className="ask__foot">
          <span className="ask__name">
            {sane && brand ? `Avisen kommer til at hedde “${brand.name} · uge ${picked.week}”` : ''}
          </span>
          <button className="ask__skip" onClick={close}>Fortryd</button>
          <button className="ask__go" disabled={!sane} onClick={() => setWeek(picked)}>
            Fortsæt
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The week, in the toolbar, where the avis is named.
 *
 * Both a readout and the control: the number is editable in place, so
 * changing week is one keystroke rather than a menu, and the dates sit
 * next to it because "uge 39" is not something anybody reads as dates.
 */
export function WeekField() {
  const week = useStudio((s) => s.week);
  const setWeek = useStudio((s) => s.setWeek);
  const document = useStudio((s) => s.document);

  if (!week) {
    return (
      <span className="week week--none" title="Ingen uge valgt endnu">
        ingen uge
      </span>
    );
  }

  const most = weeksInYear(week.year);

  return (
    <span className="week" title={`${week.year} · uge ${week.week}`}>
      <label className="week__pick">
        <span>Uge</span>
        <input
          type="number"
          min={1}
          max={most}
          value={week.week}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next >= 1 && next <= most) setWeek({ ...week, week: next });
          }}
        />
      </label>
      <span className="week__range">
        gælder {weekRange(week)}
        {/* Said only when it could be wrong: a catalogue from before
            anyone asked carries no week of its own, so the toolbar is
            describing the session rather than the document. */}
        {document && !document.week && <i> · ikke gemt på avisen endnu</i>}
      </span>
    </span>
  );
}
