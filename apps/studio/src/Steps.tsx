/**
 * What to do next, said once and in order.
 *
 * The toolbar is ten controls on one line, and every one of them is
 * available from the moment the studio opens. That is honest and it is
 * unusable for somebody seeing it for the first time: nothing says that
 * a feed comes before pages, that pages come before polishing, or that
 * the PDF is the end rather than another option. People pressed
 * whatever looked most like a button.
 *
 * So the work is named as four steps, the step you are actually on is
 * lit, and ONE sentence under it says what to do — with the one control
 * that does it. The toolbar keeps everything, because an editor who
 * knows the tool should not have to walk through a wizard; this strip
 * is the answer to "where am I", not a gate.
 *
 * The step is derived, never stored. A stored step is a thing that can
 * disagree with the document — open yesterday's catalogue and a stored
 * step would say "upload a feed" over a finished avis.
 */
import type { ReactNode } from 'react';
import { useStudio } from './state.js';

/** The four things that happen to a catalogue, in the order they do. */
const STEPS = [
  { key: 'varer', title: 'Varer', said: 'Ugens feed' },
  { key: 'sider', title: 'Sider', said: 'Layout fra de trykte sider' },
  { key: 'finpuds', title: 'Finpuds', said: 'Ret til på siden' },
  { key: 'pdf', title: 'PDF', said: 'Ud til tryk' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

/**
 * Which step the document is on.
 *
 * Exported and pure so the toolbar can ask the same question the strip
 * answers: the highlighted button and the lit step must never disagree,
 * and they will the moment two places work it out separately.
 */
export function stepOf(state: {
  feed: unknown;
  pages: number;
  touched: boolean;
}): StepKey {
  if (!state.feed) return 'varer';
  if (state.pages === 0) return 'sider';
  return state.touched ? 'pdf' : 'finpuds';
}

/** What to do on this step, in one sentence, with the control that does it. */
function guidance(step: StepKey, count: number, pages: number): ReactNode {
  if (step === 'varer') {
    return <>Læg ugens feed ind — <b>Upload feed</b> i bjælken foroven.</>;
  }
  if (step === 'sider') {
    return (
      <>
        {count > 0 && <>{count} varer er klar. </>}
        Tryk <b>Genskab sider</b> og aflevér de trykte sider, avisen skal ligne
        — én fil pr. side, eller et sideinterval af en PDF.
      </>
    );
  }
  if (step === 'finpuds') {
    return (
      <>
        {pages === 1 ? 'Siden' : `${pages} sider`} er bygget. Klik på en vare for
        at rette den, eller brug <b>Stil klynger op</b> på sidens egen bjælke til
        at sætte flere varer sammen på ét billede.
      </>
    );
  }
  return <>Siderne er rettet til. <b>Gem</b> arbejdet, og hent avisen som <b>PDF</b>.</>;
}

export function Steps() {
  const s = useStudio();
  if (!s.brand) return null;

  const pages = s.document?.pages.length ?? 0;
  const step = stepOf({
    feed: s.feed,
    pages,
    // "Polished" is not a fact the document states, so it is read off
    // the only trace polishing leaves: an undo history.
    touched: s.past.length > 0,
  });
  const at = STEPS.findIndex((entry) => entry.key === step);

  return (
    <div className="steps">
      <ol className="steps__list">
        {STEPS.map((entry, index) => (
          <li
            key={entry.key}
            className={`steps__step${index === at ? ' is-now' : ''}${
              index < at ? ' is-done' : ''}`}
          >
            <span className="steps__no">{index + 1}</span>
            <span className="steps__what">
              <b>{entry.title}</b>
              <em>{entry.said}</em>
            </span>
          </li>
        ))}
      </ol>
      <p className="steps__say">{guidance(step, s.feedOffers.length, pages)}</p>
    </div>
  );
}
