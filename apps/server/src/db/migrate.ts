import { readdirSync, readFileSync } from 'node:fs';
import type { Db } from './connection.ts';

export type Migration = { version: number; name: string; sql: string };

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export function loadMigrations(dir: URL = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const migrations = files.map((file) => ({
    version: Number(file.slice(0, 3)),
    name: file,
    sql: readFileSync(new URL(file, dir), 'utf8'),
  }));
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`Migracje muszą być ciągłe: oczekiwano ${i + 1}, jest ${m.name}`);
  });
  return migrations;
}

export function currentVersion(db: Db): number {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!exists) return 0;
  const row = db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

export class NewerDatabaseError extends Error {
  constructor(found: number, supported: number) {
    super(
      `Baza ma schemat w wersji ${found}, a ta wersja aplikacji obsługuje najwyżej ${supported}. ` +
        'Zaktualizuj aplikację – bazy nie zostały zmienione.',
    );
    this.name = 'NewerDatabaseError';
  }
}

export type MigrateResult = { from: number; to: number; applied: string[] };

/**
 * Stosuje brakujące migracje. `beforeMigrate` jest wywoływane tylko wtedy, gdy baza zawiera już dane
 * (wersja > 0) i są migracje do zastosowania – to miejsce na snapshot zabezpieczający.
 */
export async function migrate(
  db: Db,
  options: {
    migrations?: Migration[];
    beforeMigrate?: (from: number, to: number) => Promise<void>;
  } = {},
): Promise<MigrateResult> {
  const migrations = options.migrations ?? loadMigrations();
  const latest = migrations.length;
  const from = currentVersion(db);
  if (from > latest) throw new NewerDatabaseError(from, latest);
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  if (from > 0 && options.beforeMigrate) await options.beforeMigrate(from, latest);

  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT',
  );
  const applied: string[] = [];
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      applied.push(m.name);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migracja ${m.name} nie powiodła się: ${(error as Error).message}`);
    }
  }
  return { from, to: latest, applied };
}
