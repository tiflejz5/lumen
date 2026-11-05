import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, type AppPaths } from '../config.ts';
import { createBackup } from '../modules/backup/backup.ts';
import {
  drawExtra,
  getDaily,
  setTopicState,
  currentDate,
  type DailyContext,
} from '../modules/daily/daily.ts';
import {
  applyImport,
  getImportReport,
  listImports,
  ImportApplyError,
} from '../modules/importer/apply.ts';
import { buildPreview } from '../modules/importer/preview.ts';
import type { ImportStaging } from '../modules/importer/staging.ts';
import {
  getMeta,
  getSources,
  getTaxonomyRaw,
  listTopics,
  needsReview,
} from '../modules/topics/repo.ts';
import type { AppSession } from '../session/app-session.ts';

const TOPIC_ID = /^(fin|nau|zdr|his|psy|ogo)-\d{4}$/;
const topicIdParam = z.object({ id: z.string().regex(TOPIC_ID) });

const previewBody = z
  .object({
    files: z
      .array(z.object({ path: z.string().min(1).max(400), data: z.string().max(60_000_000) }))
      .min(1)
      .max(200),
    includeExamples: z.boolean().default(false),
  })
  .strict();
const applyBody = z
  .object({
    token: z.string().min(10).max(64),
    topicIds: z.array(z.string().regex(TOPIC_ID)).max(5000),
  })
  .strict();
const tokenBody = z.object({ token: z.string().min(10).max(64) }).strict();
const stateBody = z
  .object({
    status: z
      .enum(['in_progress', 'completed', 'skipped', 'postponed', 'known', 'not_interesting'])
      .nullable(),
    postponeDays: z.number().int().min(1).max(365).optional(),
    deepen: z.boolean().optional(),
  })
  .strict();
