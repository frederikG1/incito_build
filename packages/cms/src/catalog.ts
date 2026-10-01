/**
 * CMS publications in, one catalogue with its editions out.
 *
 * The base document is the editions' common edition (see `planEditions`)
 * with every page any edition has, in one order; each edition — the
 * national paper as much as a store — is the base minus the pages it
 * leaves out and the shared offers it does not carry, plus its own offers
 * on the pages they stand on — `removePage` and `add`, the same ops the
 * studio and the API speak, so a store's edition is edited, resolved and
 * checked the way every other variant is. What the ops cannot say (a
 * section drawn with another design in one store's copy) is listed, not
 * lost.
 *
 * Pages are laid out on offer grids shaped like the CMS's own offer
 * boxes and drawn with the chain's offer designs, tag by page. The
 * section designs' own pictures and headings are not redrawn here: the
 * page takes their backdrop picture and colour, and nothing else.
 */
import {
  CatalogDocument, OFFER_GRID_PREFIX, weekOf, offerGridTemplates, PageTemplate, PlacementOverrides,
  type CatalogPage, type EditOp, type Offer, type PublicationVariant,
} from '@incitio/schema';
import { normalizeRows } from '@incitio/ingest';
import { tjekTransformed } from '@incitio/brands';
import { planEditions, type EditionPlan } from './editions.js';
import { planSections, type SectionPlan } from './sections.js';
import { offerKey, type CmsPublication } from './types.js';

export interface CmsImport {
  document: CatalogDocument;
  plan: EditionPlan;
  /** Per edition: what the ops could not carry. */
  unrepresented: { edition: string; what: string }[];
  /** Rows the offer mapping dropped, with its reason. */
  dropped: { edition: string; offer: string; reason: string }[];
}

export interface CmsImportOptions {
  brandId: string;
  /** Document id and name; the base publication's name when absent. */
  id?: string;
  name?: string;
  now?: string;
}

/** The schema's offer grids name their cells a–p, so they stop at sixteen. */
const SCHEMA_GRID_MAX = 16;

/** An offer grid for `count` cells, lead or not; the schema's own up to sixteen, four abreast past that. */
function gridFor(count: number, lead: boolean): PageTemplate {
  const n = Math.max(1, count);
  const id = `${OFFER_GRID_PREFIX}${lead && n >= 3 ? 'lead' : 'grid'}-${n}`;
  const known = n <= SCHEMA_GRID_MAX ? offerGridTemplates(1, Math.max(8, n)).find((t) => t.id === id) : undefined;
  if (known) return PageTemplate.parse(known);
  const cells = Array.from({ length: n }, (_, i) => `c${i + 1}`);
  return PageTemplate.parse({
    id: `${OFFER_GRID_PREFIX}grid-${n}`,
    name: `Tilbudsgitter · ${n}`,
    // Four abreast; a short last row's final cell spans what is left.
    areas: Array.from({ length: Math.ceil(n / 4) }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => cells[Math.min(row * 4 + col, n - 1)]).join(' ')),
    slots: cells.map((c) => ({ id: c, role: 'standard', bleed: 1 })),
  });
}

/** CMS rows → offers keyed by the chain's item number, so one product has one id in every edition. */
function mapOffers(
  publication: CmsPublication, retailerId: string, dropped: CmsImport['dropped'],
  week: { from: string | null; until: string | null },
): Map<string, Offer> {
  // Most rows leave their dates to the publication: they run when it runs.
  const rows = publication.offers.map((o) => ({
    ...o,
    id: offerKey(o),
    valid_from: (o as Record<string, unknown>)['valid_from'] ?? publication.meta.valid_from ?? week.from,
    valid_until: (o as Record<string, unknown>)['valid_until'] ?? publication.meta.valid_until ?? week.until,
  }));
  const { feed, issues } = normalizeRows(rows, tjekTransformed(retailerId, publication.meta.name));
  for (const issue of issues) dropped.push({ edition: publication.meta.name, offer: issue.offerId ?? `rad ${issue.rowIndex + 1}`, reason: issue.reason });
  return new Map(feed.offers.map((o) => [o.id, o as Offer]));
}

/** A heading only when the section has one in words — Løvbjerg's are page numbers. */
const heading = (title: string) => (/[a-zæøå]{3,}/i.test(title) ? title : '');

