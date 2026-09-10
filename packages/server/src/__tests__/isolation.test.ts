import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogDocument } from '@incitio/schema';
import { BRAND_HEADER, createApp, Store } from '../index.js';

function doc(brandId: string, id = 'c1'): CatalogDocument {
  return {
    id,
    schemaVersion: 2,
    name: 'Uge 38',
    brandId,
    pages: [],
    offers: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  };
}

describe('brand scoping', () => {
  let store: Store;
  let app: ReturnType<typeof createApp>;

  const as = (brandId: string) => ({ [BRAND_HEADER]: brandId });

  const put = (brandId: string, document: CatalogDocument) =>
    app.request(`/api/brand/catalogs/${document.id}`, {
      method: 'PUT',
      headers: { ...as(brandId), 'content-type': 'application/json' },
      body: JSON.stringify(document),
    });

  beforeEach(() => {
    store = new Store(':memory:');
    app = createApp(store);
  });

  it('serves health and the chain list without a scope', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    const brands = await (await app.request('/api/brands')).json() as { brands: unknown[] };
    expect(brands.brands.length).toBeGreaterThan(1);
  });

  it('refuses a scoped route with no chain header', async () => {
    expect((await app.request('/api/brand/catalogs')).status).toBe(403);
  });

  it('refuses an unknown chain', async () => {
    expect((await app.request('/api/brand/profile', { headers: as('rema1000') })).status).toBe(403);
  });

  it('serves only the chain\'s own layouts on its profile', async () => {
    const response = await app.request('/api/brand/profile', { headers: as('netto') });
    const body = await response.json() as { brand: { templates: { id: string }[] } };
    expect(body.brand.templates.length).toBeGreaterThan(0);
    for (const template of body.brand.templates) {
      expect(template.id.startsWith('netto/')).toBe(true);
    }
  });

  /*
   * The requirement in one test: a Netto session must not be able to
   * read, list, print or overwrite SuperBrugsen's catalogue, even
   * knowing its id — and ids are guessable.
   */
  describe('with a SuperBrugsen catalogue stored', () => {
    beforeEach(async () => {
      expect((await put('superbrugsen', doc('superbrugsen'))).status).toBe(200);
    });

    it('is invisible in another chain\'s listing', async () => {
      const mine = await (await app.request('/api/brand/catalogs', { headers: as('netto') }))
        .json() as { catalogs: unknown[] };
      expect(mine.catalogs).toEqual([]);

      const theirs = await (await app.request('/api/brand/catalogs', { headers: as('superbrugsen') }))
        .json() as { catalogs: unknown[] };
      expect(theirs.catalogs).toHaveLength(1);
    });

    it('is not readable by id from another chain', async () => {
      const response = await app.request('/api/brand/catalogs/c1', { headers: as('netto') });
      // 404 rather than 403: whether it exists is itself information.
      expect(response.status).toBe(404);
    });

    it('does not leak its edit history', async () => {
      const response = await app.request('/api/brand/catalogs/c1/versions', { headers: as('netto') });
      expect(await response.json()).toEqual({ versions: [] });
    });

    it('cannot be overwritten from another chain', async () => {
      const response = await put('netto', doc('netto'));
      expect(response.status).toBe(403);
      // And the original survives untouched.
      expect(store.get('superbrugsen', 'c1')?.brandId).toBe('superbrugsen');
    });

    it('cannot be deleted from another chain', async () => {
      const response = await app.request('/api/brand/catalogs/c1', {
        method: 'DELETE', headers: as('netto'),
      });
      expect(response.status).toBe(404);
      expect(store.get('superbrugsen', 'c1')).not.toBeNull();
    });
  });

  it('rejects a document whose own brand disagrees with the scope', async () => {
    // The header says Netto, the body says SuperBrugsen. Trusting the
    // body would make the header decorative.
    const response = await put('netto', doc('superbrugsen', 'c9'));
    expect(response.status).toBe(403);
    expect(store.get('superbrugsen', 'c9')).toBeNull();
  });

  it('refuses a feed that does not belong to the chain', async () => {
    const response = await app.request('/api/brand/build', {
      method: 'POST',
      headers: { ...as('netto'), 'content-type': 'application/json' },
      body: JSON.stringify({ feed: JSON.stringify({ Pages: [] }), skipCuration: true }),
    });
    expect(response.status).toBe(422);
  });
});

describe('building a catalogue', () => {
  it('builds from the chain\'s own CSV without a model call', async () => {
    const app = createApp(new Store(':memory:'));
    const feed = [
      'artikelnr;varenavn;maerke;kategori;pris;foerpris;maengde;beskrivelse;billede;gyldig_fra;gyldig_til;etiketter',
      'A1;Letmælk;Arla;mejeri;9,95;12,95;1 l;Frisk;/images/a.svg;14-09-2026;20-09-2026;',
      'A2;Skyr;Cheasy;mejeri;16,00;22,50;450 g;Skyr;/images/b.svg;14-09-2026;20-09-2026;',
      'A3;Ost;Arla;mejeri;25,00;30,00;200 g;Ost;/images/c.svg;14-09-2026;20-09-2026;',
    ].join('\n');

    const response = await app.request('/api/brand/build', {
      method: 'POST',
      headers: { [BRAND_HEADER]: 'netto', 'content-type': 'application/json' },
      body: JSON.stringify({ feed, skipCuration: true, maxPages: 2 }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      document: CatalogDocument; curated: boolean; offerCount: number;
    };
    expect(body.curated).toBe(false);
    expect(body.offerCount).toBe(3);
    expect(body.document.brandId).toBe('netto');
    expect(body.document.pages.length).toBeGreaterThan(0);
  });
});
