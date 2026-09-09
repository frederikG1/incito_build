import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogDocument, ImageProfile } from '@incitio/schema';

/**
 * Storage for the studio.
 *
 * Documents are stored whole, as JSON, rather than decomposed into
 * relational tables. `CatalogDocument` is the unit the editor mutates and
 * the unit the renderer reads; shredding it into pages and placements
 * would buy query flexibility nobody needs and cost a schema migration
 * every time the layout model gains a field.
 *
 * `image_profiles` is the exception, and the only table the Python ML
 * sidecar touches — it is keyed by image hash so profiles survive both
 * regeneration and re-import of the same feed.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS catalogs (
  id           TEXT PRIMARY KEY,
  retailer_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  document     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Every save appends here, so a bad AI regeneration is always recoverable.
CREATE TABLE IF NOT EXISTS catalog_versions (
  catalog_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,
  document    TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (catalog_id, version)
);

CREATE TABLE IF NOT EXISTS image_profiles (
  source_hash TEXT PRIMARY KEY,
  offer_id    TEXT NOT NULL,
  profile     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogs_retailer ON catalogs (retailer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_offer ON image_profiles (offer_id);
`;

export interface CatalogSummary {
  id: string;
  retailerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // WAL keeps the ML sidecar's writes from blocking the studio's reads.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  list(): CatalogSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, retailer_id, name, created_at, updated_at
         FROM catalogs ORDER BY updated_at DESC`,
      )
      .all() as Record<string, string>[];

    return rows.map((row) => ({
      id: row['id'] as string,
      retailerId: row['retailer_id'] as string,
      name: row['name'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    }));
  }

  get(id: string): CatalogDocument | null {
    const row = this.db.prepare('SELECT document FROM catalogs WHERE id = ?').get(id) as
      | { document: string }
      | undefined;
    if (!row) return null;

    // Stored rows are re-validated on the way out: a schema change must
    // surface here rather than as a render crash in the editor.
    const parsed = CatalogDocument.safeParse(JSON.parse(row.document));
    return parsed.success ? parsed.data : null;
  }

  save(document: CatalogDocument, label = ''): CatalogDocument {
    const now = new Date().toISOString();
    const next = { ...document, updatedAt: now };
    const json = JSON.stringify(next);

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO catalogs (id, retailer_id, name, document, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             document = excluded.document,
             updated_at = excluded.updated_at`,
        )
        .run(next.id, next.retailerId, next.name, json, next.createdAt, now);

      const row = this.db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM catalog_versions WHERE catalog_id = ?')
        .get(next.id) as { v: number };

      this.db
        .prepare(
          `INSERT INTO catalog_versions (catalog_id, version, document, label, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(next.id, Number(row.v) + 1, json, label, now);

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return next;
  }

  remove(id: string): boolean {
    const info = this.db.prepare('DELETE FROM catalogs WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM catalog_versions WHERE catalog_id = ?').run(id);
    return Number(info.changes) > 0;
  }

  versions(id: string): { version: number; label: string; createdAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT version, label, created_at FROM catalog_versions
         WHERE catalog_id = ? ORDER BY version DESC`,
      )
      .all(id) as Record<string, unknown>[];

    return rows.map((row) => ({
      version: Number(row['version']),
      label: String(row['label']),
      createdAt: String(row['created_at']),
    }));
  }

  /** Read profiles for a set of offers. Missing entries are simply absent. */
  profilesFor(offerIds: string[]): Map<string, ImageProfile> {
    const result = new Map<string, ImageProfile>();
    if (offerIds.length === 0) return result;

    const placeholders = offerIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT profile FROM image_profiles WHERE offer_id IN (${placeholders})`)
      .all(...offerIds) as { profile: string }[];

    for (const row of rows) {
      const parsed = ImageProfile.safeParse(JSON.parse(row.profile));
      if (parsed.success) result.set(parsed.data.offerId, parsed.data);
    }
    return result;
  }

  /** Upsert path used by the ML sidecar. */
  putProfile(profile: ImageProfile): void {
    this.db
      .prepare(
        `INSERT INTO image_profiles (source_hash, offer_id, profile, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source_hash) DO UPDATE SET
           offer_id = excluded.offer_id,
           profile = excluded.profile,
           updated_at = excluded.updated_at`,
      )
      .run(profile.sourceHash, profile.offerId, JSON.stringify(profile), new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