type Sheet = { view: Record<string, unknown>; fonts: Record<string, string> };

/** The preview's sheet: its root is the 600×1000 box, drawn scaled to fit the editor — the scale is dropped. */
function sheetOf(view: Record<string, unknown>): Record<string, unknown> {
  const { transform_scale: _scale, transform_origin: _origin, ...sheet } = view;
  return sheet;
}

function pagesOf(
  plan: SectionPlan, offers: Map<string, Offer>, templates: Map<string, PageTemplate>,
  sheets: (index: number) => Sheet | undefined, static_: boolean,
): CatalogPage[] {
  return plan.pages.map((planned, index) => {
    const sheet = sheets(index);
    const keys = planned.offers.filter((k) => offers.has(k));
    const lead = !planned.overflow && plan.aOffers.some((k) => keys.includes(k));
    const ordered = lead ? [...plan.aOffers.filter((k) => keys.includes(k)), ...keys.filter((k) => !plan.aOffers.includes(k))] : keys;
    const template = gridFor(ordered.length, lead);
    templates.set(template.id, template);
    return {
      id: index === 0 ? plan.id : `${plan.id}~${index + 1}`,
      kind: 'offers',
      templateId: template.id,
      title: index === 0 ? heading(plan.title) : '',
      subtitle: '',
      placements: ordered.map((offerId, i) => ({ offerId, slotId: template.slots[i]!.id, overrides: PlacementOverrides.parse({}) })),
      rationale: `CMS: ${planned.design}${planned.overflow ? ' (overflow)' : ''}${plan.cohort ? ` · ${plan.cohort}` : ''}`,
      ground: plan.ground,
      decorations: [],
      notes: [],
      background: plan.background ? { imageUrl: plan.background.url, subject: planned.design, fit: plan.background.fit, opacity: 1 } : null,
      texts: {},
      /*
       * The CMS's own drawing of the section, when it was captured: printed
       * as is on a page no edition puts offers on (a cover, a referral, a
       * banner), kept beside the grid on the others.
       */
      incito: sheet ? { view: sheetOf(sheet.view), width: 600, height: 1000, fonts: sheet.fonts } : null,
      exact: Boolean(sheet) && static_,
      ...(plan.offerTag ? { design: { group: 'standard', tag: plan.offerTag, zones: {} } } : {}),
    } as CatalogPage;
  });
}

const slug = (name: string) => name.toLowerCase().replace(/\s*uge\s*\d+\s*$/i, '')
  .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'udgave';

