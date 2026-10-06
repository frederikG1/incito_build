import { useMemo, useState } from 'react';
import { designTags, forCms, readIncitoDesigns, type Offer, type OfferDesign } from '@incitio/schema';
import { useStudio, useStudioPick } from './state.js';
import { blankDesign, freeTag } from './design-new.js';
import { Preview, TYPE_WORDS, newDesignId } from './design-parts.js';
import { DesignEditor } from './DesignEditor.js';

/**
 * Varedesigns — the chain's offer designs, the way the CMS keeps them.
 *
 * A design is one cell: fixed boxes for the picture, the price, the
 * saving, the words, the marks and the labels. The rules pick a design
 * for each offer ("har ikke billede → … Uden billede"), the page picks
 * the tag it starts from, and the design decides where everything
 * stands. Nothing is placed by looking at a photograph.
 *
 * Copied in from Tjek's CMS (Design templates → Offers → Clipboard →
 * Copy to clipboard, then "Hent fra CMS" here) and copied back the same
 * way — the format is the CMS's own.
 */

/** Offers to show the designs with: the avis's own, then the week's — ones with a picture first. */
function useExamples(): Offer[] {
  const document = useStudio((s) => s.document);
  const feed = useStudio((s) => s.feedOffers);
  return useMemo(() => {
    const seen = new Set<string>();
    const all = [...(document?.offers ?? []), ...feed].filter((o) => o.members.length === 0 && !seen.has(o.id) && (seen.add(o.id), true));
    return [...all.filter((o) => o.imageUrl), ...all.filter((o) => !o.imageUrl)].slice(0, 60);
  }, [document?.offers, feed]);
}

