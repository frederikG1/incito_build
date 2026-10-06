import type { DatabaseSync } from 'node:sqlite';

/**
 * Every change the database has ever had, in order.
 *
 * The version a file is at lives in SQLite's own `PRAGMA user_version`,
 * so there is no table to bootstrap and nothing to get out of step: a
 * database at version N has had exactly the first N of these run on it.
 *
 * The rules, because a migration that ran on somebody's machine cannot
 * be taken back:
 * - Append only. Never edit or reorder one that has shipped — write the
 *   next one instead.
 * - One transaction each: a migration lands whole or not at all.
 * - Documents stay JSON (see `db.ts`), so a new field on a page is a
 *   schema change in `@incitio/schema`, not a migration here. These are
 *   for tables, columns and indexes only.
 */
export const MIGRATIONS: readonly { name: string; sql: string }[] = [
  {
    /*
     * The tables as they stood before migrations existed. Written with
     * IF NOT EXISTS so a database from that time — at user_version 0,
     * with every table already there — is stamped rather than broken.
     */
    name: 'grundskema',
    sql: `
    CREATE TABLE IF NOT EXISTS catalogs (
      id          TEXT PRIMARY KEY,
      brand_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      document    TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Every save appends here, so a bad regeneration is always recoverable.
    CREATE TABLE IF NOT EXISTS catalog_versions (
      catalog_id  TEXT NOT NULL,
      version     INTEGER NOT NULL,
      document    TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      PRIMARY KEY (catalog_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_catalogs_brand ON catalogs (brand_id);

    /*
     * The chain's own pictures — balloons, birthday flags, a paper
     * texture — as a list somebody can find again.
     *
     * The bytes are on disk and always were; what did not exist was any
     * record that they had been uploaded, so a file could only be reached
     * by a document that already pointed at it. Upload a background, undo,
     * and it was gone for good.
     *
     * Keyed by (brand, ref) rather than by the content hash alone: the
     * same picture uploaded by two chains is one file on disk and two
     * rows here, which is what lets one chain rename or remove its copy
     * without touching the other's.
     */
    CREATE TABLE IF NOT EXISTS uploads (
      brand_id    TEXT NOT NULL,
      ref         TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (brand_id, ref)
    );

    /*
     * The chain's section designs — "Frost med balloner", "Bagside",
     * "Fredag & lørdag" — the pages a leaflet reuses week after week with
     * different products in the cells. Stored whole, like a catalogue, and
     * like a catalogue scoped by brand in every query.
     */
    CREATE TABLE IF NOT EXISTS sections (
      id          TEXT PRIMARY KEY,
      brand_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      section     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sections_brand ON sections (brand_id);

    /*
     * How the chain wants its offers to look — its own rules, written in the
     * studio. One row per chain: the list IS the setting, and its order is
     * its precedence, so it is stored whole.
     */
    CREATE TABLE IF NOT EXISTS offer_designs (
      brand_id    TEXT PRIMARY KEY,
      designs     TEXT NOT NULL,
      design_tag  TEXT,
      updated_at  TEXT NOT NULL
    );

    -- The chain's themes — birthday, Halloween — stored whole, like its rules.
    CREATE TABLE IF NOT EXISTS themes (
      brand_id    TEXT PRIMARY KEY,
      themes      TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offer_rules (
      brand_id    TEXT PRIMARY KEY,
      rules       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    `,
  },
  {
    /*
     * Who may sign in, and to which chains.
     *
     * A person is a row in `users`; which chains they work for, and as
     * what, is `memberships` — the brand a request acts as must be one
     * of them (see `auth.ts`). A session is stored only as the SHA-256
     * of its token, so a copy of this file signs nobody in.
     */
    name: 'konti',
    sql: `
    CREATE TABLE users (
      id             TEXT PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name           TEXT NOT NULL,
      password_hash  TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      disabled_at    TEXT
    );
    CREATE TABLE memberships (
      user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      brand_id  TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'redaktør',
      PRIMARY KEY (user_id, brand_id)
    );
    CREATE TABLE sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_user ON sessions (user_id);
    `,
  },
];

/** The version this code expects a database to be at. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Bring a database up to `SCHEMA_VERSION`. Returns the migrations run.
 *
 * Refuses a database NEWER than the code: that is a file a later build
 * wrote, and an older server writing to it would quietly lose whatever
 * the newer tables hold.
 */
export function migrate(db: DatabaseSync): string[] {
  const at = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (at > SCHEMA_VERSION) {
    throw new Error(`databasen er på version ${at}, men koden kender kun ${SCHEMA_VERSION} — opdatér serveren`);
  }
  const ran: string[] = [];
  for (let version = at + 1; version <= SCHEMA_VERSION; version += 1) {
    const migration = MIGRATIONS[version - 1]!;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${version} (${migration.name}) fejlede: ${error instanceof Error ? error.message : error}`);
    }
    ran.push(`${version}-${migration.name}`);
  }
  return ran;
}
