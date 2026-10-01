import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { BRAND_HEADER, createApp, Store } from '../index.js';

const offer = (id: string, name: string, price: number) => Offer.parse({
  id, name, price, validFrom: '2026-09-04', validTo: '2026-09-10', quantity: { size: null, unit: 'pcs' },
});

const document = CatalogDocument.parse({
  id: 'u36', schemaVersion: 2, name: 'Uge 36', brandId: 'superbrugsen',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  offers: [offer('ost', 'Klovborg', 30), offer('øl', 'Tuborg', 99)],
  pages: [{ id: 'p1', templateId: 'sb/duo-2', placements: [{ slotId: 'a', offerId: 'ost' }, { slotId: 'b', offerId: 'øl' }] }],
});

describe('editing a stored catalogue with ops', () => {
  let store: Store;
  let app: ReturnType<typeof createApp>;
  const as = (brandId: string) => ({ [BRAND_HEADER]: brandId, 'content-type': 'application/json' });
  const ops = (brandId: string, body: unknown) =>
    app.request('/api/brand/catalogs/u36/ops', { method: 'POST', headers: as(brandId), body: JSON.stringify(body) });

  beforeEach(() => {
    store = new Store(':memory:');
    app = createApp(store);
    store.save('superbrugsen', document);
  });

  it('reads the outline, as JSON or as text', async () => {
    const text = await (await app.request('/api/brand/catalogs/u36/outline?format=text', { headers: as('superbrugsen') })).text();
    expect(text).toContain('a (hero) ost: Klovborg — 30,-');
  });

  it('applies ops, saves a version and says what it did', async () => {
    const response = await ops('superbrugsen', { ops: [{ op: 'swap', offerId: 'ost', withOfferId: 'øl' }] });
    expect(response.status).toBe(200);
    const body = await response.json() as { applied: string[] };
    expect(body.applied).toEqual(['byttede Klovborg og Tuborg']);
    expect(store.get('superbrugsen', 'u36')!.pages[0]!.placements.find((p) => p.slotId === 'a')!.offerId).toBe('øl');
    expect(store.versions('superbrugsen', 'u36').length).toBeGreaterThan(1);
  });

  it('rejects a bad op with its index and leaves the catalogue alone', async () => {
    const response = await ops('superbrugsen', { ops: [{ op: 'remove', offerId: 'ost' }, { op: 'lead', offerId: 'nope' }] });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'op 2: no offer "nope"', index: 1 });
    expect(store.get('superbrugsen', 'u36')!.pages[0]!.placements).toHaveLength(2);
  });

  it('refuses a stale read, and another chain\'s catalogue does not exist', async () => {
    expect((await ops('superbrugsen', { ops: [{ op: 'remove', offerId: 'ost' }], updatedAt: 'old' })).status).toBe(409);
    expect((await ops('netto', { ops: [{ op: 'remove', offerId: 'ost' }] })).status).toBe(404);
  });
});

describe('editions', () => {
  let store: Store;
  let app: ReturnType<typeof createApp>;
  const as = { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' };

  beforeEach(() => {
    store = new Store(':memory:');
    app = createApp(store);
    store.save('superbrugsen', {
      ...document,
      offers: [...document.offers, offer('mælk', 'Letmælk', 10)],
      variants: [{ id: 'holbaek', name: 'Holbæk', stores: [], offers: [], ops: [] }],
    });
  });

  it('edits one edition: the ops are appended to it, the base is left alone', async () => {
    const response = await app.request('/api/brand/catalogs/u36/ops?variant=holbaek', {
      method: 'POST', headers: as, body: JSON.stringify({ ops: [{ op: 'swap', offerId: 'ost', withOfferId: 'mælk' }] }),
    });
    expect(response.status).toBe(200);
    const stored = store.get('superbrugsen', 'u36')!;
    expect(stored.pages[0]!.placements.map((p) => p.offerId)).toEqual(['ost', 'øl']);
    expect(stored.variants![0]!.ops).toEqual([{ op: 'swap', offerId: 'ost', withOfferId: 'mælk' }]);

    const outlineText = await (await app.request('/api/brand/catalogs/u36/outline?variant=holbaek&format=text', { headers: as })).text();
    expect(outlineText).toContain('a (hero) mælk: Letmælk — 10,-');
    const list = await (await app.request('/api/brand/catalogs/u36/variants', { headers: as })).json() as { variants: unknown[] };
    expect(list.variants).toEqual([expect.objectContaining({ id: 'holbaek', added: 1, removed: 1, ops: 1 })]);
  });

  it('does not store ops that do not apply to the edition', async () => {
    const response = await app.request('/api/brand/catalogs/u36/ops?variant=holbaek', {
      method: 'POST', headers: as, body: JSON.stringify({ ops: [{ op: 'lead', offerId: 'nope' }] }),
    });
    expect(response.status).toBe(422);
    expect(store.get('superbrugsen', 'u36')!.variants![0]!.ops).toEqual([]);
  });
});

describe('section versions', () => {
  it('counts up on every save under the same id', () => {
    const store = new Store(':memory:');
    const section = { id: 's1', name: 'Frost', tags: [], page: { id: 'p', templateId: 'sb/duo-2', placements: [] } };
    const first = store.saveSection('superbrugsen', section as never);
    const second = store.saveSection('superbrugsen', { ...first, name: 'Frost med balloner' });
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(second.createdAt).toBe(first.createdAt);
  });
});
