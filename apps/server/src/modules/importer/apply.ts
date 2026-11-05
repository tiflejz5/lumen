import {
  canonicalJson,
  uuidv7,
  type ImportListItem,
  type ImportReport,
  type ReportItem,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import { setMeta } from '../topics/repo.ts';
import type { Staged } from './preview.ts';

export type { ImportReport, ReportItem };

export class ImportApplyError extends Error {
  code: 'bad_selection' | 'blocked';
  constructor(code: ImportApplyError['code'], message: string) {
    super(message);
    this.name = 'ImportApplyError';
    this.code = code;
  }
}

export type ApplyOptions = {
  db: Db;
  staged: Staged;
  selectedIds: string[];
  now: Date;
  /** Kopia zapasowa wykonywana tuż przed zapisem; zwraca nazwę pliku kopii. */
  snapshot: () => Promise<string | null>;
};

/**
 * Zapisuje zatwierdzone zmiany w jednej transakcji. Nigdy nie dotyka danych użytkownika
 * (topic_user_state, daily_assignments). Przed zapisem powstaje kopia zapasowa.
 */
export async function applyImport(options: ApplyOptions): Promise<ImportReport> {
  const { db, staged, now } = options;
  const { release, preview } = staged;
  if (preview.blocked)
    throw new ImportApplyError('blocked', 'Import jest zablokowany przez błędy krytyczne.');

  const byId = new Map(preview.topics.map((t) => [t.id, t]));
  const selected = new Set(options.selectedIds);
  for (const id of selected) {
    const t = byId.get(id);
    if (!t || !t.selectable)
      throw new ImportApplyError('bad_selection', `Temat „${id}” nie może zostać zaimportowany.`);
  }

  const snapshot = await options.snapshot();
  const importId = uuidv7();
  const stamp = now.toISOString();
  const items: ReportItem[] = [];
  const summary: ImportReport['summary'] = {
    imported: 0,
    inserted: 0,
    updated: 0,
    refreshed: 0,
    notSelected: 0,
    rejected: 0,
    unchanged: 0,
    sourcesWritten: 0,
    catalogWritten: 0,
  };

  const upsertTopic = db.prepare(`
    INSERT INTO topics (id, slug, title, category, subcategory, difficulty_level, topic_type, status, revision, content_hash,
                        last_verified_at, review_interval_months, is_example, data, imported_at, updated_at)
    VALUES (@id, @slug, @title, @category, @subcategory, @level, @type, @status, @revision, @hash, @verified, @interval, @example, @data, @at, @at)
    ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, category = excluded.category,
      subcategory = excluded.subcategory, difficulty_level = excluded.difficulty_level, topic_type = excluded.topic_type,
      status = excluded.status, revision = excluded.revision, content_hash = excluded.content_hash,
      last_verified_at = excluded.last_verified_at, review_interval_months = excluded.review_interval_months,
      is_example = excluded.is_example, data = excluded.data, updated_at = excluded.updated_at`);
  const insertVersion = db.prepare(
    'INSERT OR IGNORE INTO topic_versions (topic_id, content_hash, revision, data, import_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const deleteRelations = db.prepare('DELETE FROM topic_relations WHERE from_id = ?');
  const insertRelation = db.prepare(
    'INSERT OR IGNORE INTO topic_relations (from_id, to_id, kind) VALUES (?, ?, ?)',
  );
  const upsertSource = db.prepare(
    'INSERT INTO sources (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  );
  const upsertCatalog = db.prepare(`
    INSERT INTO catalog_entries (id, title, category, subcategory, difficulty, topic_type, current_subtype, question_type, mainstream, region, catalog_version, imported_at)
    VALUES (@id, @title, @category, @subcategory, @difficulty, @topic_type, @current_subtype, @question_type, @mainstream, @region, @version, @at)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, category = excluded.category, subcategory = excluded.subcategory,
      difficulty = excluded.difficulty, topic_type = excluded.topic_type, current_subtype = excluded.current_subtype,
      question_type = excluded.question_type, mainstream = excluded.mainstream, region = excluded.region,
      catalog_version = excluded.catalog_version, imported_at = excluded.imported_at`);

  db.transaction(() => {
    // Dane wydania: taksonomia, rejestr źródeł (zastąpienie rekordów po ID), katalog tytułów.
    if (release.taxonomyRaw) {
      setMeta(db, 'taxonomy', JSON.stringify(release.taxonomyRaw));
      if (release.taxonomyVersion) setMeta(db, 'taxonomy_version', release.taxonomyVersion);
    }
    if (release.baseVersion) setMeta(db, 'base_version', release.baseVersion);
    if (release.schemaVersion) setMeta(db, 'schema_version', release.schemaVersion);
    for (const s of release.sources ?? []) {
      upsertSource.run(s.id, JSON.stringify(s), stamp);
      summary.sourcesWritten += 1;
    }
    for (const e of release.catalog?.entries ?? []) {
      upsertCatalog.run({
        id: e.id,
        title: e.title,
        category: e.category,
        subcategory: e.subcategory,
        difficulty: e.difficulty,
        topic_type: e.topic_type,
        current_subtype: e.current_subtype ?? null,
        question_type: e.question_type ?? null,
        mainstream: e.mainstream === undefined ? null : e.mainstream ? 1 : 0,
        region: e.region ?? null,
        version: release.catalog!.version,
        at: stamp,
      });
      summary.catalogWritten += 1;
    }

    for (const parsed of release.topics) {
      const p = byId.get(parsed.id);
      if (!p) continue;
      const item: ReportItem = { id: p.id, title: p.title, action: p.action, decision: 'skipped' };
      if (p.action === 'invalid') {
        item.decision = 'rejected';
        item.note = p.errors[0] ?? 'rekord nieprawidłowy';
        summary.rejected += 1;
      } else if (p.action === 'unchanged') {
        summary.unchanged += 1;
      } else if (!p.selectable) {
        item.note =
          p.action === 'older'
            ? 'lokalna rewizja jest nowsza'
            : 'temat przykładowy nie zastępuje prawdziwego';
      } else if (!selected.has(p.id)) {
        item.decision = 'not_selected';
        summary.notSelected += 1;
      } else {
        const record = parsed.record!;
        upsertTopic.run({
          id: record.id,
          slug: record.slug,
          title: record.core.title,
          category: record.core.category,
          subcategory: record.core.subcategory,
          level: record.core.difficulty.level,
          type: record.core.topic_type,
          status: record.status,
          revision: record.revision,
          hash: parsed.contentHash,
          verified: record.freshness.last_verified_at,
          interval: record.freshness.review_interval_months,
          example: parsed.isExample ? 1 : 0,
          data: JSON.stringify(parsed.raw),
          at: stamp,
        });
        insertVersion.run(
          record.id,
          parsed.contentHash,
          record.revision,
          JSON.stringify(parsed.raw),
          importId,
          stamp,
        );
        deleteRelations.run(record.id);
        for (const kind of ['prerequisites', 'related', 'next'] as const) {
          for (const to of record.relations[kind]) insertRelation.run(record.id, to, kind);
        }
        item.decision = 'imported';
        summary.imported += 1;
        if (p.action === 'new') summary.inserted += 1;
        else if (p.action === 'refresh') summary.refreshed += 1;
        else summary.updated += 1;
        if (p.action === 'conflict')
          item.note = 'zatwierdzono mimo konfliktu wersji (ta sama rewizja, inna treść)';
        if (p.replacesExample) item.note = 'zastąpiono temat przykładowy';
      }
      items.push(item);
    }

    const report: Omit<ImportReport, 'id' | 'createdAt'> = {
      mode: release.mode,
      baseVersion: release.baseVersion,
      schemaVersion: release.schemaVersion,
      summary,
      snapshot,
      items,
      notes: release.notes,
      warnings: [
        ...release.warnings,
        ...preview.missingLocal.map(
          (id) =>
            `Temat ${id} jest w bazie lokalnej, ale nie ma go w tym wydaniu (nie zostanie usunięty).`,
        ),
      ],
    };
    db.prepare(
      'INSERT INTO imports (id, created_at, mode, base_version, schema_version, summary, report, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      importId,
      stamp,
      release.mode,
      release.baseVersion,
      release.schemaVersion,
      canonicalJson(summary),
      JSON.stringify(report),
      snapshot,
    );
  })();

  return {
    id: importId,
    createdAt: stamp,
    mode: release.mode,
    baseVersion: release.baseVersion,
    schemaVersion: release.schemaVersion,
    summary,
    snapshot,
    items,
    notes: release.notes,
    warnings: [
      ...release.warnings,
      ...preview.missingLocal.map(
        (id) =>
          `Temat ${id} jest w bazie lokalnej, ale nie ma go w tym wydaniu (nie zostanie usunięty).`,
      ),
    ],
  };
}

export function listImports(db: Db): ImportListItem[] {
  const rows = db
    .prepare(
      'SELECT id, created_at, mode, base_version, summary FROM imports ORDER BY created_at DESC LIMIT 100',
    )
    .all() as {
    id: string;
    created_at: string;
    mode: string;
    base_version: string | null;
    summary: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode,
    baseVersion: r.base_version,
    summary: JSON.parse(r.summary) as ImportReport['summary'],
  }));
}

export function getImportReport(db: Db, id: string): ImportReport | null {
  const row = db.prepare('SELECT id, created_at, report FROM imports WHERE id = ?').get(id) as
    { id: string; created_at: string; report: string } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    ...(JSON.parse(row.report) as Omit<ImportReport, 'id' | 'createdAt'>),
  };
}
