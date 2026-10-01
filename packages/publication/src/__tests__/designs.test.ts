import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDesignExport } from '@incitio/schema';
import { matchDesigns, readTiles, rebuildDesigns } from '../designs.js';

/*
 * Five offer tiles from SuperBrugsen uge 40 as the Tjek CMS rendered
 * them (staging, section design "Stærk pris" → offer tag "Rød, sort,
 * hvid"), image URLs stubbed. Measured against the CMS's own designs
 * for the same chain, `data/designs/superbrugsen-cms.json`.
 */
const TILES = JSON.parse(readFileSync(new URL('./fixtures/sb-uge40-tiles.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const TRUTH = readDesignExport(readFileSync(new URL('../../../../data/designs/superbrugsen-cms.json', import.meta.url), 'utf8')).designs;

const root = (ids: string[]) => ({ child_views: TILES.filter((t) => ids.includes(String(t['id']))) });
const SAME = ['1093377', '1093379', '1093384', '1093464'];

describe('offer designs read back from a published incito', () => {
  it('names each layer by what it carries', () => {
    const kinds = readTiles(root(SAME)).map((t) => t.layers.map((l) => l.kind).join(' '));
    expect(kinds).toEqual([
      'image logos price label text',
      'image logos price text',
      'image price text',
      'image text price',
    ]);
  });

  it('reads 29,95 set with superscript øre as a price, not a label', () => {
    const [libero] = readTiles(root(['1093377']));
    expect(libero!.layers.find((l) => l.texts.some((t) => t.text === '10995'))?.kind).toBe('price');
  });

  it('folds tiles of one design into one, whatever the cell shape', () => {
    expect(rebuildDesigns(readTiles(root(SAME)))).toHaveLength(1);
  });

  it('gets the CMS design back, boxes and all', () => {
    const [match] = matchDesigns(rebuildDesigns(readTiles(root(SAME))), TRUTH);
    // The A and B variants of "Rød, sort, hvid" are the same layout, so both win.
    expect(match!.best.map((b) => b.id).sort()).toEqual(['8S2NkyIP', 'Yw2qxECW']);
    const iou = Object.fromEntries(match!.layers.map((l) => [l.kind, l.iou]));
    expect(iou['image']).toBeGreaterThan(0.99);
    expect(iou['text']).toBeGreaterThan(0.99);
    expect(iou['logos']).toBeGreaterThan(0.98);
    // The splash is scaled to fit: a wide cell shows its height, a narrow one its width.
    expect(iou['price']).toBeGreaterThan(0.98);
    // One label tile shows only part of its box.
    expect(iou['label']).toBeGreaterThan(0.7);
    expect(match!.unseen).toEqual(['offer_savings', 'offer_bg_image']);
  });

  /*
   * Whole weeks, every page the CMS preview rendered. The section design
   * on both ("Stærk pris") places offers with tag "Rød, sort, hvid".
   */
  it.each([
    ['sb-uge39-incito.json', 171, 171, 0.99],
    ['sb-uge40-incito.json', 145, 143, 0.98],
  ])('%s: tiles come back as the CMS design', (file, total, matched, floor) => {
    const week = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as {
      sectionDesigns: { layers: { offers_tag?: string }[] }[];
      sections: { view: Record<string, unknown> }[];
    };
    expect(week.sectionDesigns.flatMap((d) => d.layers.map((l) => l.offers_tag).filter(Boolean))).toEqual(['Rød, sort, hvid']);
    const tiles = readTiles({ child_views: week.sections.map((s) => s.view) });
    expect(tiles).toHaveLength(total);
    const matches = matchDesigns(rebuildDesigns(tiles), TRUTH);
    const hit = matches.filter((m) => m.score >= floor && m.best.every((b) => b.tag === 'Rød, sort, hvid'));
    expect(hit.reduce((n, m) => n + m.tiles, 0)).toBe(matched);
  });

  it('says so when no CMS design fits', () => {
    const [odd] = matchDesigns(rebuildDesigns(readTiles(root(['1093504']))), TRUTH);
    expect(odd!.score).toBeLessThan(0.6);
  });
});
