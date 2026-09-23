import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogDocument } from '@incitio/schema';

/**
 * Storage for the studio.
 *
 * Documents are stored whole, as JSON, rather than decomposed into
 * relational tables. `CatalogDocument` is the unit the editor mutates
 * and the unit the renderer reads; shredding it into pages and
 * placements would buy query flexibility nobody needs and cost a schema
 * migration every time the layout model gains a field.
 *
 * Every read and write is scoped by brand — see the note on `get`.
 */
const SCHEMA = `
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
`;

export interface CatalogSummary {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One picture in a chain's own library. */
export interface UploadSummary {
  ref: string;
  name: string;
  createdAt: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  /**
   * Remember that this chain uploaded this picture.
   *
   * Idempotent on (brand, ref): the same file dropped twice is one
   * row, and the name is refreshed because the second drop is the
   * more recent thing the person called it.
   */
  rememberUpload(brandId: string, ref: string, name: string): void {
    this.db.prepare(
      `INSERT INTO uploads (brand_id, ref, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (brand_id, ref) DO UPDATE SET name = excluded.name`,
    ).run(brandId, ref, name, new Date().toISOString());
  }

  /** This chain's pictures, newest first. Never another chain's. */
  uploads(brandId: string): UploadSummary[] {
    return this.db
      .prepare('SELECT ref, name, created_at FROM uploads WHERE brand_id = ? ORDER BY created_at DESC')
      .all(brandId)
      .map((row) => ({
        ref: row['ref'] as string,
        name: row['name'] as string,
        createdAt: row['created_at'] as string,
      }));
  }

  /**
   * Take a picture out of the chain's library.
   *
   * The row goes; the file stays. A document saved last week may still
   * be printing it, and a library is a list of what is offered rather
   * than a list of what exists.
   */
  forgetUpload(brandId: string, ref: string): boolean {
    return this.db.prepare('DELETE FROM uploads WHERE brand_id = ? AND ref = ?')
      .run(brandId, ref).changes > 0;
  }

  list(brandId: string): CatalogSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, brand_id, name, created_at, updated_at
         FROM catalogs WHERE brand_id = ? ORDER BY updated_at DESC`,
      )
      .all(brandId) as Record<string, string>[];

    return rows.map((row) => ({
      id: row['id'] as string,
      brandId: row['brand_id'] as string,
      name: row['name'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    }));
  }

  /**
   * One catalogue, IF it belongs to this brand.
   *
   * The brand is part of the query, not checked by the caller after the
   * fact. There is no `get(id)` on this class on purpose: an overload
   * that skipped the scope would be the one line an endpoint forgets,
   * and forgetting it means a Netto session reading Coop's unpublished
   * prices. Catalogue ids are guessable, so this is the whole defence.
   */
  get(brandId: string, id: string): CatalogDocument | null {
    const row = this.db
      .prepare('SELECT document FROM catalogs WHERE id = ? AND brand_id = ?')
      .get(id, brandId) as { document: string } | undefined;
    if (!row) return null;

    // Stored rows are re-validated on the way out: a schema change must
    // surface here rather than as a render crash in the editor.
    const parsed = CatalogDocument.safeParse(JSON.parse(row.document));
    return parsed.success ? parsed.data : null;
  }

  /**
   * Write a catalogue. Refuses to write into another brand's row, and
   * refuses a document whose own `brandId` disagrees with the scope it
   * arrived under.
   */
  save(brandId: string, document: CatalogDocument, label = ''): CatalogDocument {
    if (document.brandId !== brandId) {
      throw new Error(`document belongs to ${document.brandId}, not ${brandId}`);
    }

    const existing = this.db
      .prepare('SELECT brand_id FROM catalogs WHERE id = ?')
      .get(document.id) as { brand_id: string } | undefined;
    if (existing && existing.brand_id !== brandId) {
      throw new Error(`catalogue ${document.id} belongs to another chain`);
    }

    const now = new Date().toISOString();
    const next = { ...document, updatedAt: now };
    const json = JSON.stringify(next);

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO catalogs (id, brand_id, name, document, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             document = excluded.document,
             updated_at = excluded.updated_at`,
        )
        .run(next.id, brandId, next.name, json, next.createdAt, now);

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

  remove(brandId: string, id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM catalogs WHERE id = ? AND brand_id = ?')
      .run(id, brandId);
    if (Number(info.changes) === 0) return false;
    this.db.prepare('DELETE FROM catalog_versions WHERE catalog_id = ?').run(id);
    return true;
  }

  versions(brandId: string, id: string): { version: number; label: string; createdAt: string }[] {
    // Joined rather than queried directly: the version table has no
    // brand of its own, and an unscoped read of it would leak the edit
    // history of a catalogue this session cannot open.
    const rows = this.db
      .prepare(
        `SELECT v.version, v.label, v.created_at
         FROM catalog_versions v
         JOIN catalogs c ON c.id = v.catalog_id
         WHERE v.catalog_id = ? AND c.brand_id = ?
         ORDER BY v.version DESC`,
      )
      .all(id, brandId) as Record<string, unknown>[];

    return rows.map((row) => ({
      version: Number(row['version']),
      label: String(row['label']),
      createdAt: String(row['created_at']),
    }));
  }

  close(): void {
    this.db.close();
  }
}
