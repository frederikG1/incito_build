import { useStudio } from './state.js';
import type { Finding, FindingKind } from './findings.js';

/**
 * What is missing, as a list you can work through.
 *
 * The measurements all existed and none of them was anywhere near the
 * page: `npm run check` finds clipped type in a terminal on a built
 * file, `reviewCluster` finds products covering each other at the
 * moment a cluster is stood up and never again, `benched` knows which
 * products never got a cell and says so as a number in the toolbar.
 * Between them they know almost everything wrong with an avis, and the
 * way to find out was still to look through six sheets and hope.
 *
 * This is the one list, and every line in it walks you to the tile.
 * That is the whole difference: a complaint you can click is a job,
 * and a complaint you cannot is a report.
 */

/** A mark per kind, so the list can be skimmed rather than read. */
const MARKS: Record<FindingKind, string> = {
  billede: '▢',
  plads: '⬚',
  tekst: '¶',
  pris: '¤',
  klynge: '⧉',
  ark: '⤢',
  uge: '⏱',
  skabelon: '⚠',
};

function Line({ finding }: { finding: Finding }) {
  const go = useStudio((s) => s.goToFinding);
  const selected = useStudio((s) => s.selectedOfferId);
  const here = Boolean(finding.offerId) && finding.offerId === selected;

  return (
    <li>
      <button
        className={`checks__line checks__line--${finding.weight}${here ? ' is-here' : ''}`}
        onClick={() => go(finding)}
        title={finding.weight === 'stop'
          ? 'Skal rettes før tryk — klik for at stå ved flisen'
          : 'Værd at se på — klik for at stå ved flisen'}
      >
        <span className="checks__mark" aria-hidden="true">{MARKS[finding.kind]}</span>
        <span className="checks__said">{finding.said}</span>
      </button>
    </li>
  );
}

export function Checklist() {
  const findings = useStudio((s) => s.findings);
  const document = useStudio((s) => s.document);
  const open = useStudio((s) => s.findingsOpen);
  const setOpen = useStudio((s) => s.setFindingsOpen);
  const refresh = useStudio((s) => s.refreshFindings);

  if (!document || !open) return null;

  const stop = findings.filter((finding) => finding.weight === 'stop');

  return (
    <section className="checks" aria-label="Hvad mangler">
      <div className="checks__head">
        <h2>Hvad mangler?</h2>
        <span className="checks__count">
          {findings.length === 0
            ? 'ingenting — avisen er hel'
            : `${stop.length} skal rettes · ${findings.length - stop.length} værd at se`}
        </span>
        <button
          className="checks__again"
          onClick={refresh}
          title="Mål siderne igen — efter et billede er landet, eller et vindue er ændret"
        >
          Mål igen
        </button>
        <button className="checks__close" onClick={() => setOpen(false)} title="Skjul listen">×</button>
      </div>

      {findings.length === 0 ? (
        <p className="checks__clear">
          Ingen huller, ingen afskæring, alle varer har en plads. Hent PDF’en.
        </p>
      ) : (
        <ol className="checks__list">
          {findings.map((finding) => <Line key={finding.id} finding={finding} />)}
        </ol>
      )}
    </section>
  );
}

/** The toolbar's way in, and the count that makes it worth pressing. */
export function ChecklistButton() {
  const findings = useStudio((s) => s.findings);
  const open = useStudio((s) => s.findingsOpen);
  const setOpen = useStudio((s) => s.setFindingsOpen);
  const document = useStudio((s) => s.document);

  if (!document) return null;
  const stop = findings.filter((finding) => finding.weight === 'stop').length;

  return (
    <button
      className={open ? 'primary' : stop > 0 ? 'accent' : ''}
      onClick={() => setOpen(!open)}
      title="Huller, afskæring og varer uden plads — samlet i én liste"
    >
      Hvad mangler?
      {findings.length > 0 && (
        <span className={`bar__badge${stop > 0 ? ' bar__badge--stop' : ''}`}>
          {findings.length}
        </span>
      )}
    </button>
  );
}
