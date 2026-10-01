/**
 * What a chain's CMS publications are made of, and what they become here.
 *
 *   npm run cms -- data/cms/loevbjerg-uge16-17-cms.json
 *   npm run cms -- data/cms/wolt-uge16-cms.json --out .data/out/wolt.json
 *   npm run cms -- data/cms/loevbjerg-uge16-17-cms.json --save   # into the studio's database
 *
 * Reads a capture of the CMS editor's own answers (publication, incito
 * config, design templates, offers — one publication, or a chain's week
 * of store copies) and reports, per week:
 *
 *   - the sections: design, offer boxes, capacity, overflow pages, cohort
 *   - the designs: how many there are, how many the week uses
 *   - the editions: one base and what each store does differently,
 *     the changes every store makes alike, and designs a store's copy
 *     has edited on its own (drift)
 *   - the import: one CatalogDocument with the editions as variants, and
 *     proof that resolving each variant gives back exactly that store's
 *     pages and offers
 *
 * No network, no model.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Brand, offerGridTemplates } from '@incitio/schema';
import { resolveVariant } from '@incitio/edit';
import { fileURLToPath } from 'node:url';
import { Store } from '@incitio/server/db';
import { findBrand } from '@incitio/brands';
import { importCms, offerDesignsOf, offerKey, planSections, readCmsPublication, sectionDesigns, type CmsPublication } from '@incitio/cms';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) {
  console.error('brug: npm run cms -- <capture.json> [--out document.json] [--brand id]');
  process.exit(1);
}

type Raw = Record<string, any>;
const raw = JSON.parse(readFileSync(file, 'utf8')) as Raw;

/** A capture holds one publication, or a chain's publications with their design lists stored once. */
function publicationsOf(capture: Raw): CmsPublication[] {
  if (capture.pubs) {
    return Object.entries<Raw>(capture.pubs).map(([id, p]) => readCmsPublication({
      ...p, designs: capture.designs?.[p.designs] ?? [],
      renders: capture.renders?.[id]?.sections, preview: capture.renders?.[id]?.preview,
    }));
  }
  return [readCmsPublication({ ...capture, renders: capture.sections } as Parameters<typeof readCmsPublication>[0])];
}

const weekOfName = (p: CmsPublication) => /uge\s*(\d+)/i.exec(p.meta.name)?.[1] ?? '?';
const groups = new Map<string, CmsPublication[]>();
for (const p of publicationsOf(raw)) groups.set(weekOfName(p), [...(groups.get(weekOfName(p)) ?? []), p]);

const brandId = flag('brand') ?? (/loevbjerg|l.vbjerg/i.test(file) ? 'loevbjerg' : /wolt/i.test(file) ? 'wolt' : 'cms');
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const inf = (n: number) => (Number.isFinite(n) ? String(n) : '∞');

