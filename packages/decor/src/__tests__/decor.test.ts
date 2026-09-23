import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Offer, CatalogPage } from '@incitio/schema';
import { imagePrompt, normaliseStyle, STYLE_LIMIT } from '../prompt.js';
import { decorStore } from '../store.js';
import { reconcile, type PageBrief, type SubjectRow } from '../subject.js';

const offer = (id: string, name: string): Offer => Offer.parse({
  id,
  name,
  price: 10,
  quantity: { size: 1, unit: 'pcs' },
  validFrom: '2026-09-11',
  validTo: '2026-09-17',
});

const brief = (pageId: string, offers: Offer[]): PageBrief => ({ pageId, title: 'Snacks', offers });

const row = (over: Partial<SubjectRow> = {}): SubjectRow => ({
  pageId: 'p1', draw: true, offerId: 'a', subject: 'mandler', motif: 'a handful of almonds', ...over,
});

describe('imagePrompt', () => {
  /*
   * These are not style preferences, they are the contract the cut-out
   * step depends on: it flood-fills from the border, so an image without
   * a white field it can reach is an image it cannot key out. A reworded
   * prompt that drops the background instruction would still generate
   * fine artwork and quietly break the step after it.
   */
  it('always demands the white field the cut-out keys out', () => {
    const prompt = imagePrompt('a handful of almonds');
    expect(prompt).toMatch(/pure white background/i);
    expect(prompt).toMatch(/nothing touches or crosses the border/i);
  });

  it('forbids the things that make a motif unusable as decoration', () => {
    const prompt = imagePrompt('a handful of almonds');
    for (const banned of ['No text', 'no packaging', 'no people']) {
      expect(prompt).toContain(banned);
    }
  });

  it('carries the motif and the chain', () => {
    const prompt = imagePrompt('a sprig of rosemary', { brandName: 'SuperBrugsen' });
    expect(prompt).toContain('a sprig of rosemary');
    expect(prompt).toContain('SuperBrugsen');
  });

  it('does not double the motif full stop', () => {
    expect(imagePrompt('a halved orange.')).not.toContain('orange..');
  });
});

describe("the editor's own direction", () => {
  it('reaches the prompt verbatim, on top of the craft that is always there', () => {
    const prompt = imagePrompt('a sprig of rosemary', { style: 'akvarel, dæmpede farver' });
    expect(prompt).toContain('akvarel, dæmpede farver.');
    // Added to the automatic wording, never instead of it — that is the
    // whole point of the field, and the thing a refactor could quietly
    // undo by making it a replacement.
    expect(prompt).toContain('Editorial food photography');
    expect(prompt).toContain('a sprig of rosemary');
  });

  /*
   * Order is load-bearing, not cosmetic. The contract is what the
   * cut-out step flood-fills against, so a direction like "on a dark
   * wooden table" must be argued with AFTER it is stated, not before —
   * otherwise the last thing the model reads is the thing that breaks
   * the step.
   */
  it('is stated before the contract, so the contract has the last word', () => {
    const prompt = imagePrompt('a halved orange', { style: 'mørk træbordplade' });
    expect(prompt.indexOf('mørk træbordplade'))
      .toBeLessThan(prompt.indexOf('pure white background'));
  });

  it('is capped, so a pasted essay cannot drown the contract out', () => {
    const prompt = imagePrompt('almonds', { style: 'x'.repeat(STYLE_LIMIT + 200) });
    expect(prompt).toContain('pure white background');
    expect(prompt).not.toContain('x'.repeat(STYLE_LIMIT + 1));
  });

  it('changes nothing when empty or blank', () => {
    const plain = imagePrompt('almonds');
    expect(imagePrompt('almonds', { style: '' })).toBe(plain);
    expect(imagePrompt('almonds', { style: '   ' })).toBe(plain);
  });

  it('ends the direction with a full stop, without doubling one', () => {
    expect(normaliseStyle('akvarel')).toBe('akvarel.');
    expect(normaliseStyle('akvarel.')).toBe('akvarel.');
    expect(normaliseStyle('hvorfor ikke?')).toBe('hvorfor ikke?');
  });

  /*
   * The cache is keyed on the prompt, so this falls out for free — but
   * it is the property people rely on without knowing it: reword the
   * direction, get a new drawing rather than yesterday's under a new
   * instruction.
   */
  it('makes a reworded direction a different drawing', () => {
    expect(imagePrompt('almonds', { style: 'akvarel' }))
      .not.toBe(imagePrompt('almonds', { style: 'blyantstegning' }));
  });
});

