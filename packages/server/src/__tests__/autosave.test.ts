import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogDocument } from '@incitio/schema';
import { BRAND_HEADER, createApp, Store } from '../index.js';

const document = CatalogDocument.parse({
  id: 'u40', schemaVersion: 2, name: 'Uge 40', brandId: 'superbrugsen',
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z',
  offers: [], pages: [],
});

describe('saving as you work', () => {
  let store: Store;
  let app: ReturnType<typeof createApp>;
  const as = { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' };
  const put = (doc: CatalogDocument, query = '') =>
    app.request(`/api/brand/catalogs/u40${query}`, { method: 'PUT', headers: as, body: JSON.stringify(doc) });

  beforeEach(() => {
    store = new Store(':memory:');
    app = createApp(store);
  });

  it('automatic saves close together are one point in the history; a named save is its own', () => {
    store.save('superbrugsen', document, 'manuel');
    store.save('superbrugsen', { ...document, name: 'a' }, 'auto');
    store.save('superbrugsen', { ...document, name: 'b' }, 'auto');
    store.save('superbrugsen', { ...document, name: 'c' }, 'auto');
    const versions = store.versions('superbrugsen', 'u40');
    expect(versions.map((v) => v.label)).toEqual(['auto', 'manuel']);
    expect(store.version('superbrugsen', 'u40', versions[0]!.version)!.name).toBe('c');
    expect(store.version('superbrugsen', 'u40', versions[1]!.version)!.name).toBe('Uge 40');
  });

  it('refuses to overwrite a save somebody else made in between', async () => {
    const first = await (await put(document, '?label=auto')).json() as { document: CatalogDocument };
    const seen = first.document.updatedAt;
    // A colleague saves.
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.save('superbrugsen', { ...document, name: 'kollegaens' }, 'manuel');

    const mine = await put({ ...document, name: 'min' }, `?label=auto&expected=${encodeURIComponent(seen)}`);
    expect(mine.status).toBe(409);
    expect(store.get('superbrugsen', 'u40')!.name).toBe('kollegaens');

    // Without the check — "gem min alligevel" — it goes through.
    expect((await put({ ...document, name: 'min' }, '?label=manuel')).status).toBe(200);
  });

  it('serves an old version, and not another chain\'s', async () => {
    store.save('superbrugsen', document, 'manuel');
    const { version } = store.versions('superbrugsen', 'u40')[0]!;
    const ok = await app.request(`/api/brand/catalogs/u40/versions/${version}`, { headers: as });
    expect(ok.status).toBe(200);
    const other = await app.request(`/api/brand/catalogs/u40/versions/${version}`, { headers: { [BRAND_HEADER]: 'netto' } });
    expect(other.status).toBe(404);
  });
});
