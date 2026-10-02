import { useMemo } from 'react';
import {
  EMPHASES, OfferRule, RULE_FACTS, STARTER_RULES, VARIANTS, VARIANT_DESIGNS, brandCssVars, designTags, meets, offerFacts, ruleMatches,
  type OfferDesign, type Brand, type CatalogPage, type Offer, type OfferRuleInput, type PageTemplate, type RuleCondition, type RuleFact, type RuleLook,
} from '@incitio/schema';
import { DesignTile, ImageSize, PageView } from '@incitio/renderer';
import { THUMB_PX, useStudio } from './state.js';
import { usePopover } from './popover.js';

/**
 * The chain's own rules for which layout an offer gets.
 *
 * A sentence per rule, set with clicks: "Når varen har livsstilsbillede →
 * Billede i hele feltet". The layout places the picture, the words, the
 * price and the sticker — the rule only chooses it, as incito's offer
 * designs are chosen. Nothing here is code.
 *
 * Every condition says how many of the week's products it catches, so a
 * condition the feed never fills is seen at once rather than suspected.
 * Top rule wins.
 */

/* ------------------------------------------------------------- words */

/** How a condition reads, both ways round. */
const FACT_WORDS: Record<RuleFact, { yes: string; no: string }> = {
  image: { yes: 'har billede', no: 'har ikke billede' },
  hero: { yes: 'står på hovedpladsen', no: 'står ikke på hovedpladsen' },
  lifestyle: { yes: 'har livsstilsbillede', no: 'har pakkebillede' },
  lead: { yes: 'er hovedvare', no: 'er ikke hovedvare' },
  member: { yes: 'har medlemspris', no: 'har ikke medlemspris' },
  reduced: { yes: 'er nedsat', no: 'er ikke nedsat' },
  savings: { yes: 'har besparelse', no: 'har ingen besparelse' },
  savingsShare: { yes: 'sparer mindst', no: 'sparer under' },
  multibuy: { yes: 'har mængderabat', no: 'har ikke mængderabat' },
  campaign: { yes: 'er i en kampagne', no: 'er ikke i en kampagne' },
  group: { yes: 'er et samlet tilbud', no: 'er ikke et samlet tilbud' },
  organic: { yes: 'er økologisk', no: 'er ikke økologisk' },
  isNew: { yes: 'er nyhed', no: 'er ikke nyhed' },
  tested: { yes: 'er testet', no: 'er ikke testet' },
  warranty: { yes: 'har garanti', no: 'har ikke garanti' },
  from: { yes: 'har fra-pris', no: 'har ikke fra-pris' },
  label: { yes: 'har mærket', no: 'har ikke mærket' },
};

const EMPHASIS_WORDS: Record<(typeof EMPHASES)[number], string> = {
  auto: 'Som layoutet', less: 'Mindre', normal: 'Normal', more: 'Mere', most: 'Mest',
};
/** Rules to start from — the ones a chain asks for first. */
const STARTERS: { label: string; rule: Omit<OfferRuleInput, 'id'> }[] = [
  { label: 'Hovedpladsen', rule: { name: 'Hovedpladsen', when: [{ fact: 'hero' }], then: { variant: 'lead' } } },
  { label: 'Medlemspris', rule: { name: 'Medlemspris', when: [{ fact: 'member' }], then: { variant: 'member', emphasis: 'more' } } },
  { label: 'Stor besparelse', rule: { name: 'Stor besparelse', when: [{ fact: 'savingsShare', atLeast: 25 }], then: { variant: 'savings' } } },
  { label: 'Livsstilsbillede', rule: { name: 'Livsstilsbillede', when: [{ fact: 'lifestyle' }], then: { variant: 'lifestyle' } } },
  { label: 'Nedsat pris', rule: { name: 'Nedsat pris', when: [{ fact: 'reduced' }], then: { variant: 'reduced' } } },
  { label: 'Nyhed', rule: { name: 'Nyhed', when: [{ fact: 'isNew' }], then: { variant: 'new' } } },
  { label: 'Mærke', rule: { name: 'Mærke', when: [{ fact: 'label', text: 'Testet' }], then: { emphasis: 'more' } } },
  { label: 'Tom regel', rule: { name: 'Ny regel', when: [], then: {} } },
];