export function DesignsPanel() {
  const s = useStudioPick(
    'brand', 'designEditing', 'designsFromRules', 'designsReturn', 'designsSaving', 'document',
    'setDesignEditing', 'setDesignsOpen', 'setOfferDesigns', 'setRulesOpen'
  );
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const examples = useExamples();
  const [exampleId, setExampleId] = useState<string | null>(null);
  const brand = s.brand;
  // Which design is open is the page's address (`#/<kæde>/varedesigns/<id>`), so it lives in the store.
  const editing = s.designEditing;
  const setEditing = s.setDesignEditing;
  if (!brand) return null;
  const back = s.designsReturn;
  const backSaid = !back || back.view === 'hjem' ? 'Forsiden'
    : back.view === 'side' ? `Side ${(s.document?.pages.findIndex((p) => p.id === back.openPageId) ?? -1) + 1 || ''}`.trim()
      : 'Avisen';

  const designs = brand.offerDesigns;
  const tag = brand.designTag;
  const example = examples.find((o) => o.id === exampleId) ?? examples[0] ?? null;
  const shown = designs.filter((d) => !query.trim() || d.tag.toLowerCase().includes(query.trim().toLowerCase()));
  const save = (next: OfferDesign[], nextTag = tag) => s.setOfferDesigns(next, nextTag ?? designTags(next)[0] ?? null);
  const current = editing ? designs.find((d) => d.id === editing) ?? null : null;

  const importText = () => {
    try {
      const { designs: incoming, skipped } = readIncitoDesigns(pasted);
      if (incoming.length === 0) { setSaid('Fandt ingen varedesigns i teksten — kopiér fra fanen Offers i CMS’et.'); return; }
      const byId = new Map(designs.map((d) => [d.id, d]));
      for (const design of incoming) byId.set(design.id, design);
      save([...byId.values()]);
      setSaid(`${incoming.length} designs hentet${skipped ? ` · ${skipped} sektionsdesigns sprunget over` : ''}`);
      setImporting(false);
      setPasted('');
    } catch (error) {
      setSaid(`Kunne ikke læses: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <main className="book designs" aria-label="Varedesigns">
      <header className="designs__head">
        <button className="thin designs__return" onClick={() => s.setDesignsOpen(false)} title="Tilbage hertil fra hvor du kom">
          ‹ {backSaid}
        </button>
        <div>
          <h2>Varedesigns <small>· {brand.name.split(' — ')[0]}</small></h2>
          <p>Hvert design er én plads: faste felter til billede, pris, besparelse, tekst og mærker. Reglerne vælger designet — designet bestemmer hvor tingene står.</p>
        </div>
        <span className={`rules__saved rules__saved--${s.designsSaving}`}>
          {s.designsSaving === 'saving' ? 'Gemmer…' : s.designsSaving === 'failed' ? 'Kunne ikke gemme' : 'Gemt for kæden'}
        </span>
      </header>
      {s.designsFromRules && (
        <button className="linkish designs__back" onClick={() => s.setRulesOpen(true)}>‹ Tilbage til reglerne</button>
      )}

      {current ? (
        <DesignEditor
          design={current}
          examples={examples}
          example={example}
          onExample={setExampleId}
          onChange={(next) => save(designs.map((d) => (d.id === next.id ? next : d)))}
          onBack={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="designs__bar">
            <input className="designs__search" placeholder="Søg i designs…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="designs__example">
              Vis med
              <select value={example?.id ?? ''} onChange={(e) => setExampleId(e.target.value)}>
                {examples.map((o) => <option key={o.id} value={o.id}>{o.name}{o.imageUrl ? '' : ' (uden billede)'}</option>)}
              </select>
            </label>
            <label className="designs__example">
              Siderne bruger
              <select value={tag ?? ''} onChange={(e) => save(designs, e.target.value)}>
                {designTags(designs).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button
              className="go"
              onClick={() => {
                const design = blankDesign(newDesignId(), freeTag(designs));
                save([...designs, design]);
                setEditing(design.id);
              }}
            >+ Nyt design</button>
            <button className="thin" onClick={() => setImporting(!importing)}>Hent fra CMS</button>
            <button
              className="thin"
              disabled={designs.length === 0}
              onClick={() => {
                void navigator.clipboard.writeText(`incito_designs:${JSON.stringify(forCms(designs))}`)
                  .then(() => setSaid(`${designs.length} designs kopieret — sæt dem ind i CMS’et med Paste from clipboard`))
                  .catch(() => setSaid('Udklipsholderen kunne ikke nås'));
              }}
            >
              Kopiér til CMS
            </button>
          </div>
          {said && <p className="designs__said">{said}</p>}
          {importing && (
            <div className="designs__import">
              <p>I CMS’et: <b>Design templates → Offers</b>, vælg designs, <b>Clipboard → Copy to clipboard</b>. Sæt det ind her:</p>
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="incito_designs:[…]" rows={5} />
              <button className="go" disabled={!pasted.trim()} onClick={importText}>Hent designs</button>
            </div>
          )}
          {designs.length === 0 && !importing && (
            <p className="designs__said">Kæden har ingen varedesigns endnu — siderne tegnes med kædens fliser. Lav et nyt, eller hent dem fra CMS’et.</p>
          )}
          <div className="designs__grid">
            {shown.map((design) => (
              <article key={design.id} className={`dcard${design.tag === tag ? ' is-default' : ''}`}>
                <button className="dcard__open" onClick={() => setEditing(design.id)} title="Ret designet">
                  <Preview design={design} offer={example} />
                  <span className="dcard__badges">
                    {design.offer_priority === 'a' && <i title="Bruges til A-varer (sidens hovedvarer)">A</i>}
                    {design.offer_type && <i title={`Kun til: ${TYPE_WORDS[design.offer_type]}`}>T</i>}
                  </span>
                </button>
                <b className="dcard__tag">{design.tag}</b>
                <small>{design.offer_type ? TYPE_WORDS[design.offer_type] : design.offer_priority === 'a' ? 'A-varer' : 'B-varer'}
                  {design.layers.some((l) => l.type === 'offer_image') ? '' : ' · uden billede'}</small>
                <div className="dcard__do">
                  <button
                    className="thin"
                    onClick={() => {
                      const copy = { ...structuredClone(design), id: newDesignId(), tag: `${design.tag} (kopi)` };
                      save([...designs, copy]);
                      setEditing(copy.id);
                    }}
                  >Kopiér</button>
                  <button
                    className="thin"
                    onClick={() => { if (window.confirm(`Slet «${design.tag}»?`)) save(designs.filter((d) => d.id !== design.id)); }}
                  >Slet</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
