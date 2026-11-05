import {
  USER_DATA_FORMAT,
  USER_DATA_VERSION,
  type UserDataImportReport,
  type UserDataTableReport,
} from '@lumen/core';
import { z } from 'zod';
import type { Db } from '../../db/connection.ts';
import { getDeviceId } from '../../db/bootstrap.ts';
import { StudyError } from '../sessions/sessions.ts';

/**
 * Dane użytkownika (bez treści bazy tematów, która pochodzi z paczek). Każda tabela ma klucz główny
 * i sposób scalania:
 *  - `lww`      – wygrywa nowszy `updated_at` (ostatni zapis wygrywa),
 *  - `ignore`   – wiersze niezmienne (dzienniki): dopisujemy brakujące,
 *  - `earliest` – zostaje wcześniejsza data.
 */
type Spec = {
  table: string;
  pk: string[];
  columns: string[];
  mode: 'lww' | 'ignore' | 'earliest';
};

const SPECS: Spec[] = [
  {
    table: 'topic_user_state',
    pk: ['topic_id'],
    columns: ['topic_id', 'status', 'postponed_until', 'deepen', 'status_date', 'updated_at'],
    mode: 'lww',
  },
  {
    table: 'daily_assignments',
    pk: ['date'],
    columns: ['date', 'topic_id', 'category', 'explanation', 'assigned_at'],
    mode: 'ignore',
  },
  {
    table: 'study_sessions',
    pk: ['id'],
    columns: [
      'id',
      'topic_id',
      'date',
      'is_daily',
      'stage',
      'status',
      'started_at',
      'finished_at',
      'active_seconds',
      'outcome',
      'interest',
      'difficulty_rating',
      'confidence',
      'updated_at',
    ],
    mode: 'lww',
  },
  {
    table: 'quiz_answers',
    pk: ['session_id', 'question_id'],
    columns: ['session_id', 'question_id', 'answer', 'correct', 'answered_at'],
    mode: 'ignore',
  },
  {
    table: 'notes',
    pk: ['id'],
    columns: [
      'id',
      'topic_id',
      'session_id',
      'kind',
      'body',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    mode: 'lww',
  },
  {
    table: 'knowledge_entries',
    pk: ['id'],
    columns: [
      'id',
      'term',
      'term_key',
      'definition',
      'topic_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    mode: 'lww',
  },
  {
    table: 'review_items',
    pk: ['topic_id'],
    columns: [
      'topic_id',
      'stage',
      'due_date',
      'reps',
      'lapses',
      'last_reviewed',
      'created_at',
      'updated_at',
    ],
    mode: 'lww',
  },
  {
    table: 'review_log',
    pk: ['id'],
    columns: ['id', 'topic_id', 'date', 'rating', 'stage_before', 'stage_after', 'reviewed_at'],
    mode: 'ignore',
  },
  { table: 'badges', pk: ['id'], columns: ['id', 'unlocked_at'], mode: 'earliest' },
];

export type UserDataFile = {
  format: typeof USER_DATA_FORMAT;
  version: number;
  exportedAt: string;
  deviceId: string;
  tables: Record<string, Record<string, unknown>[]>;
};

export function exportUserData(db: Db, now: Date): UserDataFile {
  const tables: UserDataFile['tables'] = {};
  for (const spec of SPECS)
    tables[spec.table] = db
      .prepare(`SELECT ${spec.columns.join(', ')} FROM ${spec.table}`)
      .all() as Record<string, unknown>[];
  return {
    format: USER_DATA_FORMAT,
    version: USER_DATA_VERSION,
    exportedAt: now.toISOString(),
    deviceId: getDeviceId(db),
    tables,
  };
}

const cell = z.union([z.string().max(100_000), z.number(), z.null()]);
export const userDataSchema = z
  .object({
    format: z.literal(USER_DATA_FORMAT),
    version: z.number().int().min(1).max(USER_DATA_VERSION),
    exportedAt: z.string().max(40),
    deviceId: z.string().max(80).optional(),
    tables: z.record(z.string(), z.array(z.record(z.string(), cell)).max(200_000)),
  })
  .strict();

const empty = (): UserDataTableReport => ({ inserted: 0, updated: 0, unchanged: 0, skipped: 0 });

/** Scala dane z pliku eksportu z lokalną bazą. Wywołujący odpowiada za kopię zapasową przed importem. */
export function importUserData(db: Db, raw: unknown): UserDataImportReport {
  const parsed = userDataSchema.safeParse(raw);
  if (!parsed.success)
    throw new StudyError(
      'bad_user_data',
      'To nie jest poprawny plik danych Lumen (eksport z Ustawień).',
    );
  const file = parsed.data;
  const report: UserDataImportReport = { exportedAt: file.exportedAt, tables: {}, notes: [] };
  const topics = new Set(
    (db.prepare('SELECT id FROM topics').all() as { id: string }[]).map((r) => r.id),
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const spec of SPECS) {
      const r = (report.tables[spec.table] = empty());
      const rows = file.tables[spec.table] ?? [];
      const find = db.prepare(
        `SELECT * FROM ${spec.table} WHERE ${spec.pk.map((k) => `${k} = ?`).join(' AND ')}`,
      );
      const insert = db.prepare(
        `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${spec.columns.map(() => '?').join(', ')})`,
      );
      const update = db.prepare(
        `UPDATE ${spec.table} SET ${spec.columns
          .filter((c) => !spec.pk.includes(c))
          .map((c) => `${c} = ?`)
          .join(', ')} WHERE ${spec.pk.map((k) => `${k} = ?`).join(' AND ')}`,
      );
      for (const row of rows) {
        const values = spec.columns.map((c) => row[c] ?? null);
        const topicId = row['topic_id'];
        // Wiersz powiązany z tematem, którego nie ma w lokalnej bazie, pomijamy (tematy pochodzą z paczek).
        if (typeof topicId === 'string' && !topics.has(topicId)) {
          if (spec.table === 'knowledge_entries') values[spec.columns.indexOf('topic_id')] = null;
          else {
            r.skipped++;
            continue;
          }
        }
        if (spec.table === 'notes' && row['session_id']) {
          const known = db
            .prepare('SELECT 1 FROM study_sessions WHERE id = ?')
            .get(row['session_id']);
          if (!known) values[spec.columns.indexOf('session_id')] = null;
        }
        if (spec.table === 'quiz_answers') {
          const known = db
            .prepare('SELECT 1 FROM study_sessions WHERE id = ?')
            .get(row['session_id']);
          if (!known) {
            r.skipped++;
            continue;
          }
        }
        try {
          const key = spec.pk.map((k) => row[k] ?? null);
          const existing = find.get(...key) as Record<string, unknown> | undefined;
          if (!existing) {
            insert.run(...values);
            r.inserted++;
          } else if (spec.mode === 'lww') {
            const incoming = String(row['updated_at'] ?? '');
            const local = String(existing['updated_at'] ?? '');
            if (incoming > local) {
              update.run(
                ...spec.columns.filter((c) => !spec.pk.includes(c)).map((c) => row[c] ?? null),
                ...key,
              );
              r.updated++;
            } else r.unchanged++;
          } else if (spec.mode === 'earliest') {
            const incoming = String(row['unlocked_at'] ?? '');
            if (incoming && incoming < String(existing['unlocked_at'])) {
              update.run(incoming, ...key);
              r.updated++;
            } else r.unchanged++;
          } else r.unchanged++;
        } catch {
          // naruszenie ograniczeń (np. duplikat pojęcia, druga aktywna sesja tematu, zła wartość)
          r.skipped++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const skipped = Object.values(report.tables).reduce((n, t) => n + t.skipped, 0);
  if (skipped > 0)
    report.notes.push(
      `Pominięto ${skipped} rekordów: dotyczyły tematów, których nie ma w tej bazie, albo kolidowały z istniejącymi danymi.`,
    );
  return report;
}
