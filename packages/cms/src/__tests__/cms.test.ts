import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Brand, offerGridTemplates } from '@incitio/schema';
import { resolveVariant } from '@incitio/edit';
import { importCms, offerKey, planEditions, planSections, readCmsPublication, type CmsPublication } from '../index.js';

/*
 * Captured from Tjek's CMS (staging), trimmed: Wolt Market's uge 16 —
 * one national publication built from feed categories — and Løvbjerg's
 * uge 17: the national "Hovedavis" and three of its eighteen store
 * copies (Fredericia, Brønderslev, Frederikshavn).
 */
const load = (file: string): CmsPublication[] =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as { publications: never[] })
    .publications.map((p) => readCmsPublication(p));
const WOLT = load('wolt-uge16.json');
const LOEVBJERG = load('loevbjerg-uge17.json');
const byName = (name: string) => LOEVBJERG.find((p) => p.meta.name === name)!;

describe('sections into pages', () => {
  const sections = planSections(WOLT[0]!);
  const named = (title: string) => sections.find((s) => s.title === title)!;

  it('reads a section design\'s offer boxes and what they hold', () => {
    expect(named('Økologi').boxes.map((b) => [b.tag, b.max])).toEqual([['Design 1', 5]]);
    expect(named('Økologi').capacity).toBe(5);
    expect(named('Ugens skarpe').capacity).toBe(Infinity);
  });

  it('spills what the main design cannot hold onto the overflow design', () => {
    expect(named('Økologi').pages.map((p) => [p.design, p.offers.length])).toEqual([
      ['Primary - Main', 5], ['Primary - Overflow', 2],
    ]);
    expect(named('Kød & fisk').pages).toHaveLength(1);
  });

  it('keeps the cohort a section is filled from', () => {
    expect(named('Økologi').cohort).toBe('Økologi');
  });

  it('takes the offer panel\'s colour as the ground the offers stand on', () => {
    expect(named('Økologi').ground).toBe('#f6f0e9');
  });
});

describe('store copies as editions', () => {
  const plan = planEditions(LOEVBJERG);
  const edition = (name: string) => plan.editions.find((e) => e.name === name)!;
  const design = (id: string) => plan.sections.get(id)?.design;

  it('builds the base from what most copies share, not from any one of them', () => {
    expect(plan.base.meta.name).toBe('Fælles udgave');
    // Nobody's local offers are in it: the JA TAK section is empty.
    const jaTak = plan.base.config.sections.find((s) => s.design_tag.startsWith('JA TAK'))!;
    expect(jaTak.offer_ids).toEqual([]);
  });

  it('reads a store\'s edition as the base without the national page, plus its own offers', () => {
    const b = edition('Brønderslev Uge 17');
    expect(b.without.map(design)).toEqual(['Lokale sider']);
    expect(b.local.flatMap((l) => l.keys)).toHaveLength(21);
    expect(b.dropped).toEqual([]);
  });

  it('reads the national paper as an edition too: no store pages', () => {
    const national = edition('Uge 17');
    expect(national.without.map(design)).toEqual(expect.arrayContaining(['JA-TAK henvisning']));
    expect(national.local).toEqual([]);
  });
});

describe('one catalogue with its editions', () => {
  const imported = importCms(LOEVBJERG, { brandId: 'loevbjerg', now: '2026-10-01T00:00:00.000Z' });
  const brand = Brand.parse({
    id: 'loevbjerg', name: 'Løvbjerg',
    tokens: { brand: '#bd0e47', accent: '#fae200', ground: '#fae200', ink: '#000000', priceInk: '#ffffff', headingFont: 'x', bodyFont: 'x' },
    templates: offerGridTemplates(1, 8),
  });

  it('makes every copy an edition: removePage and add, nothing forked', () => {
    const variants = imported.document.variants!;
    expect(variants.map((v) => v.name).sort()).toEqual(['Brønderslev', 'Fredericia', 'Frederikshavn', 'Hovedavis']);
    const b = variants.find((v) => v.name === 'Brønderslev')!;
    expect(b.offers).toHaveLength(21);
    expect(new Set(b.ops.map((o) => o.op))).toEqual(new Set(['removePage', 'add']));
  });

  it.each(['Fredericia Uge 17', 'Brønderslev Uge 17', 'Frederikshavn Uge 17', 'Uge 17'])(
    'gives back %s exactly: its pages and the offers on each',
    (name) => {
      const publication = byName(name);
      const variant = imported.document.variants!.find((v) => v.stores.join() === publication.meta.target_group_ids.join())!;
      const { document, conflicts } = resolveVariant(imported.document, variant.id, brand);
      expect(conflicts).toEqual([]);
      const importable = new Set([...imported.document.offers, ...variant.offers].map((o) => o.id));
      const keyOf = new Map(publication.offers.map((o) => [o.id, offerKey(o)]));
      for (const section of publication.config.sections) {
        const want = section.offer_ids.map((id) => keyOf.get(id) ?? id).filter((k) => importable.has(k)).sort();
        const got = document.pages.filter((p) => p.id === section.id || p.id.startsWith(`${section.id}~`))
          .flatMap((p) => p.placements.map((x) => x.offerId)).sort();
        expect(got, section.design_tag).toEqual(want);
      }
      expect(document.pages.every((p) => publication.config.sections.some((s) => p.id.split('~')[0] === s.id))).toBe(true);
    },
  );

  it('puts a section\'s A offer in the lead slot', () => {
    const page = imported.document.pages.find((p) => p.rationale.includes('1prio+3+3'))!;
    expect(page.templateId).toMatch(/lead-/);
    expect(page.placements[0]!.slotId).toBe('hero');
  });

  it('names what it could not import instead of dropping it silently', () => {
    // Percentage deals ("Spar 25% på …") have no price, and an Offer needs one.
    expect(imported.dropped.length).toBeGreaterThan(0);
    expect(imported.dropped.every((d) => d.reason === 'unparseable price')).toBe(true);
  });
});
