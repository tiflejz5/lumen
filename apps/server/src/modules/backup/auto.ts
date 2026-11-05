import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BackupHealth, BackupInfo, Settings } from '@lumen/core';
import { APP_VERSION, type AppPaths } from '../../config.ts';
import type { Db } from '../../db/connection.ts';
import type { VaultFile } from '../../vault/vault.ts';
import { createBackup, listBackups } from './backup.ts';

const DAY_MS = 24 * 3_600_000;

function setMeta(db: Db, key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  else db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
function getMeta(db: Db, key: string): string | null {
  return (
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value ?? null
  );
}

export type MirrorResult = { ok: boolean; skipped: boolean; error: string | null };

/** Kopiuje plik kopii do dodatkowego folderu (np. pendrive). Błąd nie przerywa tworzenia kopii. */
export async function mirrorBackup(
  db: Db,
  paths: AppPaths,
  info: BackupInfo,
  settings: Settings,
  now: Date,
): Promise<MirrorResult> {
  const dir = settings.backupMirrorDir.trim();
  if (!dir) return { ok: false, skipped: true, error: null };
  try {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory())
      throw new Error(
        'Folder dodatkowych kopii nie istnieje albo jest niedostępny (np. odłączony pendrive).',
      );
    const target = join(dir, info.name);
    await fs.copyFile(join(paths.backupsDir, info.name), `${target}.tmp`);
    await fs.rename(`${target}.tmp`, target);
    // Porządkowanie: w folderze dodatkowym też zostaje tylko tyle kopii automatycznych, ile w ustawieniach.
    await pruneAuto(dir, settings.autoBackupKeep);
    setMeta(db, 'last_mirror_at', now.toISOString());
    setMeta(db, 'last_mirror_error', null);
    return { ok: true, skipped: false, error: null };
  } catch (error) {
    const message = (error as Error).message;
    setMeta(db, 'last_mirror_error', message);
    return { ok: false, skipped: false, error: message };
  }
}

async function pruneAuto(dir: string, keep: number): Promise<string[]> {
  const autos = (await listBackups(dir)).filter((b) => b.kind === 'auto');
  const removed: string[] = [];
  for (const old of autos.slice(keep)) {
    await fs.unlink(join(dir, old.name)).catch(() => {});
    removed.push(old.name);
  }
  return removed;
}

export type AutoBackupResult = {
  created: BackupInfo | null;
  removed: string[];
  mirror: MirrorResult | null;
  reason: 'created' | 'not_due' | 'disabled';
};

type AutoContext = {
  db: Db;
  dek: Uint8Array;
  vault: VaultFile;
  paths: AppPaths;
  settings: Settings;
  now: Date;
};

/** Wykonuje kopię automatyczną, jeśli od ostatniej kopii (ręcznej lub automatycznej) minęła doba. */
export async function runAutoBackup(ctx: AutoContext): Promise<AutoBackupResult> {
  const { db, dek, vault, paths, settings, now } = ctx;
  if (!settings.autoBackup) return { created: null, removed: [], mirror: null, reason: 'disabled' };
  const existing = await listBackups(paths.backupsDir);
  const last = existing.find((b) => b.kind === 'auto' || b.kind === 'manual');
  if (last && now.getTime() - Date.parse(last.createdAt) < DAY_MS)
    return { created: null, removed: [], mirror: null, reason: 'not_due' };
  const created = await createBackup({
    db,
    dek,
    vault,
    dir: paths.backupsDir,
    kind: 'auto',
    appVersion: APP_VERSION,
    now,
  });
  const removed = await pruneAuto(paths.backupsDir, settings.autoBackupKeep);
  const mirror = await mirrorBackup(db, paths, created, settings, now);
  return { created, removed, mirror, reason: 'created' };
}

export async function getBackupHealth(
  db: Db,
  paths: AppPaths,
  settings: Settings,
  now: Date,
): Promise<BackupHealth> {
  const backups = await listBackups(paths.backupsDir);
  const real = backups.filter((b) => b.kind !== 'pre-operation');
  const last = real[0] ?? null;
  const lastAuto = real.find((b) => b.kind === 'auto') ?? null;
  const ageDays = last ? Math.floor((now.getTime() - Date.parse(last.createdAt)) / DAY_MS) : null;
  const mirrorDir = settings.backupMirrorDir.trim();
  const lastMirrorAt = getMeta(db, 'last_mirror_at');
  const mirrorError = getMeta(db, 'last_mirror_error');

  let level: BackupHealth['level'] = 'ok';
  let message = 'Kopie zapasowe są aktualne.';
  if (!last) {
    level = 'none';
    message = 'Nie ma jeszcze żadnej kopii zapasowej.';
  } else if (ageDays !== null && ageDays >= 3) {
    level = 'warn';
    message = `Ostatnia kopia ma ${ageDays} dni.${settings.autoBackup ? '' : ' Automatyczne kopie są wyłączone.'}`;
  } else if (!mirrorDir) {
    level = 'warn';
    message =
      'Kopie leżą tylko na tym komputerze. Awaria dysku zniszczy bazę i kopie – ustaw dodatkowy folder (pendrive, chmura).';
  } else if (mirrorError) {
    level = 'warn';
    message = `Nie udało się skopiować kopii do dodatkowego folderu: ${mirrorError}`;
  }
  return {
    lastBackupAt: last?.createdAt ?? null,
    lastAutoAt: lastAuto?.createdAt ?? null,
    ageDays,
    mirrorDir,
    lastMirrorAt,
    mirrorError,
    level,
    message,
  };
}
