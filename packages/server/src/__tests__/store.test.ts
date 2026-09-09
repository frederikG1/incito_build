import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogDocument, ImageProfile } from '@incitio/schema';
import { Store } from '../db.js';

function doc(overrides: Partial<CatalogDocument> = {}): CatalogDocument {
  return {
    id: 'c1', schemaVersion: 1, name: 'Ugens tilbud', retailerId: 'sample',
    theme: {
      name: 'x', brandColor: '#c8102e', accentColor: '#ffd200',
      pageBackground: '#ffffff', textColor: '#1a1a1a',
      headingFont: 'Inter', bodyFont: 'Inter', logoUrl: null,
    },
    pageAspect: 0.707,
    pages: [{
      id: 'page-1', templateId: 'authored/grid-4', title: 'Mejeri', subtitle: '',
      placements: [{
        offerId: 'SKU-1', slotId: 'a',
        overrides: { pinned: false, displayName: null, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 },
      }],
    }],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('Store', () => {
  let store: Store;
  beforeEach(() => { store = new Store(':memory:'); });

  it('round-trips a document', () => {
    store.save(doc());
    expect(store.get('c1')?.pages[0]?.placements[0]?.offerId).toBe('SKU-1');
  });

  it('returns null for an unknown id', () => {
    expect(store.get('nope')).toBeNull();
  });

  it('updates in place rather than duplicating', () => {
    store.save(doc());
    store.save(doc({ name: 'Ændret' }));
    expect(store.list()).toHaveLength(1);
    expect(store.get('c1')?.name).toBe('Ændret');
  });

  it('stamps updatedAt on save', () => {
    const saved = store.save(doc());
    expect(saved.updatedAt).not.toBe('2026-09-08T00:00:00.000Z');
  });

  // Version history is what makes an AI regeneration safe to try: the
  // previous state is always still there.
  it('appends a version on every save', () => {
    store.save(doc());
    store.save(doc({ name: 'v2' }), 'efter omgenerering');
    const versions = store.versions('c1');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]?.label).toBe('efter omgenerering');
  });

  it('deletes a catalog and its versions', () => {
    store.save(doc());
    expect(store.remove('c1')).toBe(true);
    expect(store.get('c1')).toBeNull();
    expect(store.versions('c1')).toEqual([]);
  });

  it('reports a delete of something absent', () => {
    expect(store.remove('nope')).toBe(false);
  });

  it('stores and reads back image profiles by offer', () => {
    const profile: ImageProfile = {
      offerId: 'SKU-1', sourceHash: 'abc', kind: 'cutout', hasAlpha: true,
      subjectBBox: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1.2,
      dominantColors: ['#ff0000'], qualityScore: 0.8, provisional: false,
    };
    store.putProfile(profile);
    expect(store.profilesFor(['SKU-1']).get('SKU-1')?.kind).toBe('cutout');
  });

  it('replaces a profile for the same image hash', () => {
    const base: ImageProfile = {
      offerId: 'SKU-1', sourceHash: 'abc', kind: 'unknown', hasAlpha: false,
      subjectBBox: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1,
      dominantColors: [], qualityScore: 0.1, provisional: true,
    };
    store.putProfile(base);
    store.putProfile({ ...base, kind: 'lifestyle', qualityScore: 0.7, provisional: false });
    const profiles = store.profilesFor(['SKU-1']);
    expect(profiles.size).toBe(1);
    expect(profiles.get('SKU-1')?.kind).toBe('lifestyle');
  });

  it('returns an empty map when asked for no offers', () => {
    expect(store.profilesFor([]).size).toBe(0);
  });
});
