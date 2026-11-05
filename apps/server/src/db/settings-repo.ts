import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsPatch } from '@lumen/core';
import type { Db } from './connection.ts';

export function readSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // uszkodzona wartość → zostaje domyślna
    }
  }
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export function writeSettings(db: Db, patch: SettingsPatch): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) upsert.run(key, JSON.stringify(value), now);
    }
  })();
  return readSettings(db);
}
