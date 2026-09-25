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
  regler: '§',
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
          ? 'Skal rettes før tryk — klik for at gå til den'
          : 'Værd at se på — klik for at gå til den'}
      >
        <span className="checks__mark" aria-hidden="true">{MARKS[finding.kind]}</span>
        {/* Under its page's heading, so the "Side 3:" it starts with is said twice. */}
        <span className="checks__said">{finding.said.replace(/^Side \d+: /, '')}</span>
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
  // Inside a page the right edge is the panel you fix things with: the list moves left.
  const onPage = useStudio((s) => s.view === 'side');

  if (!document || !open) return null;

  const stop = findings.filter((finding) => finding.weight === 'stop');
  /*
   * By page, in the order the avis is read, the book's own lines last.
   * Twenty lines about one avis are a list; the same twenty under their
   * page numbers are a round of the paper, page by page.
   */
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = finding.pageId ?? 'avis';
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const pageName = (pageId: string) => {
    const index = document.pages.findIndex((page) => page.id === pageId);
    const page = document.pages[index];
    return index < 0 ? 'Avisen' : `Side ${index + 1}${page?.title ? ` · ${page.title}` : ''}`;
  };
  const order = [...groups.keys()].sort((a, b) => {
    const at = (key: string) => (key === 'avis' ? 1e6 : document.pages.findIndex((page) => page.id === key));
    return at(a) - at(b);
  });

  return (
    <aside className={`checks${onPage ? ' checks--left' : ''}`} aria-label="Hvad mangler">
      <div className="checks__head">
        <h2>{stop.length === 0 ? 'Klar til tryk' : 'Før tryk'}</h2>
        <button
          className="checks__again"
          onClick={refresh}
          title="Tjek siderne igen"
        >
          Tjek igen
        </button>
        <button className="checks__close" onClick={() => setOpen(false)} title="Luk">×</button>
      </div>
      <p className="checks__count">
        {findings.length === 0
          ? 'Ingen huller, ingen afskæring, alle varer har en plads.'
          : `${stop.length} skal rettes · ${findings.length - stop.length} værd at se · klik en linje for at gå til den`}
      </p>

      {findings.length === 0 ? (
        <div className="checks__clear">
          <span aria-hidden="true">✓</span>
          <p>Avisen er klar. Hent PDF’en øverst til højre.</p>
        </div>
      ) : (
        <div className="checks__groups">
          {order.map((key) => (
            <section key={key} className="checks__group">
              <h3>{pageName(key)}</h3>
              <ol className="checks__list">
                {groups.get(key)!.map((finding) => <Line key={finding.id} finding={finding} />)}
              </ol>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * The avis's state in one word, where the save and the PDF are.
 *
 * "Klar til tryk" in green is the thing a person wants to see before
 * they send the file, and it was nowhere: the list existed and had no
 * way in. Red with a count when something stops the print, amber when
 * something is only worth a look.
 */
export function ReadyPill() {
  const findings = useStudio((s) => s.findings);
  const open = useStudio((s) => s.findingsOpen);
  const setOpen = useStudio((s) => s.setFindingsOpen);
  const document = useStudio((s) => s.document);
  if (!document) return null;
  const stop = findings.filter((finding) => finding.weight === 'stop').length;
  const look = findings.length - stop;
  const tone = stop > 0 ? 'stop' : look > 0 ? 'look' : 'ok';
  return (
    <button
      className={`ready ready--${tone}${open ? ' is-open' : ''}`}
      onClick={() => setOpen(!open)}
      title="Det der skal tjekkes før tryk — tomme pladser, tekst der er skåret af, manglende pant m.m."
    >
      <span className="ready__dot" aria-hidden="true">{tone === 'ok' ? '✓' : ''}</span>
      {tone === 'ok'
        ? 'Klar til tryk'
        : stop > 0
          ? `${stop} skal rettes`
          : `${look} værd at se`}
    </button>
  );
}
