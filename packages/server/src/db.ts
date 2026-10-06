import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogDocument, CatalogPage, Offer, OfferRules, PageTemplate, OfferDesigns, Themes, type OfferDesign } from '@incitio/schema';
import { z } from 'zod';
import { lanesOf } from '@incitio/workflow';
import { migrate } from './migrations.js';
import { Accounts } from './auth.js';

/*
 * Storage for the studio.
 *
 * Documents are stored whole, as JSON, rather than decomposed into
 * relational tables. `CatalogDocument` is the unit the editor mutates
 * and the unit the renderer reads; shredding it into pages and
 * placements would buy query flexibility nobody needs and cost a schema
 * migration every time the layout model gains a field.
 *
 * Every read and write is scoped by brand — see the note on `get`. The
 * tables themselves, and every change to them, are in `migrations.ts`.
 */

/**
 * One saved page design.
 *
 * `page` is the design with last week's products still in it, and
 * `preview` is those products — kept so the gallery can show the page
 * as it printed, which is how anyone recognises a design. Using the
 * section never uses them: the cells are dealt from this week's feed.
 * `template` travels along when the grid was the document's own (read
 * off a publication), since it is in no chain's vocabulary.
 */
export const Section = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  page: CatalogPage,
  template: PageTemplate.nullable().default(null),
  preview: z.array(Offer).max(40).default([]),
  createdAt: z.string().default(''),
  /** Counts up on every save under the same id, so pages made from it can tell they are behind. */
  version: z.number().int().min(1).default(1),
  updatedAt: z.string().default(''),
});
export type Section = z.infer<typeof Section>;

export interface CatalogSummary {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** What the front page sorts and says by — read off the stored document. */
  week: { year: number; week: number } | null;
  pages: number;
  offers: number;
  status: 'kladde' | 'klar' | 'udgivet' | 'skjult';
  /**
   * The roles whose signature still holds — signed, and nothing they
   * answer for changed since. A signature that has gone stale is in
   * `stale` instead, so the front page never counts one.
   */
  approvals: string[];
  stale: string[];
  /** Places sold, and what they were sold for. */
  sold: number;
  soldFor: number;
  /** Changes made after it went out. */
  live: number;
}

/** One picture in a chain's own library. */
export interface UploadSummary {
  ref: string;
  name: string;
  createdAt: string;
}

/** The label an automatic save carries — see `Store.save`. */
export const AUTO_LABEL = 'auto';
const AUTO_FOLD_MS = 10 * 60 * 1000;

/** Somebody saved the catalogue after the saver last read it. */
export class SaveConflict extends Error {
  constructor(readonly updatedAt: string) {
    super('the catalogue was saved by someone else in the meantime');
  }
}

export class Store {
  private readonly db: DatabaseSync;
  /** Who may sign in, and to which chains — see `auth.ts`. */
  readonly accounts: Accounts;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    migrate(this.db);
    this.accounts = new Accounts(this.db);
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

