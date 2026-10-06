import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import { standInPrices, type PriceSource } from '@incitio/workflow';
import { Accounts } from '../auth.js';
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../migrations.js';
import { BRAND_HEADER, createApp, ProductionRefused, Store } from '../index.js';

/*
 * Sign-in, as a caller would try to get around it: no session, someone
 * else's chain, a stolen-looking header, a session past its time.
 */

const PASSWORD = 'correct-horse-battery';
const realPrices: PriceSource = { demo: false, history: () => null };

let store: Store;
let app: ReturnType<typeof createApp>;

const login = async (email = 'mette@sb.dk', password = PASSWORD) => {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = /incitio_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return { status: response.status, cookie, setCookie: response.headers.get('set-cookie') ?? '' };
};
const as = (cookie: string, brand?: string) => ({
  cookie: `incitio_session=${cookie}`,
  ...(brand ? { [BRAND_HEADER]: brand } : {}),
});

beforeEach(() => {
  store = new Store(':memory:');
  store.accounts.addUser('mette@sb.dk', 'Mette Jensen', PASSWORD);
  store.accounts.grant('mette@sb.dk', 'superbrugsen', 'pris');
  app = createApp(store, { auth: 'on' });
});

describe('with sign-in on', () => {
  it('a signed-out caller gets nothing but health and who-am-I', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect(await (await app.request('/api/auth/me')).json()).toEqual({ auth: 'on', user: null });
    expect((await app.request('/api/brands')).status).toBe(401);
    expect((await app.request('/api/brand/profile', { headers: { [BRAND_HEADER]: 'superbrugsen' } })).status).toBe(401);
  });

  it('a wrong password and an unknown address answer the same', async () => {
    const wrong = await login('mette@sb.dk', 'not-the-password');
    const nobody = await login('nobody@sb.dk', PASSWORD);
    expect([wrong.status, nobody.status]).toEqual([401, 401]);
    expect(wrong.cookie).toBe('');
  });

  it('signs in with an HttpOnly cookie scoped to the API', async () => {
    const { status, setCookie } = await login();
    expect(status).toBe(200);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('lists only the chains the person works for, and refuses the others', async () => {
    const { cookie } = await login();
    const brands = await (await app.request('/api/brands', { headers: as(cookie) })).json() as { brands: { id: string }[] };
    expect(brands.brands.map((b) => b.id)).toEqual(['superbrugsen']);
    expect((await app.request('/api/brand/profile', { headers: as(cookie, 'superbrugsen') })).status).toBe(200);
    // The header is still typed by the caller — the membership is what is checked.
    expect((await app.request('/api/brand/profile', { headers: as(cookie, 'netto') })).status).toBe(403);
  });

  it('takes a bearer token as well as the cookie, for scripts', async () => {
    const session = store.accounts.login('mette@sb.dk', PASSWORD)!;
    const response = await app.request('/api/brand/profile', {
      headers: { authorization: `Bearer ${session.token}`, [BRAND_HEADER]: 'superbrugsen' },
    });
    expect(response.status).toBe(200);
  });

  it('signing out ends the session on the server, not just in the browser', async () => {
    const { cookie } = await login();
    await app.request('/api/auth/logout', { method: 'POST', headers: as(cookie) });
    expect((await app.request('/api/brands', { headers: as(cookie) })).status).toBe(401);
  });

  it('a closed account and a new password end every session', async () => {
    const first = await login();
    store.accounts.setPassword('mette@sb.dk', 'another-long-password');
    expect((await app.request('/api/brands', { headers: as(first.cookie) })).status).toBe(401);
    const second = await login('mette@sb.dk', 'another-long-password');
    store.accounts.disable('mette@sb.dk');
    expect((await app.request('/api/brands', { headers: as(second.cookie) })).status).toBe(401);
    expect((await login('mette@sb.dk', 'another-long-password')).status).toBe(401);
  });

  it('stops guessing after ten wrong passwords', async () => {
    for (let i = 0; i < 10; i += 1) expect((await login('mette@sb.dk', 'guess-number-' + i)).status).toBe(401);
    expect((await login()).status).toBe(429);
  });

  it('the name on a signature is the account, not what the body says', async () => {
    const offer = Offer.parse({ id: 'ost', name: 'Klovborg', price: 30, imageUrl: 'https://example.test/ost.png', validFrom: '2026-09-04', validTo: '2026-09-10', quantity: { size: null, unit: 'pcs' } });
    store.save('superbrugsen', CatalogDocument.parse({
      id: 'u36', schemaVersion: 2, name: 'Uge 36', brandId: 'superbrugsen',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      offers: [offer], pages: [{ id: 'p1', templateId: 'sb/duo-2', placements: [{ slotId: 'a', offerId: 'ost' }] }],
    }));
    const { cookie } = await login();
    const response = await app.request('/api/brand/catalogs/u36/approvals', {
      method: 'POST',
      headers: { ...as(cookie, 'superbrugsen'), 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'pris', who: 'Direktøren', updatedAt: store.get('superbrugsen', 'u36')!.updatedAt }),
    });
    expect(response.status).toBe(200);
    expect(store.get('superbrugsen', 'u36')!.approvals![0]!.who).toBe('Mette Jensen');
  });
});

