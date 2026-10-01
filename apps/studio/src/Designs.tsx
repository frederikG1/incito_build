import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  OFFER_TYPES, brandCssVars, designTags, readIncitoDesigns,
  type DesignLayer, type DesignParagraph, type Offer, type OfferDesign, type OfferType,
} from '@incitio/schema';
import { DesignTile, ImageSize } from '@incitio/renderer';
import { THUMB_PX, EDITOR_PX, useStudio } from './state.js';

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

const LAYER_WORDS: Record<string, string> = {
  offer_image: 'Billede', offer_bg_image: 'Baggrund', offer_text: 'Tekst', offer_price: 'Pris',
  offer_savings: 'Besparelse', offer_membership_price: 'Medlemspris', offer_membership_savings: 'Medlemsbesparelse',
  offer_membership_relative_savings: 'Medlemsrabat %', offer_relative_savings: 'Rabat %', offer_logos: 'Mærker',
  offer_energy_class: 'Energimærke',
  offer_custom_label_1: 'Etiket 1', offer_custom_label_2: 'Etiket 2', offer_custom_label_3: 'Etiket 3',
  offer_comment_label_1: 'Kommentar 1', offer_comment_label_2: 'Kommentar 2', offer_comment_label_3: 'Kommentar 3',
};
const layerWord = (layer: DesignLayer) => (layer.type ? LAYER_WORDS[layer.type] ?? layer.type : layer.name || 'Gruppe');

const TYPE_WORDS: Record<OfferType, string> = {
  regular_price: 'Almindelig pris', regular_price_with_savings: 'Almindelig pris med besparelse',
  membership_price: 'Medlemspris', membership_price_with_savings: 'Medlemspris med besparelse',
  membership_relative_savings: 'Medlemsrabat i %', relative_savings: 'Rabat i %', app_price: 'App-pris', from_price: 'Fra-pris', get_x_for_y: 'Flerstyk (2 for …)',
};

