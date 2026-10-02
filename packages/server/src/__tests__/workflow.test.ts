import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { BRAND_HEADER, createApp, Store } from '../index.js';

/*
 * The workflow as the server holds it: each test is a way a caller —
 * a stale tab, a script, an agent — could try to step around a rule.
 */

const offer = (id: string, name: string, price: number, extra: Partial<Offer> = {}) => Offer.parse({
  id, name, price, validFrom: '2026-09-04', validTo: '2026-09-10', quantity: { size: null, unit: 'pcs' }, ...extra,
});

const base = CatalogDocument.parse({
  id: 'u36', schemaVersion: 2, name: 'Uge 36', brandId: 'superbrugsen',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  offers: [
    offer('ost', 'Klovborg', 30, { prePrice: 40 }),
    offer('øl', 'Carlsberg', 99),
    offer('vin', 'Rødvin', 60),
  ],
  pages: [{ id: 'p1', templateId: 'sb/duo-2', placements: [{ slotId: 'a', offerId: 'ost' }, { slotId: 'b', offerId: 'øl' }] }],
});

let store: Store;
let app: ReturnType<typeof createApp>;
const json = { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' };
const stored = () => store.get('superbrugsen', 'u36')!;

const call = (path: string, method: string, body?: unknown) =>
  app.request(`/api/brand/catalogs/u36${path}`, { method, headers: json, ...(body ? { body: JSON.stringify(body) } : {}) });
const put = (document: CatalogDocument, query = `?expected=${encodeURIComponent(stored().updatedAt)}`) =>
  call(query, 'PUT', document);
const act = async (path: string, body: Record<string, unknown> = {}) => {
  const response = await call(path, 'POST', { updatedAt: stored().updatedAt, ...body });
  return { status: response.status, body: await response.json() as { document: CatalogDocument; error?: string; blockers?: { said: string }[] } };
};
const signAll = async () => {
  for (const role of ['marketing', 'indkob', 'pris']) expect((await act('/approvals', { role, who: 'Mette' })).status).toBe(200);
};

beforeEach(() => {
  store = new Store(':memory:');
  app = createApp(store);
  store.save('superbrugsen', base);
});

describe('a plain save cannot write the workflow', () => {
  it('keeps stored signatures, sold places, log and status, and says it did', async () => {
    await act('/bookings', { pageId: 'p1', slotId: 'b', supplier: 'Carlsberg Danmark', offerId: 'øl', price: 25000 });
    const forged = {
      ...stored(),
      approvals: [{ role: 'pris' as const, who: 'ingen', at: '2026-09-01T00:00:00.000Z', seen: { pages: [], offers: {}, editions: {}, bookings: {} } }],
      bookings: [],
      status: 'udgivet' as const,
      name: 'Uge 36 rettet',
    };
    const response = await put(forged);
    expect(response.status).toBe(200);
    expect((await response.json() as { kept: string[] }).kept).toEqual(['approvals', 'bookings', 'status']);
    expect(stored().name).toBe('Uge 36 rettet');
    expect(stored().approvals ?? []).toEqual([]);
    expect(stored().bookings).toHaveLength(1);
    expect(stored().status).not.toBe('udgivet');
  });

  it('a new document starts unsigned and unpublished', async () => {
    const fresh = { ...base, id: 'u37', status: 'udgivet' as const, live: [{ id: 'x', at: 'x', kind: 'pris' as const, offerId: 'ost', substituteId: null, before: 1, after: 2, who: '' }] };
    const response = await app.request('/api/brand/catalogs/u37', { method: 'PUT', headers: json, body: JSON.stringify(fresh) });
    expect(response.status).toBe(200);
    const saved = store.get('superbrugsen', 'u37')!;
    expect(saved.status).toBe('kladde');
    expect(saved.live).toBeUndefined();
  });

  it('a whole-document save must say what it replaces', async () => {
    expect((await put(stored(), '')).status).toBe(428);
    expect((await put(stored(), '?expected=old')).status).toBe(409);
    expect((await put(stored(), '?force=1')).status).toBe(200);
  });

  it('PATCH cannot publish', async () => {
    expect((await call('', 'PATCH', { status: 'udgivet' })).status).toBe(422);
    expect((await call('', 'PATCH', { status: 'klar' })).status).toBe(200);
  });
});

describe('two writers at once', () => {
  it('ops sent together both land — neither undoes the other', async () => {
    const [one, two] = await Promise.all([
      call('/ops', 'POST', { ops: [{ op: 'swap', offerId: 'ost', withOfferId: 'øl' }] }),
      call('/ops', 'POST', { ops: [{ op: 'price', offerId: 'vin', price: 55 }] }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(stored().pages[0]!.placements.find((p) => p.slotId === 'a')!.offerId).toBe('øl');
    expect(stored().offers.find((o) => o.id === 'vin')!.price).toBe(55);
  });

  it('a workflow act on an avis that moved on is refused', async () => {
    const seen = stored().updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await put({ ...stored(), name: 'kollega' });
    const response = await call('/approvals', 'POST', { role: 'pris', who: 'Mette', updatedAt: seen });
    expect(response.status).toBe(409);
  });
});

describe('sign-off', () => {
  it('signs what is stored and names the version it was saved as', async () => {
    const { status, body } = await act('/approvals', { role: 'pris', who: 'Mette' });
    expect(status).toBe(200);
    const approval = body.document.approvals![0]!;
    expect(approval).toMatchObject({ role: 'pris', who: 'Mette' });
    const versions = store.versions('superbrugsen', 'u36');
    expect(versions[0]).toMatchObject({ version: approval.version, label: 'godkendt · Pris og jura · Mette' });
    expect(store.version('superbrugsen', 'u36', approval.version!)!.approvals![0]!.who).toBe('Mette');
  });

  it('the front page counts a signature only while it holds', async () => {
    await act('/approvals', { role: 'pris', who: 'Mette' });
    expect(store.list('superbrugsen')[0]).toMatchObject({ approvals: ['pris'], stale: [] });
    await put({ ...stored(), offers: stored().offers.map((o) => (o.id === 'ost' ? { ...o, price: 29 } : o)) });
    expect(store.list('superbrugsen')[0]).toMatchObject({ approvals: [], stale: ['pris'] });
  });

  it('a signature needs a name', async () => {
    expect((await act('/approvals', { role: 'pris', who: ' ' })).status).toBe(422);
  });
});

describe('sold places', () => {
  beforeEach(async () => {
    expect((await act('/bookings', { pageId: 'p1', slotId: 'b', supplier: 'Carlsberg Danmark', offerId: 'øl', price: 25000 })).status).toBe(200);
  });

  it('a place is sold once', async () => {
    const again = await act('/bookings', { pageId: 'p1', slotId: 'b', supplier: 'Royal Unibrew', offerId: null, price: 30000 });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('Carlsberg Danmark');
  });

  it('a save that puts something else in it is refused, by PUT and by ops', async () => {
    const moved = { ...stored(), pages: [{ ...stored().pages[0]!, placements: [{ slotId: 'a', offerId: 'ost' }, { slotId: 'b', offerId: 'vin' }] }] };
    const response = await put(moved as CatalogDocument);
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toContain('Carlsberg Danmark');
    expect((await call('/ops', 'POST', { ops: [{ op: 'remove', offerId: 'øl' }] })).status).toBe(422);
    expect(stored().pages[0]!.placements.find((p) => p.slotId === 'b')!.offerId).toBe('øl');
  });

  it('and so is a store edition that does', async () => {
    await put({ ...stored(), variants: [{ id: 'holbaek', name: 'Holbæk', stores: [], ops: [], offers: [] }] } as CatalogDocument);
    const response = await call('/ops?variant=holbaek', 'POST', { ops: [{ op: 'swap', offerId: 'øl', withOfferId: 'ost' }] });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toMatch(/^Holbæk: /);
  });

  it('released, the place is free again', async () => {
    const id = stored().bookings![0]!.id;
    const response = await app.request(`/api/brand/catalogs/u36/bookings/${id}?updatedAt=${encodeURIComponent(stored().updatedAt)}`, { method: 'DELETE', headers: json });
    expect(response.status).toBe(200);
    expect((await call('/ops', 'POST', { ops: [{ op: 'remove', offerId: 'øl' }] })).status).toBe(200);
  });
});

describe('publishing', () => {
  it('needs every signature, on what is there now', async () => {
    const early = await act('/publish', { who: 'Mette' });
    expect(early.status).toBe(422);
    expect(early.body.blockers!.map((b) => b.said)).toEqual([
      'Marketing har ikke godkendt', 'Indkøb har ikke godkendt', 'Pris og jura har ikke godkendt',
    ]);
    await signAll();
    await put({ ...stored(), offers: stored().offers.map((o) => (o.id === 'ost' ? { ...o, price: 29 } : o)) });
    const stale = await act('/publish', { who: 'Mette' });
    expect(stale.status).toBe(422);
    expect(stale.body.blockers!.map((b) => b.said)).toContain('Pris og jura skal se 1 ændring igen');
  });

  it('is refused while a price breaks the rules — in a store edition too', async () => {
    await put({
      ...stored(),
      variants: [{ id: 'holbaek', name: 'Holbæk', stores: [], ops: [{ op: 'price', offerId: 'ost', price: 45 }], offers: [] }],
    } as CatalogDocument);
    await signAll();
    const refused = await act('/publish', { who: 'Mette' });
    expect(refused.status).toBe(422);
    expect(refused.body.blockers!.map((b) => b.said).join()).toContain('Holbæk: ');
    expect(stored().status).not.toBe('udgivet');
  });

  it('passes when signed and clean, and can be taken back', async () => {
    await signAll();
    const done = await act('/publish', { who: 'Mette' });
    expect(done.status).toBe(200);
    expect(stored().status).toBe('udgivet');
    expect((await act('/approvals', { role: 'pris', who: 'Mette' })).status).toBe(422);
    expect((await act('/unpublish', { who: 'Mette' })).status).toBe(200);
    expect(stored().status).toBe('klar');
    expect(store.versions('superbrugsen', 'u36').map((v) => v.label)).toContain('trukket tilbage · Mette');
    // Nothing changed, so the signatures still hold and it may go out again.
    expect((await act('/publish', { who: 'Mette' })).status).toBe(200);
  });
});

describe('a published avis', () => {
  beforeEach(async () => {
    await signAll();
    expect((await act('/publish', { who: 'Mette' })).status).toBe(200);
  });

  it('logs a live price with the price it replaced, read from the avis', async () => {
    const { status, body } = await act('/live', { kind: 'pris', offerId: 'ost', after: 28, who: 'Butik 12', before: 1 });
    expect(status).toBe(200);
    expect(body.document.live!.at(-1)).toMatchObject({ kind: 'pris', offerId: 'ost', before: 30, after: 28, who: 'Butik 12' });
    expect(stored().offers.find((o) => o.id === 'ost')!.price).toBe(28);
  });

  it('refuses a live price the rules stop', async () => {
    // 45 over a "før 40": a saving of nothing, printed as one.
    const refused = await act('/live', { kind: 'pris', offerId: 'ost', after: 45 });
    expect(refused.status).toBe(422);
    expect(stored().offers.find((o) => o.id === 'ost')!.price).toBe(30);
  });

  it('a price changed by a plain save is logged too, and checked', async () => {
    const reprice = (price: number) => ({ ...stored(), offers: stored().offers.map((o) => (o.id === 'ost' ? { ...o, price } : o)) });
    expect((await put(reprice(27))).status).toBe(200);
    expect(stored().live!.at(-1)).toMatchObject({ kind: 'pris', offerId: 'ost', before: 30, after: 27, who: 'redigering' });
    expect((await put(reprice(45))).status).toBe(422);
  });

  it('sold out and back again', async () => {
    expect((await act('/live', { kind: 'udsolgt', offerId: 'ost', substituteId: 'vin' })).status).toBe(200);
    expect(stored().pages[0]!.placements.find((p) => p.slotId === 'a')!.offerId).toBe('vin');
    expect((await act('/live', { kind: 'tilbage', offerId: 'ost' })).status).toBe(200);
    expect(stored().pages[0]!.placements.find((p) => p.slotId === 'a')!.offerId).toBe('ost');
    expect((await act('/live', { kind: 'tilbage', offerId: 'ost' })).status).toBe(422);
  });
});