describe('sessions', () => {
  it('expire after their time, and are stored only as a hash', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    let now = Date.parse('2026-10-06T08:00:00Z');
    const accounts = new Accounts(db, () => now);
    accounts.addUser('a@b.dk', 'A', PASSWORD);
    const { token } = accounts.login('a@b.dk', PASSWORD)!;
    const stored = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored.map((row) => row.token_hash)).not.toContain(token);
    expect(accounts.session(token)?.name).toBe('A');
    now += 8 * 24 * 60 * 60 * 1000;
    expect(accounts.session(token)).toBeNull();
  });

  it('refuses a short password', () => {
    expect(() => store.accounts.addUser('kort@sb.dk', 'Kort', 'abc')).toThrow(/mindst 10/);
  });
});

describe('with sign-in off (the laptop)', () => {
  it('the brand header alone decides, as before', async () => {
    const open = createApp(store);
    expect((await open.request('/api/brands')).status).toBe(200);
    expect((await open.request('/api/brand/profile', { headers: { [BRAND_HEADER]: 'netto' } })).status).toBe(200);
    expect(await (await open.request('/api/auth/me')).json()).toEqual({ auth: 'off', user: null });
  });
});

describe('production', () => {
  it('will not start on Eksempeltal', () => {
    expect(() => createApp(store, { production: true, auth: 'on' })).toThrow(ProductionRefused);
    try {
      createApp(store, { production: true, auth: 'on', prices: standInPrices });
    } catch (error) {
      expect((error as ProductionRefused).reasons.join(' ')).toMatch(/Eksempeltal/);
    }
  });

  it('will not start with sign-in off', () => {
    expect(() => createApp(store, { production: true, auth: 'off', prices: realPrices })).toThrow(/Login er slået fra/);
  });

  it('starts with real prices and sign-in on', () => {
    expect(() => createApp(store, { production: true, auth: 'on', prices: realPrices })).not.toThrow();
  });
});

describe('migrations', () => {
  const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

  it('brings a new database to the latest version, and a second run does nothing', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db)).toHaveLength(SCHEMA_VERSION);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toEqual([]);
  });

  it('upgrades a database from before migrations without losing its avis', () => {
    const db = new DatabaseSync(':memory:');
    // As the old Store left it: every table there, user_version 0.
    db.exec(MIGRATIONS[0]!.sql);
    db.prepare("INSERT INTO catalogs VALUES ('c1', 'superbrugsen', 'Uge 40', '{}', 'x', 'x')").run();
    expect(version(db)).toBe(0);
    expect(migrate(db)).toEqual(['1-grundskema', '2-konti']);
    expect(db.prepare('SELECT name FROM catalogs').get()).toEqual({ name: 'Uge 40' });
  });

  it('refuses a database written by newer code', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/opdatér serveren/);
  });

  it('a failing migration leaves the database as it was', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]!.sql);
    db.exec('PRAGMA user_version = 1');
    db.exec('CREATE TABLE users (id TEXT)'); // in the way of migration 2
    expect(() => migrate(db)).toThrow(/2 \(konti\)/);
    expect(version(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'memberships'").get()).toBeUndefined();
  });
});
