import { uuidv7 } from '@lumen/core';
import type { Db } from './connection.ts';
import { migrate, type MigrateResult } from './migrate.ts';

/** Migruje schemat i dba o stałe metadane (identyfikator urządzenia pod przyszłą synchronizację). */
export async function bootstrapDatabase(
  db: Db,
  hooks: { beforeMigrate?: (from: number, to: number) => Promise<void> } = {},
): Promise<MigrateResult> {
  const result = await migrate(db, hooks);
  const insert = db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');
  insert.run('device_id', uuidv7());
  insert.run('created_at', new Date().toISOString());
  return result;
}

export function getDeviceId(db: Db): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'device_id'").get() as
    { value: string } | undefined;
  if (!row) throw new Error('Brak device_id w bazie.');
  return row.value;
}
