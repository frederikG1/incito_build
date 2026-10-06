import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Who is signed in, and which chains they may act as.
 *
 * The brand header (`BRAND_HEADER`) still says which chain a request is
 * FOR — the routes are unchanged — but with sign-in on it is only
 * honoured for a chain the person is a member of. A header can be typed
 * by anyone; a membership is a row only `npm run accounts` writes.
 *
 * Deliberately small: passwords hashed with scrypt (node:crypto, no
 * dependency), an opaque session token in an HttpOnly cookie, and the
 * database storing only the token's SHA-256. No sign-up route: accounts
 * are made on the server, by someone who can already reach its database.
 */

export type AuthMode = 'off' | 'on';

export interface Membership {
  brandId: string;
  role: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  brands: Membership[];
}

/** The cookie a session rides in. Path-scoped to the API, never readable by script. */
export const SESSION_COOKIE = 'incitio_session';
/** A working week and a weekend: staff sign in Monday, not every morning. */
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
const MIN_PASSWORD = 10;

/** `scrypt$N$r$p$salt$hash`, all base64 — the parameters travel with the hash so they can be raised later. */
export function hashPassword(password: string): string {
  if (password.length < MIN_PASSWORD) throw new Error(`adgangskoden skal være mindst ${MIN_PASSWORD} tegn`);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/*
 * Checked against when the email is unknown, so a wrong address costs
 * the same time as a wrong password and the timing says nothing about
 * who has an account.
 */
const DECOY = hashPassword(randomBytes(24).toString('base64'));

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

interface UserRow { id: string; email: string; name: string; password_hash: string; disabled_at: string | null }

export class Accounts {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  addUser(email: string, name: string, password: string): User {
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, email.trim(), name.trim(), hashPassword(password), new Date(this.now()).toISOString());
    return this.user(id)!;
  }

  setPassword(email: string, password: string): void {
    const row = this.row(email);
    if (!row) throw new Error(`ingen konto for ${email}`);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id);
    // A new password ends every session the old one opened.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  }

  grant(email: string, brandId: string, role = 'redaktør'): void {
    const row = this.row(email);
    if (!row) throw new Error(`ingen konto for ${email}`);
    this.db.prepare(
      `INSERT INTO memberships (user_id, brand_id, role) VALUES (?, ?, ?)
       ON CONFLICT (user_id, brand_id) DO UPDATE SET role = excluded.role`,
    ).run(row.id, brandId, role);
  }

  revoke(email: string, brandId: string): boolean {
    const row = this.row(email);
    if (!row) return false;
    return Number(this.db.prepare('DELETE FROM memberships WHERE user_id = ? AND brand_id = ?').run(row.id, brandId).changes) > 0;
  }

  /** Stops the account and every session it has, at once. Kept, not deleted: signatures name it. */
  disable(email: string): void {
    const row = this.row(email);
    if (!row) throw new Error(`ingen konto for ${email}`);
    this.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(new Date(this.now()).toISOString(), row.id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  }

  list(): (User & { disabled: boolean })[] {
    const rows = this.db.prepare('SELECT id, disabled_at FROM users ORDER BY email').all() as { id: string; disabled_at: string | null }[];
    return rows.map((row) => ({ ...this.user(row.id)!, disabled: row.disabled_at !== null }));
  }

  /** A new session for the right email and password; null for anything else, in the same time. */
  login(email: string, password: string): { token: string; user: User; expiresAt: string } | null {
    const row = this.row(email);
    const ok = verifyPassword(password, row?.password_hash ?? DECOY);
    if (!row || !ok || row.disabled_at !== null) return null;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now() + SESSION_MS).toISOString();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), row.id, new Date(this.now()).toISOString(), expiresAt);
    return { token, user: this.user(row.id)!, expiresAt };
  }

  /** The person a token belongs to, while it is valid. */
  session(token: string): User | null {
    if (!token) return null;
    const found = this.db.prepare(
      `SELECT s.user_id, s.expires_at, u.disabled_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    ).get(digest(token)) as { user_id: string; expires_at: string; disabled_at: string | null } | undefined;
    if (!found || found.disabled_at !== null) return null;
    if (Date.parse(found.expires_at) <= this.now()) {
      this.logout(token);
      return null;
    }
    return this.user(found.user_id);
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  }

  private row(email: string): UserRow | undefined {
    return this.db.prepare('SELECT id, email, name, password_hash, disabled_at FROM users WHERE email = ?')
      .get(email.trim()) as UserRow | undefined;
  }

  private user(id: string): User | null {
    const row = this.db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id) as Omit<UserRow, 'password_hash' | 'disabled_at'> | undefined;
    if (!row) return null;
    const brands = this.db.prepare('SELECT brand_id, role FROM memberships WHERE user_id = ? ORDER BY brand_id')
      .all(id) as { brand_id: string; role: string }[];
    return { id: row.id, email: row.email, name: row.name, brands: brands.map((b) => ({ brandId: b.brand_id, role: b.role })) };
  }
}

/**
 * Failed sign-ins, counted per address and per client in memory.
 *
 * Ten wrong tries in fifteen minutes and that key waits out the rest of
 * the window. In memory because one process serves the studio; a second
 * process would need this in the database.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly limit = 10, private readonly windowMs = 15 * 60 * 1000, private readonly now: () => number = Date.now) {}

  blocked(...keys: string[]): boolean {
    return keys.some((key) => this.recent(key).length >= this.limit);
  }

  failed(...keys: string[]): void {
    for (const key of keys) this.failures.set(key, [...this.recent(key), this.now()]);
  }

  cleared(...keys: string[]): void {
    for (const key of keys) this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((at) => at > since);
  }
}