  /**
   * This chain's section designs, in the order they were saved — which
   * for a library started from an avis is the avis's own page order.
   * Never another chain's.
   */
  sections(brandId: string): Section[] {
    return this.db
      .prepare('SELECT section FROM sections WHERE brand_id = ? ORDER BY created_at, rowid')
      .all(brandId)
      .map((row) => Section.safeParse(JSON.parse(row['section'] as string)))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data!);
  }

  /** Save a section, refusing to overwrite another chain's id. */
  saveSection(brandId: string, section: Section): Section {
    const existing = this.db.prepare('SELECT brand_id, section FROM sections WHERE id = ?')
      .get(section.id) as { brand_id: string; section: string } | undefined;
    if (existing && existing.brand_id !== brandId) {
      throw new Error(`section ${section.id} belongs to another chain`);
    }
    const before = existing ? Section.safeParse(JSON.parse(existing.section)) : null;
    const now = new Date().toISOString();
    const next = {
      ...section,
      createdAt: before?.success ? before.data.createdAt : section.createdAt || now,
      // The store counts, not the caller: two editors saving the same design both move it on.
      version: before?.success ? before.data.version + 1 : 1,
      updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO sections (id, brand_id, name, section, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, section = excluded.section`,
    ).run(next.id, brandId, next.name, JSON.stringify(next), next.createdAt);
    return next;
  }

  /** The chain's offer rules, or null when it has never saved any. */
  offerRules(brandId: string): OfferRules | null {
    const row = this.db.prepare('SELECT rules FROM offer_rules WHERE brand_id = ?').get(brandId) as
      { rules: string } | undefined;
    if (!row) return null;
    const parsed = OfferRules.safeParse(JSON.parse(row.rules));
    return parsed.success ? parsed.data : null;
  }

  /** The chain's offer designs and its default tag, or null when it has never saved any. */
  offerDesigns(brandId: string): { designs: OfferDesign[]; tag: string | null } | null {
    const row = this.db.prepare('SELECT designs, design_tag FROM offer_designs WHERE brand_id = ?').get(brandId) as
      { designs: string; design_tag: string | null } | undefined;
    if (!row) return null;
    const parsed = OfferDesigns.safeParse(JSON.parse(row.designs));
    return parsed.success ? { designs: parsed.data, tag: row.design_tag } : null;
  }

  saveOfferDesigns(brandId: string, designs: OfferDesign[], tag: string | null): { designs: OfferDesign[]; tag: string | null } {
    this.db.prepare(
      `INSERT INTO offer_designs (brand_id, designs, design_tag, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (brand_id) DO UPDATE SET designs = excluded.designs, design_tag = excluded.design_tag, updated_at = excluded.updated_at`,
    ).run(brandId, JSON.stringify(designs), tag, new Date().toISOString());
    return { designs, tag };
  }

  saveOfferRules(brandId: string, rules: OfferRules): OfferRules {
    this.db.prepare(
      `INSERT INTO offer_rules (brand_id, rules, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (brand_id) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at`,
    ).run(brandId, JSON.stringify(rules), new Date().toISOString());
    return rules;
  }

  themes(brandId: string): Themes {
    const row = this.db.prepare('SELECT themes FROM themes WHERE brand_id = ?').get(brandId) as { themes: string } | undefined;
    if (!row) return [];
    const parsed = Themes.safeParse(JSON.parse(row.themes));
    return parsed.success ? parsed.data : [];
  }

  saveThemes(brandId: string, themes: Themes): Themes {
    this.db.prepare(
      `INSERT INTO themes (brand_id, themes, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (brand_id) DO UPDATE SET themes = excluded.themes, updated_at = excluded.updated_at`,
    ).run(brandId, JSON.stringify(themes), new Date().toISOString());
    return themes;
  }

  removeSection(brandId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM sections WHERE id = ? AND brand_id = ?')
      .run(id, brandId).changes > 0;
  }

  list(brandId: string): CatalogSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, brand_id, name, created_at, updated_at, document
         FROM catalogs WHERE brand_id = ? ORDER BY updated_at DESC`,
      )
      .all(brandId) as Record<string, string>[];

    return rows.map((row) => {
      let read: {
        week?: { year: number; week: number }; pages?: unknown[]; offers?: unknown[]; status?: CatalogSummary['status'];
        approvals?: { role: string }[]; bookings?: { price: number }[]; live?: unknown[];
      } = {};
      try { read = JSON.parse(row['document'] as string); } catch { /* listed by name alone */ }
      // Only an avis with signatures is worth the full read; the rest list from the raw JSON.
      const parsed = read.approvals?.length ? CatalogDocument.safeParse(read) : null;
      const lanes = parsed?.success ? lanesOf(parsed.data) : [];
      return {
        id: row['id'] as string,
        brandId: row['brand_id'] as string,
        name: row['name'] as string,
        createdAt: row['created_at'] as string,
        updatedAt: row['updated_at'] as string,
        week: read.week ?? null,
        pages: read.pages?.length ?? 0,
        offers: read.offers?.length ?? 0,
        status: read.status ?? 'kladde',
        approvals: lanes.filter((lane) => lane.state === 'godkendt').map((lane) => lane.role),
        stale: lanes.filter((lane) => lane.state === 'forældet').map((lane) => lane.role),
        sold: read.bookings?.length ?? 0,
        soldFor: (read.bookings ?? []).reduce((sum, b) => sum + (b.price ?? 0), 0),
        live: read.live?.length ?? 0,
      };
    });
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
  save(
    brandId: string,
    document: CatalogDocument,
    label = '',
    /*
     * `expected`: the `updatedAt` the saver last saw. When the stored
     * one differs, somebody else saved in between, and writing now would
     * quietly throw their work away — refused with `SaveConflict`.
     */
    options: { expected?: string } = {},
  ): CatalogDocument {
    if (document.brandId !== brandId) {
      throw new Error(`document belongs to ${document.brandId}, not ${brandId}`);
    }

    const now = new Date().toISOString();
    const next = { ...document, updatedAt: now };
    const json = JSON.stringify(next);

    /*
     * IMMEDIATE: the write lock is taken before the check, so the check
     * and the write are one step even with a second process on the file.
     */
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare('SELECT brand_id, updated_at FROM catalogs WHERE id = ?')
        .get(document.id) as { brand_id: string; updated_at: string } | undefined;
      if (existing && existing.brand_id !== brandId) {
        throw new Error(`catalogue ${document.id} belongs to another chain`);
      }
      if (existing && options.expected && existing.updated_at !== options.expected) {
        throw new SaveConflict(existing.updated_at);
      }
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

      const last = this.db
        .prepare(
          `SELECT version, label, created_at FROM catalog_versions
           WHERE catalog_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(next.id) as { version: number; label: string; created_at: string } | undefined;

      /*
       * Saving as you work writes every few seconds; a version each time
       * would bury the history in near-identical rows. An automatic save
       * within ten minutes of the last automatic one replaces it, so the
       * history keeps one point per stretch of work — and every named
       * save ("Gemt", "til tryk") stays a point of its own.
       */
      const folds = label === AUTO_LABEL && last?.label === AUTO_LABEL
        && Date.parse(now) - Date.parse(last.created_at) < AUTO_FOLD_MS;
      if (folds) {
        this.db
          .prepare('UPDATE catalog_versions SET document = ?, created_at = ? WHERE catalog_id = ? AND version = ?')
          .run(json, now, next.id, last!.version);
      } else {
        this.db
          .prepare(
            `INSERT INTO catalog_versions (catalog_id, version, document, label, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(next.id, Number(last?.version ?? 0) + 1, json, label, now);
      }

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

  /**
   * The number the next named save of this catalogue will be stored as.
   * Named saves are never folded, so this is exact as long as nothing
   * is awaited between asking and saving — which is how a signature
   * names the version it is.
   */
  nextVersion(id: string): number {
    const last = this.db
      .prepare('SELECT MAX(version) AS version FROM catalog_versions WHERE catalog_id = ?')
      .get(id) as { version: number | null } | undefined;
    return Number(last?.version ?? 0) + 1;
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

  /** One version's document, scoped to the chain as `versions` is. */
  version(brandId: string, id: string, version: number): CatalogDocument | null {
    const row = this.db
      .prepare(
        `SELECT v.document FROM catalog_versions v
         JOIN catalogs c ON c.id = v.catalog_id
         WHERE v.catalog_id = ? AND v.version = ? AND c.brand_id = ?`,
      )
      .get(id, version, brandId) as { document: string } | undefined;
    return row ? CatalogDocument.parse(JSON.parse(row.document)) : null;
  }

  close(): void {
    this.db.close();
  }
}
