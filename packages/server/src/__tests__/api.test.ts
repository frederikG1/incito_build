import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogDocument } from '@incitio/schema';
import { createApp, Store } from '../index.js';

function doc(overrides: Partial<CatalogDocument> = {}): CatalogDocument {
  return {
    id: 'c1', schemaVersion: 1, name: 'Ugens tilbud', retailerId: 'sample',
    theme: {
      name: 'x', brandColor: '#c8102e', accentColor: '#ffd200',
      pageBackground: '#ffffff', textColor: '#1a1a1a',
      headingFont: 'Inter', bodyFont: 'Inter', logoUrl: null,
    },
    pageAspect: 0.707, pages: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

function put(app: ReturnType<typeof createApp>, body: unknown, id = 'c1', query = '') {
  return app.request(`/api/catalogs/${id}${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('api', () => {
  let store: Store;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new Store(':memory:');
    app = createApp(store);
  });

  it('reports health', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('404s an unknown catalog', async () => {
    expect((await app.request('/api/catalogs/nope')).status).toBe(404);
  });

  it('saves and reads back a catalog', async () => {
    expect((await put(app, doc())).status).toBe(200);
    const body = (await (await app.request('/api/catalogs/c1')).json()) as { document: CatalogDocument };
    expect(body.document.name).toBe('Ugens tilbud');
  });

  it('lists saved catalogs', async () => {
    await put(app, doc());
    const body = (await (await app.request('/api/catalogs')).json()) as { catalogs: unknown[] };
    expect(body.catalogs).toHaveLength(1);
  });

  // Validating at the boundary means a malformed document fails here,
  // with a usable message, rather than as a render crash much later.
  it('rejects a document that fails the schema', async () => {
    const response = await put(app, { ...doc(), pageAspect: -1 });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid document');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await app.request('/api/catalogs/c1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects a document whose id disagrees with the path', async () => {
    const response = await put(app, doc({ id: 'other' }), 'c1');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('does not match');
  });

  it('records a labelled version', async () => {
    await put(app, doc(), 'c1', '?label=f%C3%B8rste');
    const body = (await (await app.request('/api/catalogs/c1/versions')).json()) as {
      versions: { label: string }[];
    };
    expect(body.versions[0]?.label).toBe('første');
  });

  it('deletes a catalog', async () => {
    await put(app, doc());
    expect((await app.request('/api/catalogs/c1', { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/catalogs/c1')).status).toBe(404);
  });

  // The studio greys out its button on this, so it must be truthful.
  it('reports whether a planner key is configured', async () => {
    const previous = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    const off = (await (await app.request('/api/plan/status')).json()) as { configured: boolean };
    expect(off.configured).toBe(false);

    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const on = (await (await app.request('/api/plan/status')).json()) as { configured: boolean };
    expect(on.configured).toBe(true);

    if (previous === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = previous;
  });

  it('refuses to plan without a key, and says how to fix it', async () => {
    const previous = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    const response = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offers: [] }),
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { detail: string }).detail).toContain('ANTHROPIC_API_KEY');
    if (previous !== undefined) process.env['ANTHROPIC_API_KEY'] = previous;
  });

  it('rejects a plan request with no offers', async () => {
    const previous = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const response = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offers: [] }),
    });
    expect(response.status).toBe(400);
    if (previous === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = previous;
  });

  it('returns an empty profile list when none are stored', async () => {
    const body = (await (await app.request('/api/profiles?offerIds=a,b')).json()) as {
      profiles: unknown[];
    };
    expect(body.profiles).toEqual([]);
  });
});
