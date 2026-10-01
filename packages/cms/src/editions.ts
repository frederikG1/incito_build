/**
 * Several CMS publications that are one avis in several editions.
 *
 * Løvbjerg's week is nineteen publications: a national "Hovedavis" and
 * one per store. In the CMS they are copies, kept in step by hand; here
 * they are compared. The sections carry the same ids in every copy and
 * the offers the chain's own item number, so what one store does
 * differently can be read off exactly: a page it leaves out, a page only
 * it has, a section drawn with another design, its own local offers.
 *
 * The base is not one of them. It is what the editions have in common:
 * the section order most of them use, each section drawn the way most of
 * them draw it, holding the offers most of them carry there. Every
 * publication — the national one too — is then an edition of it, and a
 * store's edition is little more than its own local offers.
 */
import { OfferDesign } from '@incitio/schema';
import { offerKey, sectionDesigns, type CmsOffer, type CmsPublication } from './types.js';

export interface OfferChange { key: string; name: string; fields: string[] }

export interface EditionDelta {
  publicationId: string;
  name: string;
  stores: string[];
  tags: string[];
  /** Sections of the merged order this edition does not have. */
  without: string[];
  /** Sections this edition draws with another design than the base does. */
  redesigned: { section: string; from: string; to: string }[];
  /** Offers only this edition has, by the section they stand in. */
  local: { section: string; keys: string[] }[];
  /** Base offers this edition leaves out. */
  dropped: string[];
  /** Offers both have, with different words or prices. */
  changed: OfferChange[];
  /** Designs this edition's own copy has added or changed against the others' — drift. */
  drift: { added: string[]; changed: string[]; removed: string[] };
}

export interface EditionPlan {
  /** The common edition: majority order, designs and offers. Its offers are the editions' own rows. */
  base: CmsPublication;
  /** Every section of every edition, in one order. */
  order: string[];
  /** Section id → title and design, from the first edition that has it. */
  sections: Map<string, { title: string; design: string }>;
  editions: EditionDelta[];
  /** Changes every edition but a few makes alike — what the CMS's copies repeat by hand. */
  shared: { without: string[]; added: string[]; redesigned: string[] };
}

const COMPARED = ['name', 'description', 'price', 'preprice', 'savings', 'membership_price', 'legal_info',
  'custom_label_1', 'custom_label_2', 'custom_label_3', 'comment_label_1', 'comment_label_2', 'comment_label_3'] as const;

const sequence = (p: CmsPublication) => p.config.sections.map((s) => s.id);

/** Merge section orders: the base's first, each other section after the one it follows in its own edition. */
function mergeOrder(base: string[], others: string[][]): string[] {
  const order = [...base];
  for (const seq of others) {
    seq.forEach((id, i) => {
      if (order.includes(id)) return;
      const before = seq.slice(0, i).reverse().find((x) => order.includes(x));
      order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
    });
  }
  return order;
}

/** Design fingerprints by id, so two copies of the same list can be compared. */
function designPrints(p: CmsPublication): Map<string, { tag: string; print: string }> {
  const out = new Map<string, { tag: string; print: string }>();
  for (const d of p.designs as { id?: string; tag?: string }[]) {
    if (d?.id) out.set(d.id, { tag: String(d.tag ?? d.id), print: JSON.stringify(d) });
  }
  return out;
}

function modeBy<T>(items: T[], key: (item: T) => string): T {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...items].sort((a, b) => (counts.get(key(b)) ?? 0) - (counts.get(key(a)) ?? 0))[0]!;
}