export const newId = () => `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ------------------------------------------------------------- panel */

/** Rules to start from on a chain with offer designs: which design a kind of offer gets. */
function designStarters(tags: string[]): { label: string; rule: Omit<OfferRuleInput, 'id'> }[] {
  const find = (pattern: RegExp) => tags.find((tag) => pattern.test(tag)) ?? tags[0] ?? null;
  return [
    { label: 'Uden billede', rule: { name: 'Uden billede', when: [{ fact: 'image', is: false }], then: { design: find(/uden billede/i) } } },
    { label: 'Medlemspris', rule: { name: 'Medlemspris', when: [{ fact: 'member' }], then: { design: find(/medlem/i) } } },
    { label: 'Hovedpladsen', rule: { name: 'Hovedpladsen', when: [{ fact: 'hero' }], then: { design: null, emphasis: 'more' } } },
    { label: 'Mærke', rule: { name: 'Mærke', when: [{ fact: 'label', text: 'Økologi' }], then: { design: null } } },
    { label: 'Tom regel', rule: { name: 'Ny regel', when: [], then: {} } },
  ];
}

export function OfferRulesPanel() {
  const open = useStudio((s) => s.rulesOpen);
  const setOpen = useStudio((s) => s.setRulesOpen);
  usePopover(open, () => setOpen(false));
  const brand = useStudio((s) => s.brand);
  const saving = useStudio((s) => s.rulesSaving);
  const setRules = useStudio((s) => s.setOfferRules);
  const document = useStudio((s) => s.document);
  const feedOffers = useStudio((s) => s.feedOffers);

  // The avis's own products first, then the rest of the week's.
  const offers = useMemo(() => {
    const seen = new Set<string>();
    return [...(document?.offers ?? []), ...feedOffers]
      .filter((offer) => (seen.has(offer.id) ? false : (seen.add(offer.id), true)));
  }, [document?.offers, feedOffers]);

  if (!open || !brand) return null;
  // A chain that has written none works by incito's logic, stated — and editing it makes it the chain's own.
  const designed = brand.offerDesigns.length > 0;
  // With designs, the rules choose designs; incito's variant logic is for chains without them.
  const rules = brand.offerRules.length > 0 ? brand.offerRules : designed ? [] : STARTER_RULES;
  const starting = brand.offerRules.length === 0 && !designed;
  const starters = designed ? designStarters(designTags(brand.offerDesigns)) : STARTERS;
  const change = (index: number, next: OfferRule) => setRules(rules.map((rule, at) => (at === index ? next : rule)));
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setRules(next);
  };

  return (
    <aside className="rules" aria-label="Regler for varer">
      <header className="rules__head">
        <div>
          <h2>Regler for varer</h2>
          <p>Bestem hvordan en vare ser ud ud fra hvad den er. Reglerne læses oppefra — den øverste vinder.</p>
        </div>
        <span className={`rules__saved rules__saved--${saving}`}>
          {saving === 'saving' ? 'Gemmer…' : saving === 'failed' ? 'Kunne ikke gemme' : 'Gemt for kæden'}
        </span>
        <button className="rules__close" onClick={() => setOpen(false)} title="Luk">×</button>
      </header>

      {starting && (
        <p className="rules__empty">Standardreglerne — de samme som incitos. Ret i dem, så bliver de kædens egne.</p>
      )}
      <p className="rules__empty">
        {designed
          ? <>Reglerne gælder alle sider. En regel vælger hvilket <button className="linkish" onClick={() => useStudio.getState().setDesignsOpen(true)}>varedesign</button> varen får — designet bestemmer hvor billede, pris og tekst står. Uden en regel bruger varen sidens design.</>
          : 'Reglerne gælder alle sider. Varen genkendes ud fra feedet — nedsat, medlemspris, nyhed, mærker — og får sin variant af sig selv.'}
      </p>

      <ol className="rules__list">
        {rules.map((rule, index) => (
          <li key={rule.id}>
            <RuleCard
              rule={rule}
              offers={offers}
              first={index === 0}
              last={index === rules.length - 1}
              onChange={(next) => change(index, next)}
              onMove={(by) => move(index, by)}
              onRemove={() => setRules(rules.filter((_, at) => at !== index))}
            />
          </li>
        ))}
      </ol>

      <div className="rules__add">
        <span>Tilføj regel:</span>
        {starters.map((starter) => (
          <button
            key={starter.label}
            className="thin"
            disabled={rules.length >= 40}
            onClick={() => setRules([...rules, OfferRule.parse({ ...starter.rule, id: newId() })])}
          >
            {starter.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------- rule */

function RuleCard({
  rule, offers, first, last, onChange, onMove, onRemove,
}: {
  rule: OfferRule; offers: Offer[]; first: boolean; last: boolean;
  onChange: (rule: OfferRule) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const caught = useMemo(
    // Asked as if each stood on the lead place when the rule is about it — a preview of what it does there.
    () => offers.filter((offer) => ruleMatches({ ...rule, enabled: true }, offerFacts(offer, { hero: rule.when.some((c) => c.fact === 'hero' && c.is) }))),
    [offers, rule],
  );
  const then = (patch: Partial<RuleLook>) => onChange({ ...rule, then: { ...rule.then, ...patch } });
  const designs = useStudio((s) => s.brand?.offerDesigns ?? []);
  const condition = (index: number, patch: Partial<RuleCondition> | null) => onChange({
    ...rule,
    when: patch === null
      ? rule.when.filter((_, at) => at !== index)
      : rule.when.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
  });

  return (
    <article className={`rule${rule.enabled ? '' : ' rule--off'}`}>
      <header className="rule__head">
        <label className="rule__on" title={rule.enabled ? 'Slå reglen fra' : 'Slå reglen til'}>
          <input type="checkbox" checked={rule.enabled} onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} />
        </label>
        <input
          className="rule__name"
          value={rule.name}
          maxLength={80}
          onChange={(e) => onChange({ ...rule, name: e.target.value || 'Regel' })}
        />
        <button className="quiet" disabled={first} onClick={() => onMove(-1)} title="Flyt op — vinder over reglerne under">↑</button>
        <button className="quiet" disabled={last} onClick={() => onMove(1)} title="Flyt ned">↓</button>
        <button className="quiet" onClick={onRemove} title="Slet reglen">×</button>
      </header>

      <div className="rule__when">
        <b>Når varen</b>
        {rule.when.length === 0 && <span className="rule__all">— alle varer</span>}
        {rule.when.map((entry, index) => (
          <span className="rule__cond" key={index}>
            {index > 0 && <i>og</i>}
            <select
              value={`${entry.fact}:${entry.is ? 'yes' : 'no'}`}
              onChange={(e) => {
                const [fact, way] = e.target.value.split(':') as [RuleFact, string];
                condition(index, {
                  fact, is: way === 'yes',
                  atLeast: fact === 'savingsShare' ? entry.atLeast ?? 25 : null,
                  text: fact === 'label' ? entry.text ?? '' : null,
                });
              }}
            >
              {RULE_FACTS.flatMap((fact) => [
                <option key={`${fact}:yes`} value={`${fact}:yes`}>{FACT_WORDS[fact].yes}</option>,
                <option key={`${fact}:no`} value={`${fact}:no`}>{FACT_WORDS[fact].no}</option>,
              ])}
            </select>
            <Count offers={offers} condition={entry} />
            {entry.fact === 'savingsShare' && (
              <label className="rule__pct">
                <input
                  type="number" min={0} max={100} step={5}
                  value={entry.atLeast ?? 0}
                  onChange={(e) => condition(index, { atLeast: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
                %
              </label>
            )}
            {entry.fact === 'label' && (
              <input
                className="rule__word"
                value={entry.text ?? ''}
                placeholder="Testet"
                maxLength={60}
                title="Ord som et af varens mærker indeholder — store og små bogstaver er lige"
                onChange={(e) => condition(index, { text: e.target.value })}
              />
            )}
            <button className="quiet rule__x" onClick={() => condition(index, null)} title="Fjern betingelsen">×</button>
          </span>
        ))}
        {rule.when.length < 6 && (
          <button
            className="thin rule__and"
            onClick={() => onChange({ ...rule, when: [...rule.when, { fact: 'member', is: true, atLeast: null, text: null }] })}
          >
            + {rule.when.length === 0 ? 'betingelse' : 'og'}
          </button>
        )}
      </div>

      <div className="rule__then">
        <b>Så</b>
        {designs.length > 0 ? (
          <div className="rule__choice rule__choice--layout">
            <span>Design</span>
            <DesignPicker designs={designs} value={rule.then.design} example={caught[0] ?? offers[0] ?? null} onPick={(design) => then({ design })} />
          </div>
        ) : (
          <div className="rule__choice rule__choice--layout">
            <span>Variant</span>
            <VariantPicker value={rule.then.variant} example={caught[0] ?? offers[0] ?? null} onPick={(variant) => then({ variant })} />
          </div>
        )}
        <Choice
          label="Fokus på siden"
          hint="Mere fokus giver varen de store pladser, når siderne lægges"
          words={EMPHASIS_WORDS}
          value={rule.then.emphasis}
          onPick={(emphasis) => then({ emphasis })}
        />
        <label className="rule__text">
          <span>Tekst på medlemsmærket</span>
          <input
            value={rule.then.memberBadgeText ?? ''}
            placeholder="Medlemsrabat 5,-"
            maxLength={40}
            onChange={(e) => then({ memberBadgeText: e.target.value === '' ? null : e.target.value })}
          />
        </label>
      </div>

      <footer className="rule__foot">
        <span>
          {rule.when.some((c) => c.fact === 'hero')
            ? 'Gælder varen på hovedpladsen på hver side'
            : caught.length === 0
            ? 'Rammer ingen af ugens varer — feedet har måske ikke oplysningen'
            : caught.length === offers.length && rule.when.length > 0
              ? `Rammer alle ${caught.length} varer — betingelsen skelner ikke`
              : `Rammer ${caught.length} ${caught.length === 1 ? 'vare' : 'varer'}`}
        </span>
        {caught.length > 0 && <RulePreview offers={caught.slice(0, 6)} />}
      </footer>
    </article>
  );
}

/** One step of a look, as a row of buttons — every value is visible, none has to be remembered. */
function Choice<T extends string>({
  label, hint, words, value, onPick,
}: { label: string; hint?: string; words: Record<T, string>; value: T; onPick: (value: T) => void }) {
  return (
    <div className="rule__choice" title={hint}>
      <span>{label}</span>
      <div className="seg">
        {(Object.keys(words) as T[]).map((key) => (
          <button key={key} className={key === value ? 'is-on' : ''} onClick={() => onPick(key)}>
            {words[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- preview */

/* Three rows of two: on a portrait sheet that is a cell about as wide as it is tall. */
const PREVIEW: PageTemplate = {
  id: 'rules/preview',
  name: 'Forhåndsvisning',
  areas: ['a b', 'c d', 'e f'],
  slots: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, role: 'standard' as const, bleed: 1 })),
};

/**
 * The offers a rule catches, on a small page of their own, drawn with
 * every rule the chain has — the real tile, so what is seen is printed.
 */
function RulePreview({ offers }: { offers: Offer[] }) {
  const brand = useStudio((s) => s.brand);
  const map = useMemo(() => new Map(offers.map((offer) => [offer.id, offer])), [offers]);
  if (!brand) return null;
  const page: CatalogPage = CatalogPageOf(offers);
  return (
    <div className="rule__preview" aria-hidden="true">
      <div className="rule__live">
        <ImageSize.Provider value={THUMB_PX}>
          <PageView page={page} template={PREVIEW} brand={{ ...brand, templates: [PREVIEW, ...brand.templates] }} offers={map} pageIndex={0} pageNumber={1} />
        </ImageSize.Provider>
      </div>
    </div>
  );
}

function CatalogPageOf(offers: Offer[]): CatalogPage {
  return {
    id: 'rules-preview', kind: 'offers', templateId: PREVIEW.id, title: '', subtitle: '',
    placements: offers.map((offer, index) => ({
      offerId: offer.id, slotId: PREVIEW.slots[index]!.id,
      overrides: {
        pinned: false, crowdOk: false, arrangement: null, displayName: null, description: null,
        imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, parts: {}, pack: {},
      },
    })),
    rationale: '', ground: null, decorations: [], notes: [], background: null, texts: {},
    incito: null, exact: false, design: { group: previewGroup(), zones: {} },
  };
}

/**
 * A rule to start from, made from one offer: what it is becomes the
 * condition — "har medlemspris", "sparer mindst 30 %" — so the rule
 * catches this product and the ones like it.
 */
export function ruleFromOffer(offer: Offer): OfferRule {
  const facts = offerFacts(offer);
  const pct = Math.floor((facts.savingsShare * 100) / 5) * 5;
  const [when, name]: [OfferRuleInput['when'], string] = facts.lifestyle
    ? [[{ fact: 'lifestyle' }], 'Varer med livsstilsbillede']
    : facts.member
      ? [[{ fact: 'member' }], 'Varer med medlemspris']
      : facts.multibuy
        ? [[{ fact: 'multibuy' }], 'Varer med mængderabat']
        : facts.campaign
          ? [[{ fact: 'campaign' }], offer.campaign || 'Kampagnevarer']
          : facts.savings && pct >= 10
            ? [[{ fact: 'savingsShare', atLeast: pct }], `Sparer mindst ${pct} %`]
            : facts.lead
              ? [[{ fact: 'lead' }], 'Hovedvarer']
              : facts.group
                ? [[{ fact: 'group' }], 'Samlede tilbud']
                : [[], 'Alle varer'];
  return OfferRule.parse({ id: newId(), name, when, then: {} });
}

/** How many of the week's products one condition catches, and a warning when that decides nothing. */
function Count({ offers, condition }: { offers: Offer[]; condition: RuleCondition }) {
  // Where an offer stands is only known on a page.
  if (condition.fact === 'hero') return <span className="rule__count" title="Afgøres på siden">side</span>;
  const n = offers.filter((offer) => meets(offerFacts(offer), condition)).length;
  const idle = n === 0 || n === offers.length;
  return (
    <span
      className={`rule__count${idle ? ' rule__count--idle' : ''}`}
      title={n === 0 ? 'Ingen af ugens varer — feedet har måske ikke oplysningen' : n === offers.length ? 'Alle ugens varer — betingelsen skelner ikke' : `${n} af ugens ${offers.length} varer`}
    >
      {n}
    </span>
  );
}

/**
 * The chain's design tags, each drawn with the same product in it — the
 * rule picks a tag, the tag's designs decide where everything stands.
 */
function DesignPicker({ designs, value, example, onPick }: {
  designs: OfferDesign[]; value: string | null; example: Offer | null; onPick: (tag: string | null) => void;
}) {
  const brand = useStudio((s) => s.brand);
  const tags = designTags(designs);
  return (
    <div className="layoutpick">
      <button className={`layoutpick__item${value === null ? ' is-on' : ''}`} onClick={() => onPick(null)} title="Reglen vælger ikke design — sidens design bruges">
        <span className="layoutpick__none">—</span>
        <small>Sidens</small>
      </button>
      {tags.map((tag) => {
        const design = designs.find((d) => d.tag === tag)!;
        return (
          <button key={tag} className={`layoutpick__item${value === tag ? ' is-on' : ''}`} onClick={() => onPick(tag)} title={tag}>
            <span className="layoutpick__cell layoutpick__cell--design" style={brand ? brandCssVars(brand) as React.CSSProperties : undefined}>
              {example && <DesignTile design={design} offer={example} aspect={1} />}
            </span>
            <small>{tag}</small>
          </button>
        );
      })}
    </div>
  );
}

/** The design group previews are drawn in: the open page's, else the chain's colours. */
function previewGroup(): string {
  const { document, openPageId } = useStudio.getState();
  return document?.pages.find((page) => page.id === openPageId)?.design?.group ?? 'standard';
}

/**
 * The variants, drawn — each with the same product in it, in a cell of
 * the size the page gives an ordinary offer. Picked by how it looks.
 */
function VariantPicker({ value, example, onPick }: { value: string; example: Offer | null; onPick: (variant: RuleLook['variant']) => void }) {
  return (
    <div className="layoutpick">
      <button className={`layoutpick__item${value === 'auto' ? ' is-on' : ''}`} onClick={() => onPick('auto')} title="Reglen vælger ikke variant — en regel længere nede, eller Normal">
        <span className="layoutpick__none">—</span>
        <small>Ingen</small>
      </button>
      {VARIANTS.map((variant) => (
        <button
          key={variant}
          className={`layoutpick__item${value === variant ? ' is-on' : ''}`}
          onClick={() => onPick(variant)}
          title={VARIANT_DESIGNS[variant].hint}
        >
          {example ? <MiniCell offer={example} variant={variant} /> : <span className="layoutpick__none" />}
          <small>{VARIANT_DESIGNS[variant].name}</small>
        </button>
      ))}
    </div>
  );
}

/** One offer in one variant: a small page with the offer in its top-left cell, cropped to that cell. */
function MiniCell({ offer, variant }: { offer: Offer; variant: RuleLook['variant'] }) {
  const brand = useStudio((s) => s.brand);
  const map = useMemo(() => new Map([[offer.id, offer]]), [offer]);
  if (!brand) return null;
  const alone: Brand = {
    ...brand,
    templates: [PREVIEW, ...brand.templates],
    offerRules: [OfferRule.parse({ id: 'preview', name: 'Forhåndsvisning', then: { variant } })],
  };
  return (
    <span className="layoutpick__cell" aria-hidden="true">
      <span className="layoutpick__live">
        <ImageSize.Provider value={THUMB_PX}>
          <PageView page={CatalogPageOf([offer])} template={PREVIEW} brand={alone} offers={map} pageIndex={0} pageNumber={1} />
        </ImageSize.Provider>
      </span>
    </span>
  );
}