export function importCms(publications: CmsPublication[], options: CmsImportOptions): CmsImport {
  const plan = planEditions(publications);
  const dropped: CmsImport['dropped'] = [];
  const unrepresented: CmsImport['unrepresented'] = [];
  const byId = new Map(publications.map((p) => [p.meta.id, p]));

  // A publication without dates of its own runs when most of the week's do.
  const commonest = (pick: (p: CmsPublication) => string | null | undefined) => {
    const counts = new Map<string, number>();
    for (const p of publications) { const v = pick(p); if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const week = { from: commonest((p) => p.meta.valid_from), until: commonest((p) => p.meta.valid_until) };
  const baseOffers = mapOffers(plan.base, options.brandId, dropped, week);
  const templates = new Map<string, PageTemplate>();
  // Each section from the base when it has it, else from the first edition that does.
  const owner = (sectionId: string) =>
    [plan.base, ...publications].find((p) => p.config.sections.some((s) => s.id === sectionId))!;
  const plans = new Map<CmsPublication, SectionPlan[]>();
  const planOf = (p: CmsPublication) => plans.get(p) ?? plans.set(p, planSections(p)).get(p)!;
  // A section's captured drawing, from any edition that has one: the section is the same in each.
  const sheetsFor = (sectionId: string) => (index: number): Sheet | undefined => {
    for (const p of [owner(sectionId), ...publications]) {
      const pages = (p.renders ?? []).filter((r) => r.section_id === sectionId).sort((a, b) => a.page_number - b.page_number);
      if (pages[index]) return { view: pages[index]!.view, fonts: p.fonts ?? {} };
    }
    return undefined;
  };
  const empty = (sectionId: string) => publications.every((p) => (p.config.sections.find((s) => s.id === sectionId)?.offer_ids.length ?? 0) === 0);
  const pages = plan.order.flatMap((sectionId) => {
    const section = planOf(owner(sectionId)).find((s) => s.id === sectionId)!;
    return pagesOf(section, baseOffers, templates, sheetsFor(sectionId), empty(sectionId));
  });
  // Every grid a page can grow into as an edition adds its offers: up to the fullest section anywhere.
  const fullest = Math.max(8, ...publications.flatMap((p) => p.config.sections.map((s) => s.offer_ids.length)));
  for (let n = 1; n <= fullest; n += 1) {
    const grid = gridFor(n, false);
    if (!templates.has(grid.id)) templates.set(grid.id, grid);
  }
  const pageIds = (sectionId: string) => pages.filter((p) => p.id === sectionId || p.id.startsWith(`${sectionId}~`)).map((p) => p.id);

  const taken = new Set<string>();
  const variants: PublicationVariant[] = [];
  // One publication is the avis itself, not an edition of it.
  for (const edition of publications.length > 1 ? plan.editions : []) {
    const publication = byId.get(edition.publicationId)!;
    const own = mapOffers(publication, options.brandId, dropped, week);
    const ops: EditOp[] = [];
    for (const section of edition.without) for (const pageId of pageIds(section)) ops.push({ op: 'removePage', pageId });
    for (const key of edition.dropped) ops.push({ op: 'remove', offerId: key });
    for (const { section, keys } of edition.local) {
      for (const key of keys) if (own.has(key)) ops.push({ op: 'add', offerId: key, pageId: section });
    }
    for (const change of edition.changed) {
      const offer = own.get(change.key);
      if (!offer) continue;
      if (change.fields.some((f) => f === 'price' || f === 'preprice')) ops.push({ op: 'price', offerId: change.key, price: offer.price, prePrice: offer.prePrice });
      if (change.fields.includes('name')) ops.push({ op: 'text', offerId: change.key, part: 'name', text: offer.name });
      if (change.fields.includes('description')) ops.push({ op: 'text', offerId: change.key, part: 'description', text: offer.description });
      const rest = change.fields.filter((f) => !['price', 'preprice', 'name', 'description'].includes(f));
      if (rest.length) unrepresented.push({ edition: edition.name, what: `${change.name}: ${rest.join(', ')}` });
    }
    for (const r of edition.redesigned) unrepresented.push({ edition: edition.name, what: `sektion ${plan.sections.get(r.section)?.title || r.section}: tegnet med «${r.to}» i stedet for «${r.from}»` });
    for (const tag of edition.drift.changed) unrepresented.push({ edition: edition.name, what: `egen ændring af designet «${tag}»` });
    for (const tag of edition.drift.added) unrepresented.push({ edition: edition.name, what: `eget nyt design «${tag}»` });

    // "Fredericia Uge 17" is Fredericia; "Uge 17" alone is the national paper, by its tag.
    const name = edition.name.replace(/\s*uge\s*\d+\s*$/i, '') || edition.tags[0] || 'Hovedavis';
    let id = slug(name);
    for (let n = 2; taken.has(id); n += 1) id = `${slug(name)}-${n}`;
    taken.add(id);
    const localKeys = new Set(edition.local.flatMap((l) => l.keys));
    variants.push({
      id,
      name,
      stores: edition.stores,
      offers: [...own.values()].filter((o) => localKeys.has(o.id)),
      ops,
    });
  }

  const now = options.now ?? new Date().toISOString();
  const document = CatalogDocument.parse({
    id: options.id ?? `cms-${plan.base.meta.id}`,
    schemaVersion: 2,
    name: options.name ?? (publications.length === 1 ? publications[0]!.meta.name : plan.base.meta.name),
    brandId: options.brandId,
    // The week the middle of the run falls in: Løvbjerg's "uge 17" runs Friday 17 to Thursday 23 April.
    week: week.from && week.until ? weekOf(new Date((Date.parse(week.from) + Date.parse(week.until)) / 2)) : null,
    pages,
    offers: [...baseOffers.values()],
    templates: [...templates.values()],
    variants,
    createdAt: now,
    updatedAt: now,
  });
  return { document, plan, unrepresented, dropped };
}