export function planEditions(publications: CmsPublication[]): EditionPlan {
  if (publications.length === 0) throw new Error('no publications');
  const half = publications.length / 2;
  const model = modeBy(publications, (p) => sequence(p).join(','));
  const order = mergeOrder(sequence(model), publications.map(sequence));
  const sections = new Map<string, { title: string; design: string }>();
  for (const p of [model, ...publications]) {
    for (const s of p.config.sections) if (!sections.has(s.id)) sections.set(s.id, { title: s.title, design: s.design_tag });
  }

  // Per section: the design most editions draw it with, and the offers most of them carry there.
  const keysIn = (p: CmsPublication) => {
    const keyOf = new Map(p.offers.map((o) => [o.id, offerKey(o)]));
    return new Map(p.config.sections.map((s) => [s.id, s.offer_ids.map((id) => keyOf.get(id) ?? id)]));
  };
  const placed = new Map(publications.map((p) => [p, keysIn(p)]));
  const rows = new Map<string, CmsOffer>();
  for (const p of publications) for (const o of p.offers) if (!rows.has(offerKey(o))) rows.set(offerKey(o), o);
  // A config names offers by CMS row id or by item number, depending on the chain.
  const modelKeys = new Map(model.offers.map((o) => [o.id, offerKey(o)]));
  const baseSections = model.config.sections.map((section) => {
    const votes = new Map<string, number>();
    const designs = new Map<string, number>();
    for (const p of publications) {
      const s = p.config.sections.find((x) => x.id === section.id);
      if (!s) continue;
      designs.set(s.design_tag, (designs.get(s.design_tag) ?? 0) + 1);
      for (const key of placed.get(p)!.get(section.id) ?? []) votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    // In the model's order, then any majority offer it lacks.
    const majority = (key: string) => (votes.get(key) ?? 0) > half;
    const keys = [...(placed.get(model)!.get(section.id) ?? []).filter(majority), ...[...votes.keys()].filter((k) => majority(k) && !(placed.get(model)!.get(section.id) ?? []).includes(k))];
    const design = [...designs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? section.design_tag;
    return { ...section, design_tag: design, offer_ids: keys, a_offer_ids: section.a_offer_ids.map((id) => modelKeys.get(id) ?? id).filter((k) => keys.includes(k)) };
  });
  const baseKeys = new Set(baseSections.flatMap((s) => s.offer_ids));
  const base: CmsPublication = {
    meta: publications.length === 1 ? model.meta : { ...model.meta, id: `${model.meta.id}~base`, name: 'Fælles udgave', tags: ['Fælles'], target_group_ids: [] },
    config: { ...model.config, sections: baseSections },
    designs: model.designs,
    // Keyed rows: in the base an offer's id is its item number.
    offers: [...baseKeys].map((key) => ({ ...rows.get(key)!, id: key })),
  };

  // The design list most copies agree on, to tell a store's own edits from the chain's.
  const usual = modeBy(publications, (p) => JSON.stringify([...designPrints(p).values()].map((d) => d.print).sort()));
  const usualPrints = designPrints(usual);

  const baseDesign = new Map(baseSections.map((s) => [s.id, s.design_tag]));
  const baseIn = new Map(baseSections.map((s) => [s.id, new Set(s.offer_ids)]));

  const editions = publications.map((p): EditionDelta => {
    const own = new Set(sequence(p));
    const offers = new Map(p.offers.map((o) => [offerKey(o), o]));
    const local: EditionDelta['local'] = [];
    for (const [sectionId, keys] of placed.get(p)!) {
      const extra = keys.filter((k) => !baseKeys.has(k));
      if (extra.length) local.push({ section: sectionId, keys: extra });
    }
    const changed: OfferChange[] = [];
    for (const [key, offer] of offers) {
      const was = baseKeys.has(key) ? rows.get(key) : undefined;
      if (!was) continue;
      const fields = COMPARED.filter((f) => JSON.stringify((offer as CmsOffer)[f] ?? null) !== JSON.stringify((was as CmsOffer)[f] ?? null));
      if (fields.length) changed.push({ key, name: offer.name, fields });
    }
    const prints = designPrints(p);
    // Base offers this edition has nowhere, or only on a section the base does not hold them in.
    const dropped = [...baseKeys].filter((k) => {
      if (!offers.has(k)) return true;
      const sectionId = [...baseIn].find(([, set]) => set.has(k))![0];
      return !own.has(sectionId) || !(placed.get(p)!.get(sectionId) ?? []).includes(k);
    });
    return {
      publicationId: p.meta.id,
      name: p.meta.name,
      stores: p.meta.target_group_ids,
      tags: p.meta.tags,
      without: order.filter((id) => !own.has(id)),
      redesigned: p.config.sections
        .filter((s) => baseDesign.has(s.id) && baseDesign.get(s.id) !== s.design_tag)
        .map((s) => ({ section: s.id, from: baseDesign.get(s.id)!, to: s.design_tag })),
      local,
      dropped,
      changed,
      drift: {
        added: [...prints].filter(([id]) => !usualPrints.has(id)).map(([, d]) => d.tag),
        changed: [...prints].filter(([id, d]) => usualPrints.has(id) && usualPrints.get(id)!.print !== d.print).map(([, d]) => d.tag),
        removed: [...usualPrints].filter(([id]) => !prints.has(id)).map(([, d]) => d.tag),
      },
    };
  });

  // What all but at most one edition do alike: typically every store, the national paper excepted.
  const most = (count: number) => count >= Math.max(1, publications.length - 1);
  const tally = <T>(pick: (e: EditionDelta) => T[], key: (t: T) => string) => {
    const counts = new Map<string, number>();
    for (const e of editions) for (const k of new Set(pick(e).map(key))) counts.set(k, (counts.get(k) ?? 0) + 1);
    return [...counts].filter(([, n]) => most(n)).map(([k]) => k);
  };
  return {
    base,
    order,
    sections,
    editions,
    shared: {
      without: tally((e) => e.without, (x) => x),
      added: [],
      redesigned: tally((e) => e.redesigned, (r) => `${r.section}:${r.to}`),
    },
  };
}

/** The offer designs a publication ships, parsed; the rest of the list is section designs. */
export function offerDesignsOf(publication: CmsPublication): OfferDesign[] {
  const out: OfferDesign[] = [];
  for (const d of publication.designs) {
    if ((d as { type?: string })?.type !== 'offer') continue;
    const parsed = OfferDesign.safeParse(d);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export { sectionDesigns };
