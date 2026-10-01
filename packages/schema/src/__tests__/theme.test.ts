import { describe, expect, it } from 'vitest';
import { CatalogDocument, PageDecoration, Theme, withTheme, isThemeDecor } from '../index.js';

const page = (id: string, kind = 'offers') => ({ id, templateId: 'sb/duo-2', kind, placements: [] });
const avis = CatalogDocument.parse({
  id: 'u41', schemaVersion: 2, name: 'Uge 41', brandId: 'superbrugsen',
  createdAt: '2026-10-01', updatedAt: '2026-10-01',
  offers: [],
  pages: [page('forside'), page('midt'), page('billede', 'image'), page('bagside')],
});
const hand = { id: 'img-1', imageUrl: '/uploads/sb/grapes.png', anchor: 'bottom-right' as const };
avis.pages[1]!.decorations = [PageDecoration.parse(hand)];
avis.pages[1]!.ground = '#123456';

const birthday = Theme.parse({
  id: 'fodselsdag', name: 'Fødselsdag', ground: '#fff4d6',
  pieces: [
    { imageUrl: '/uploads/sb/flag.jpg', place: 'top', size: 0.12, on: 'alle' },
    { imageUrl: '/uploads/sb/kage.png', place: 'bottom-right', size: 0.3, on: 'forside', front: true },
  ],
});
const halloween = Theme.parse({ id: 'halloween', name: 'Halloween', ground: '#1b1b1b', pieces: [{ imageUrl: '/uploads/sb/graeskar.png', place: 'top-left', on: 'bagside' }] });

describe('a theme for the whole avis', () => {
  it('puts each piece on the pages it is for, never on a picture page', () => {
    const themed = withTheme(avis, birthday);
    const count = (i: number) => themed.pages[i]!.decorations.filter((d) => isThemeDecor(d.id)).length;
    expect([0, 1, 2, 3].map(count)).toEqual([2, 1, 0, 1]);
    expect(themed.pages[0]!.decorations[0]!.rect).toEqual({ x: 0, y: 0, w: 1, h: 0.12 });
    expect(themed.pages[0]!.decorations[1]).toMatchObject({ anchor: 'bottom-right', scale: 0.3, front: true });
    expect(themed.theme).toEqual({ id: 'fodselsdag', name: 'Fødselsdag', ground: '#fff4d6' });
  });

  it('leaves what somebody did by hand: their picture, their page colour', () => {
    const themed = withTheme(avis, birthday);
    expect(themed.pages[1]!.decorations.map((d) => d.id)).toContain('img-1');
    expect(themed.pages[1]!.ground).toBe('#123456');
    expect(themed.pages[0]!.ground).toBe('#fff4d6');
  });

  it('another theme replaces it, and none takes it all off again', () => {
    const swapped = withTheme(withTheme(avis, birthday), halloween);
    expect(swapped.pages[0]!.decorations).toEqual([]);
    expect(swapped.pages[3]!.decorations.map((d) => d.id)).toEqual(['theme-halloween-0']);
    expect(swapped.pages[0]!.ground).toBe('#1b1b1b');
    const bare = withTheme(swapped, null);
    expect(bare.theme).toBeUndefined();
    expect(bare.pages.map((p) => p.ground)).toEqual([null, '#123456', null, null]);
    expect(bare.pages[1]!.decorations.map((d) => d.id)).toEqual(['img-1']);
    expect(CatalogDocument.safeParse(bare).success).toBe(true);
  });
});
