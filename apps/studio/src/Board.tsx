import type { ReactNode } from 'react';
import { DEMO_NOTE, SIGNALS_ARE_DEMO } from './signals.js';

/**
 * What Godkend, Pladser and Live share: a head that says the state in
 * one sentence, and the label a stand-in number wears.
 *
 * Dumb on purpose — props in, markup out — so the three boards look
 * like one tool and none of them grows its own header again.
 */

export function BoardHead({ title, said, children }: { title: string; said: ReactNode; children?: ReactNode }) {
  return (
    <header className="bhead">
      <div className="bhead__lines">
        <h2>{title}</h2>
        <p>{said}</p>
      </div>
      {children && <div className="bhead__acts">{children}</div>}
    </header>
  );
}

/** Says, wherever a number is a stand-in, that it is one — quietly, in text. */
export function StandIn({ what }: { what: string }) {
  if (!SIGNALS_ARE_DEMO) return null;
  return <span className="standin" title={DEMO_NOTE}>{what}</span>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="bsection">
      <div className="bsection__head"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}