for (const [week, publications] of [...groups].sort()) {
  console.log(`\n══ uge ${week} · ${publications.length} ${publications.length === 1 ? 'publikation' : 'publikationer'}`);
  const imported = importCms(publications, { brandId, name: `${findBrand(brandId)?.brand.name ?? brandId} uge ${week}` });
  const { plan, document } = imported;
  const base = plan.base;

  // Sections.
  const sections = planSections(base);
  const offerDesigns = offerDesignsOf(base);
  const sectionTags = new Set(sectionDesigns(base.designs).map((d) => d.tag));
  const usedSections = new Set(base.config.sections.flatMap((s) => [s.design_tag, s.secondary_design_tag ?? '']).filter(Boolean));
  const usedOffers = new Set(sections.flatMap((s) => s.boxes.map((b) => b.tag)));
  const head = publications.find((p) => p.meta.tags.includes('Hovedavis')) ?? publications[0]!;
  console.log(`\n${publications.length > 1 ? 'fælles udgave' : base.meta.name} · ${sections.length} sektioner · ${base.offers.length} tilbud`);
  console.log(`designs: ${sectionTags.size} sektionsdesigns (${[...usedSections].filter((t) => sectionTags.has(t)).length} brugt), ${offerDesigns.length} tilbudsdesigns (${new Set(offerDesigns.map((d) => d.tag)).size} tags, ${[...usedOffers].length} brugt)`);
  const locked = head.offers.filter((o) => (o.col_locks ?? []).length > 0);
  if (locked.length) {
    const fields: Record<string, number> = {};
    for (const o of locked) for (const f of o.col_locks ?? []) fields[f] = (fields[f] ?? 0) + 1;
    console.log(`håndrettet (${head.meta.name}): ${locked.length} af ${head.offers.length} tilbud har låste felter — ${Object.entries(fields).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  }
  console.log('');
  for (const s of sections) {
    const boxes = s.boxes.length ? s.boxes.map((b) => `${b.tag}×${b.max ?? '∞'}`).join(' + ') : '—';
    const pages = s.pages.length > 1 ? ` → ${s.pages.length} sider (${s.pages.map((p) => p.offers.length).join('+')})` : '';
    const label = s.cohort && s.cohort !== s.title ? `${s.title} [${s.cohort}]` : s.title;
    console.log(`  ${pad(label.slice(0, 26), 27)}${pad(s.design.slice(0, 30), 31)}${pad(`${s.offers.length}/${inf(s.capacity)}`, 6)}${boxes.length > 70 ? `${boxes.slice(0, 68)}…` : boxes}${pages}${s.missing ? '  ⚠ designet findes ikke' : ''}${s.alternatives > 1 ? `  (${s.alternatives} på skift)` : ''}`);
  }

  // Editions.
  if (plan.editions.length > 1) {
    const title = (id: string) => plan.sections.get(id)?.design ?? id;
    console.log(`\nudgaver: ${plan.editions.length} · basen er det de har til fælles: flertallets sider, designs og tilbud (${base.offers.length} tilbud)`);
    if (plan.shared.without.length || plan.shared.added.length || plan.shared.redesigned.length) {
      console.log(`  ens i alle andre udgaver: ${[
        ...plan.shared.without.map((id) => `uden «${title(id)}»`),
        ...plan.shared.added.map((id) => `med «${title(id)}»`),
        ...plan.shared.redesigned.map((r) => `«${r.split(':')[1]}»`),
      ].join(', ')}`);
    }
    for (const e of plan.editions) {
      const local = e.local.reduce((n, l) => n + l.keys.length, 0);
      const parts = [
        e.without.length ? `uden ${e.without.map(title).join(', ')}` : '',
        local ? `${local} egne tilbud` : '',
        e.dropped.length ? `${e.dropped.length} tilbud færre` : '',
        e.changed.length ? `${e.changed.length} tilbud rettet` : '',
        e.redesigned.length ? `${e.redesigned.length} sektion(er) med andet design` : '',
        e.drift.changed.length || e.drift.added.length ? `⚠ egne designændringer: ${[...e.drift.changed, ...e.drift.added].join(', ')}` : '',
      ].filter(Boolean);
      console.log(`  ${pad(e.name.slice(0, 34), 35)}${parts.join(' · ')}`);
    }
  }

  // The import, and the proof.
  const brand = Brand.parse({
    id: brandId, name: brandId,
    tokens: { brand: '#c8102e', accent: '#ffd400', ground: '#ffffff', ink: '#1d1d1b', priceInk: '#1d1d1b', headingFont: 'system-ui', bodyFont: 'system-ui' },
    templates: [...document.templates, ...offerGridTemplates(1, 8)],
    offerDesigns,
  });
  const opsTotal = (document.variants ?? []).reduce((n, v) => n + v.ops.length, 0);
  console.log(`\nimport: 1 dokument · ${document.pages.length} sider · ${document.offers.length} tilbud · ${(document.variants ?? []).length} udgaver med i alt ${opsTotal} ops`);
  let exact = 0;
  for (const variant of document.variants ?? []) {
    const publication = publications.find((p) => (p.meta.name.replace(/\s*uge\s*\d+\s*$/i, '') || p.meta.tags[0] || 'Hovedavis') === variant.name)!;
    const resolved = resolveVariant(document, variant.id, brand);
    const keyOf = new Map(publication.offers.map((o) => [o.id, offerKey(o)]));
    // Offers the mapping could not take (reported below) are not expected on the pages.
    const importable = new Set([...document.offers, ...variant.offers].map((o) => o.id));
    const want = publication.config.sections.map((s) => `${s.id}:${s.offer_ids.map((id) => keyOf.get(id) ?? id).filter((k) => importable.has(k)).sort().join(',')}`).join('|');
    const got = publication.config.sections.map((s) => {
      const on = resolved.document.pages.filter((p) => p.id === s.id || p.id.startsWith(`${s.id}~`)).flatMap((p) => p.placements.map((x) => x.offerId));
      return `${s.id}:${on.sort().join(',')}`;
    }).join('|');
    const pagesOk = resolved.document.pages.every((p) => publication.config.sections.some((s) => p.id === s.id || p.id.startsWith(`${s.id}~`)));
    const ok = want === got && pagesOk && resolved.conflicts.length === 0;
    if (ok) exact += 1;
    else {
      const w = want.split('|'), g = got.split('|');
      const at = w.findIndex((x, i) => x !== g[i]);
      const why = resolved.conflicts.slice(0, 2).join('; ') || (pagesOk ? `sektion ${at + 1}: ventede ${w[at]?.split(':')[1]?.split(',').length ?? 0}, fik ${g[at]?.split(':')[1]?.split(',').filter(Boolean).length ?? 0}` : `sider afviger: ${resolved.document.pages.filter((p) => !publication.config.sections.some((s) => p.id === s.id || p.id.startsWith(`${s.id}~`))).map((p) => p.id).join(', ')}`);
      console.log(`  ✗ ${variant.name}: ${why}`);
    }
  }
  if (document.variants?.length) console.log(`  ${exact}/${document.variants.length} udgaver genskabt præcist (sider og tilbud pr. sektion) fra basen + deres ops`);
  const notes = imported.unrepresented.length;
  if (notes) {
    console.log(`  kan ikke udtrykkes som ops (${notes}):`);
    for (const n of imported.unrepresented.slice(0, 8)) console.log(`    ${n.edition}: ${n.what}`);
    if (notes > 8) console.log(`    … og ${notes - 8} mere`);
  }
  if (imported.dropped.length) {
    const products = new Set(imported.dropped.map((d) => d.offer));
    console.log(`  ${products.size} varer kunne ikke blive tilbud (${[...new Set(imported.dropped.map((d) => d.reason))].join('; ')}): ${[...products].slice(0, 4).map((k) => publications.flatMap((p) => p.offers).find((o) => offerKey(o) === k)?.name ?? k).join(', ')}${products.size > 4 ? ' …' : ''}`);
  }

  if (args.includes('--save')) {
    // The studio's own store, so the avis opens there with its editions under «Udgave».
    const store = new Store(process.env['INCITIO_DB'] ?? fileURLToPath(new URL('../.data/incitio.db', import.meta.url)));
    const saved = store.save(brandId, { ...document, id: `${brandId}-cms-uge${week}` }, 'Importeret fra Tjek CMS');
    console.log(`  gemt i studiet: ${saved.name} (${saved.id})`);
  }

  const out = flag('out');
  if (out) {
    const path = groups.size > 1 ? out.replace(/\.json$/, `-uge${week}.json`) : out;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(document, null, 1));
    console.log(`  skrevet: ${path}`);
  }
}