const round = (value: number) => Math.round(value * 10000) / 10000;
const newDesignId = () => `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

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

/** One design, drawn with one offer, in a square cell on the chain's ground. */
function Preview({ design, offer, px = THUMB_PX }: { design: OfferDesign; offer: Offer | null; px?: number }) {
  const brand = useStudio((s) => s.brand);
  if (!brand) return null;
  return (
    <div className="dpreview" style={brandCssVars(brand) as React.CSSProperties}>
      <ImageSize.Provider value={px}>
        {offer ? <DesignTile design={design} offer={offer} aspect={1} /> : <span className="dpreview__none">Ingen vare at vise med</span>}
      </ImageSize.Provider>
    </div>
  );
}

export function DesignsPanel() {
  const s = useStudio();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const examples = useExamples();
  const [exampleId, setExampleId] = useState<string | null>(null);
  const brand = s.brand;
  if (!s.designsOpen || !brand) return null;

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
    <div className="designs" role="dialog" aria-label="Varedesigns">
      <header className="designs__head">
        <div>
          <h2>Varedesigns</h2>
          <p>Hvert design er én plads: faste felter til billede, pris, besparelse, tekst og mærker. Reglerne vælger designet — designet bestemmer hvor tingene står.</p>
        </div>
        <span className={`rules__saved rules__saved--${s.designsSaving}`}>
          {s.designsSaving === 'saving' ? 'Gemmer…' : s.designsSaving === 'failed' ? 'Kunne ikke gemme' : 'Gemt for kæden'}
        </span>
        <button className="rules__close" onClick={() => s.setDesignsOpen(false)} title="Luk">×</button>
      </header>

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
            <button className="thin" onClick={() => setImporting(!importing)}>Hent fra CMS</button>
            <button
              className="thin"
              disabled={designs.length === 0}
              onClick={() => {
                void navigator.clipboard.writeText(`incito_designs:${JSON.stringify(designs)}`)
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
            <p className="designs__said">Kæden har ingen varedesigns endnu — siderne tegnes med kædens fliser. Hent dem fra CMS’et.</p>
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
    </div>
  );
}

/* ------------------------------------------------------------ editor */

type Drag = { layerId: string; mode: 'move' | 'resize'; x: number; y: number; start: DesignLayer };

function DesignEditor({
  design, examples, example, onExample, onChange, onBack,
}: {
  design: OfferDesign; examples: Offer[]; example: Offer | null;
  onExample: (id: string) => void; onChange: (design: OfferDesign) => void; onBack: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const layer = design.layers.find((l) => String(l.id) === picked) ?? null;

  const setLayer = (id: string, patch: Partial<DesignLayer>) => onChange({
    ...design, layers: design.layers.map((l) => (String(l.id) === id ? { ...l, ...patch } : l)),
  });
  const setParagraph = (id: string, pid: string, patch: Partial<DesignParagraph>) => {
    const target = design.layers.find((l) => String(l.id) === id);
    if (!target) return;
    setLayer(id, { paragraphs: target.paragraphs.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });
  };

  const down = (event: ReactPointerEvent, target: DesignLayer, mode: Drag['mode']) => {
    event.preventDefault();
    event.stopPropagation();
    setPicked(String(target.id));
    drag.current = { layerId: String(target.id), mode, x: event.clientX, y: event.clientY, start: target };
    (event.target as Element).setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (event.clientX - d.x) / box.width;
    const dy = (event.clientY - d.y) / box.height;
    const s = d.start;
    if (d.mode === 'move') {
      setLayer(d.layerId, { x1: round(s.x1 + dx), x2: round(s.x2 + dx), y1: round(s.y1 + dy), y2: round(s.y2 + dy) });
    } else {
      setLayer(d.layerId, { x2: round(Math.max(s.x1 + 0.03, s.x2 + dx)), y2: round(Math.max(s.y1 + 0.03, s.y2 + dy)) });
    }
  };
  const up = () => { drag.current = null; };

  return (
    <div className="deditor">
      <div className="deditor__left">
        <div className="deditor__top">
          <button className="thin" onClick={onBack}>‹ Alle designs</button>
          <label className="designs__example">
            Vis med
            <select value={example?.id ?? ''} onChange={(e) => onExample(e.target.value)}>
              {examples.map((o) => <option key={o.id} value={o.id}>{o.name}{o.imageUrl ? '' : ' (uden billede)'}</option>)}
            </select>
          </label>
        </div>
        <div className="deditor__stage" ref={stage} onPointerMove={move} onPointerUp={up} onPointerDown={() => setPicked(null)}>
          <Preview design={design} offer={example} px={EDITOR_PX} />
          <div className="deditor__boxes">
            {[...design.layers].reverse().map((l) => (
              <div
                key={String(l.id)}
                className={`deditor__box${String(l.id) === picked ? ' is-picked' : ''}${l.is_hidden ? ' is-hidden' : ''}`}
                style={{ left: `${l.x1 * 100}%`, top: `${l.y1 * 100}%`, width: `${(l.x2 - l.x1) * 100}%`, height: `${(l.y2 - l.y1) * 100}%` }}
                onPointerDown={(e) => down(e, l, 'move')}
                title={`${layerWord(l)} — træk for at flytte`}
              >
                {String(l.id) === picked && <span className="deditor__label">{layerWord(l)}</span>}
                {String(l.id) === picked && <span className="deditor__handle" onPointerDown={(e) => down(e, l, 'resize')} title="Træk for at ændre størrelse" />}
              </div>
            ))}
          </div>
        </div>
        <p className="deditor__hint">Klik et felt og træk det. Hjørnet ændrer størrelsen. Varen fylder kun felterne — flyttes billedfeltet, flytter billedet med.</p>
      </div>

      <div className="deditor__right">
        <label className="deditor__field">
          <span>Navn / tag <i>— designs med samme tag bruges på skift</i></span>
          <input value={design.tag} onChange={(e) => onChange({ ...design, tag: e.target.value || design.tag })} />
        </label>
        <div className="deditor__row">
          <label className="deditor__field">
            <span>Bruges til</span>
            <select value={design.offer_priority ?? 'b'} onChange={(e) => onChange({ ...design, offer_priority: e.target.value as 'a' | 'b' })}>
              <option value="a">A-varer (sidens hovedvarer)</option>
              <option value="b">B-varer (de øvrige)</option>
            </select>
          </label>
          <label className="deditor__field">
            <span>Kun til pristype</span>
            <select value={design.offer_type ?? ''} onChange={(e) => onChange({ ...design, offer_type: (e.target.value || null) as OfferType | null })}>
              <option value="">Alle</option>
              {OFFER_TYPES.map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
            </select>
          </label>
        </div>

        <h3>Felter</h3>
        <ol className="deditor__layers">
          {design.layers.map((l) => (
            <li key={String(l.id)} className={String(l.id) === picked ? 'is-picked' : ''}>
              <button className="deditor__layer" onClick={() => setPicked(String(l.id))}>{layerWord(l)}{l.name && l.type ? <small> · {l.name}</small> : null}</button>
              <button className="quiet" title={l.is_hidden ? 'Vis feltet' : 'Skjul feltet'} onClick={() => setLayer(String(l.id), { is_hidden: !l.is_hidden })}>
                {l.is_hidden ? '◌' : '●'}
              </button>
            </li>
          ))}
        </ol>

        {layer && (
          <section className="deditor__props">
            <h3>{layerWord(layer)}</h3>
            <div className="deditor__row deditor__row--nums">
              {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
                <label key={key} className="deditor__field">
                  <span>{{ x1: 'Venstre', y1: 'Top', x2: 'Højre', y2: 'Bund' }[key]} %</span>
                  <input
                    type="number" step={0.5}
                    value={Math.round(layer[key] * 1000) / 10}
                    onChange={(e) => setLayer(String(layer.id), { [key]: round(Number(e.target.value) / 100) })}
                  />
                </label>
              ))}
            </div>
            <div className="deditor__row">
              <label className="deditor__field">
                <span>Baggrund</span>
                <input value={layer.bg_color ?? ''} placeholder="rgb(209,3,12)" onChange={(e) => setLayer(String(layer.id), { bg_color: e.target.value || null })} />
              </label>
              <label className="deditor__field">
                <span>Hjørner</span>
                <input value={String(layer.border_radius ?? '')} placeholder="100%" onChange={(e) => setLayer(String(layer.id), { border_radius: e.target.value || null })} />
              </label>
            </div>
            {layer.bg_image_url?.signed && (
              <p className="deditor__art"><img src={layer.bg_image_url.signed} alt="" /> Kædens grafik i feltet</p>
            )}
            {layer.paragraphs.map((p) => (
              <div key={p.id} className={`deditor__para${p.is_hidden ? ' is-hidden' : ''}`}>
                <textarea
                  value={p.text_content}
                  rows={Math.min(6, Math.max(1, p.text_content.split('\n').length))}
                  onChange={(e) => setParagraph(String(layer.id), p.id, { text_content: e.target.value })}
                  title="Liquid som i CMS’et: {{offerName}}, {% if offerSavings %}…{% endif %}"
                />
                <div className="deditor__row deditor__row--small">
                  <label>Str. <input type="number" value={p.text_size ?? p.text_max_size ?? ''} onChange={(e) => setParagraph(String(layer.id), p.id, p.text_max_size ? { text_max_size: Number(e.target.value) || null } : { text_size: Number(e.target.value) || null })} /></label>
                  <label>Farve <input value={p.text_color ?? ''} onChange={(e) => setParagraph(String(layer.id), p.id, { text_color: e.target.value || null })} /></label>
                  <label>
                    <select value={p.text_align ?? 'left'} onChange={(e) => setParagraph(String(layer.id), p.id, { text_align: e.target.value })}>
                      <option value="left">Venstre</option><option value="center">Midt</option><option value="right">Højre</option>
                    </select>
                  </label>
                  <label>
                    <input type="checkbox" checked={p.text_weight === 'bold'} onChange={(e) => setParagraph(String(layer.id), p.id, { text_weight: e.target.checked ? 'bold' : 'normal' })} /> Fed
                  </label>
                  <label>
                    <input type="checkbox" checked={!p.is_hidden} onChange={(e) => setParagraph(String(layer.id), p.id, { is_hidden: !e.target.checked })} /> Vis
                  </label>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