const listQuery = z.object({
  query: z.string().max(100).optional(),
  category: z.string().max(40).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  topicType: z.enum(['timeless', 'current']).optional(),
  status: z.enum(['active', 'deprecated']).optional(),
  userStatus: z
    .enum(['new', 'in_progress', 'completed', 'skipped', 'postponed', 'known', 'not_interesting'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ContentRouteDeps = {
  session: AppSession;
  paths: AppPaths;
  staging: ImportStaging;
  now: () => Date;
};

export function registerContentRoutes(app: FastifyInstance, deps: ContentRouteDeps): void {
  const { session, paths, staging } = deps;

  const dailyContext = (): DailyContext => {
    const { db } = session.requireUnlocked();
    const settings = session.currentSettings;
    return {
      db,
      now: deps.now(),
      dayStartHour: settings.dayStartHour,
      demoMode: settings.demoMode,
    };
  };
  const today = () => currentDate(dailyContext());

  // ── import ───────────────────────────────────────────────────────────────────────────────────
  app.post('/api/import/preview', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const body = previewBody.parse(req.body);
    const { db } = session.requireUnlocked();
    const files = body.files.map((f) => ({ path: f.path, bytes: Buffer.from(f.data, 'base64') }));
    const staged = buildPreview(db, files, {
      includeExamples: body.includeExamples,
      today: today(),
    });
    staging.put(staged);
    return staged.preview;
  });

  app.post('/api/import/apply', async (req, reply) => {
    const body = applyBody.parse(req.body);
    const { db, dek, vault } = session.requireUnlocked();
    const staged = staging.get(body.token);
    if (!staged) {
      return reply
        .code(410)
        .send({
          error: 'import_expired',
          message: 'Podgląd importu wygasł. Wybierz pliki ponownie.',
        });
    }
    try {
      const report = await applyImport({
        db,
        staged,
        selectedIds: body.topicIds,
        now: deps.now(),
        snapshot: async () =>
          (
            await createBackup({
              db,
              dek,
              vault,
              dir: paths.backupsDir,
              kind: 'pre-operation',
              label: 'przed importem',
              appVersion: APP_VERSION,
            })
          ).name,
      });
      staging.delete(body.token);
      return report;
    } catch (error) {
      if (error instanceof ImportApplyError)
        return reply.code(400).send({ error: error.code, message: error.message });
      throw error;
    }
  });

  app.post('/api/import/cancel', async (req) => {
    staging.delete(tokenBody.parse(req.body).token);
    return { ok: true };
  });

  app.get('/api/imports', async () => ({ imports: listImports(session.requireUnlocked().db) }));

  app.get('/api/imports/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const report = getImportReport(session.requireUnlocked().db, id);
    return (
      report ??
      reply.code(404).send({ error: 'not_found', message: 'Nie znaleziono raportu importu.' })
    );
  });

  // ── baza tematów ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/taxonomy', async () => ({
    taxonomy: getTaxonomyRaw(session.requireUnlocked().db),
  }));

  app.get('/api/content', async () => {
    const { db } = session.requireUnlocked();
    const demo = session.currentSettings.demoMode;
    const group = (column: string) =>
      Object.fromEntries(
        (
          db
            .prepare(
              `SELECT ${column} AS k, count(*) AS c FROM topics WHERE status = 'active' ${demo ? '' : 'AND is_example = 0'} GROUP BY ${column}`,
            )
            .all() as { k: string; c: number }[]
        ).map((r) => [r.k, r.c]),
      );
    const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    const catalogTotal = count('SELECT count(*) AS c FROM catalog_entries');
    return {
      baseVersion: getMeta(db, 'base_version'),
      schemaVersion: getMeta(db, 'schema_version'),
      taxonomyVersion: getMeta(db, 'taxonomy_version'),
      topics: {
        active: count(
          `SELECT count(*) AS c FROM topics WHERE status = 'active' ${demo ? '' : 'AND is_example = 0'}`,
        ),
        deprecated: count("SELECT count(*) AS c FROM topics WHERE status = 'deprecated'"),
        examples: count('SELECT count(*) AS c FROM topics WHERE is_example = 1'),
        byCategory: group('category'),
        byLevel: group('difficulty_level'),
        byType: group('topic_type'),
      },
      catalog: {
        total: catalogTotal,
        written: count(
          'SELECT count(*) AS c FROM catalog_entries e JOIN topics t ON t.id = e.id WHERE t.is_example = 0',
        ),
      },
      sources: count('SELECT count(*) AS c FROM sources'),
      demoMode: demo,
    };
  });

  app.get('/api/topics', async (req) => {
    const q = listQuery.parse(req.query);
    const { db } = session.requireUnlocked();
    return listTopics(
      db,
      {
        ...(q.query ? { query: q.query } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.level ? { level: q.level } : {}),
        ...(q.topicType ? { topicType: q.topicType } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.userStatus ? { userStatus: q.userStatus } : {}),
        limit: q.limit,
        offset: q.offset,
      },
      today(),
      session.currentSettings.demoMode,
    );
  });

  app.get('/api/topics/:id', async (req, reply) => {
    const { id } = topicIdParam.parse(req.params);
    const { db } = session.requireUnlocked();
    const row = db
      .prepare(
        'SELECT data, is_example, last_verified_at, review_interval_months FROM topics WHERE id = ?',
      )
      .get(id) as
      | {
          data: string;
          is_example: number;
          last_verified_at: string;
          review_interval_months: number | null;
        }
      | undefined;
    if (!row)
      return reply.code(404).send({ error: 'not_found', message: 'Nie znaleziono tematu.' });
    const data = JSON.parse(row.data) as {
      id: string;
      slug: string;
      revision: number;
      status: string;
      superseded_by?: string;
      core: { suggested_sources: { source_id: string }[] } & Record<string, unknown>;
      relations: { prerequisites: string[]; related: string[]; next: string[] };
      freshness: Record<string, unknown>;
      meta: Record<string, unknown>;
      audit: { grade: string };
    };
    const refIds = [
      ...new Set([
        ...data.relations.prerequisites,
        ...data.relations.related,
        ...data.relations.next,
        ...(data.superseded_by ? [data.superseded_by] : []),
      ]),
    ];
    const titleOf = (rid: string) =>
      (
        db.prepare('SELECT title FROM topics WHERE id = ?').get(rid) as
          { title: string } | undefined
      )?.title ??
      (
        db.prepare('SELECT title FROM catalog_entries WHERE id = ?').get(rid) as
          { title: string } | undefined
      )?.title ??
      null;
    const written = new Set(
      (db.prepare('SELECT id FROM topics').all() as { id: string }[]).map((r) => r.id),
    );
    const state = db
      .prepare('SELECT status, postponed_until, deepen FROM topic_user_state WHERE topic_id = ?')
      .get(id) as { status: string; postponed_until: string | null; deepen: number } | undefined;
    // Warstwa rozszerzona, quiz i zadanie wypowiedzi są celowo pomijane: odpowiedzi nie powinny być widoczne przed researchem.
    return {
      id: data.id,
      slug: data.slug,
      revision: data.revision,
      status: data.status,
      supersededBy: data.superseded_by ?? null,
      core: data.core,
      relations: data.relations,
      related: refIds.map((rid) => ({ id: rid, title: titleOf(rid), written: written.has(rid) })),
      freshness: data.freshness,
      meta: data.meta,
      auditGrade: data.audit.grade,
      sources: getSources(
        db,
        data.core.suggested_sources.map((s) => s.source_id),
      ),
      needsReview: needsReview(row.last_verified_at, row.review_interval_months, today()),
      isExample: row.is_example === 1,
      userState: state
        ? {
            status: state.status,
            postponedUntil: state.postponed_until,
            deepen: state.deepen === 1,
          }
        : null,
    };
  });

  app.put('/api/topics/:id/state', async (req, reply) => {
    const { id } = topicIdParam.parse(req.params);
    const body = stateBody.parse(req.body);
    const ctx = dailyContext();
    const exists = ctx.db.prepare('SELECT 1 FROM topics WHERE id = ?').get(id);
    if (!exists)
      return reply.code(404).send({ error: 'not_found', message: 'Nie znaleziono tematu.' });
    const result = setTopicState(ctx, id, {
      status: body.status,
      ...(body.postponeDays !== undefined ? { postponeDays: body.postponeDays } : {}),
      ...(body.deepen !== undefined ? { deepen: body.deepen } : {}),
    });
    return { ok: true, ...result };
  });

  // ── temat dnia ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/daily', async () => getDaily(dailyContext()));

  app.post('/api/daily/extra', async () =>
    drawExtra(dailyContext(), randomBytes(6).toString('hex')),
  );
}