describe('decorStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decor-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const store = decorStore(dir);

  it('addresses artwork by the prompt, so a rebuild costs nothing', () => {
    const a = store.pathFor(imagePrompt('a handful of almonds'));
    const b = store.pathFor(imagePrompt('a handful of almonds'));
    expect(a.key).toBe(b.key);
  });

  /*
   * The whole reason the key is the PROMPT and not the subject: a change
   * to the craft wording is a change to the artwork, and a cache that
   * could not see it would serve the old drawing forever.
   */
  it('a reworded prompt is a different drawing', () => {
    const plain = store.pathFor(imagePrompt('a handful of almonds'));
    const branded = store.pathFor(imagePrompt('a handful of almonds', { brandName: 'Netto' }));
    expect(plain.key).not.toBe(branded.key);
  });

  it('writes where it said it would, and reports a root-relative ref', () => {
    const prompt = imagePrompt('a scatter of coffee beans');
    expect(store.has(prompt)).toBe(false);
    const at = store.put(prompt, Buffer.from('png-bytes'));
    expect(store.has(prompt)).toBe(true);
    expect(readFileSync(at.file).toString()).toBe('png-bytes');
    // Root-relative is what `withAssetBase` knows how to rewrite for a
    // `file://` print run — an absolute path here breaks the PDF only.
    expect(at.ref).toBe(`/decor/${at.key}.png`);
  });
});

describe('reconcile', () => {
  const pages = [brief('p1', [offer('a', 'Mandler'), offer('b', 'Toiletpapir')])];

  it('keeps a motif that names an offer on the page', () => {
    const [page] = reconcile(pages, [row()]);
    expect(page!.subject).toEqual({ offerId: 'a', subject: 'mandler', motif: 'a handful of almonds' });
  });

  it('draws an invented offer id anyway, but claims no provenance', () => {
    const [page] = reconcile(pages, [row({ offerId: 'nonexistent' })]);
    expect(page!.subject?.motif).toBe('a handful of almonds');
    expect(page!.subject?.offerId).toBeNull();
  });

  it('honours a refusal — saying no is a correct answer', () => {
    const [page] = reconcile(pages, [row({ draw: false, motif: '', subject: '' })]);
    expect(page!.subject).toBeNull();
  });

  it('treats draw=true with an empty motif as a refusal', () => {
    const [page] = reconcile(pages, [row({ motif: '   ' })]);
    expect(page!.subject).toBeNull();
  });

  it('answers for every page asked, in order, even when the model skips one', () => {
    const two = [...pages, brief('p2', [offer('c', 'Kaffe')])];
    const out = reconcile(two, [row({ pageId: 'p2', offerId: 'c' })]);
    expect(out.map((p) => p.pageId)).toEqual(['p1', 'p2']);
    expect(out[0]!.subject).toBeNull();
    expect(out[1]!.subject?.offerId).toBe('c');
  });

  it('ignores a page the model invented, and a second answer for one page', () => {
    const out = reconcile(pages, [
      row({ subject: 'første' }),
      row({ subject: 'anden' }),
      row({ pageId: 'ghost' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.subject?.subject).toBe('første');
  });
});

describe('the page schema', () => {
  it('defaults decorations to empty, so catalogues saved before this parse', () => {
    const page = CatalogPage.parse({
      id: 'p1', templateId: 'sb/grid-4', placements: [],
    });
    expect(page.decorations).toEqual([]);
  });

  // Twelve, not three: a page copied from a publication carries its own
  // headline and artwork as pictures, and those are not seasoning.
  it('refuses more than twelve', () => {
    const decor = {
      id: 'd', imageUrl: '/decor/a.png', anchor: 'top-left' as const,
    };
    const build = (n: number) => CatalogPage.parse({
      id: 'p1',
      templateId: 'sb/grid-4',
      placements: [],
      decorations: Array.from({ length: n }, (_, i) => ({ ...decor, id: `d${i}` })),
    });
    expect(build(12).decorations).toHaveLength(12);
    expect(() => build(13)).toThrow();
  });

  it('rejects an active scheme in the artwork URL', () => {
    expect(() => CatalogPage.parse({
      id: 'p1',
      templateId: 'sb/grid-4',
      placements: [],
      // eslint-disable-next-line no-script-url
      decorations: [{ id: 'd', imageUrl: 'javascript:alert(1)', anchor: 'top-left' }],
    })).toThrow();
  });
});
