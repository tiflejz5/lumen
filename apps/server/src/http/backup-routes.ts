import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, type AppPaths } from '../config.ts';
import {
  BackupError,
  applyRestore,
  createBackup,
  listBackups,
  previewRestore,
  type Credentials,
} from '../modules/backup/backup.ts';
import { getBackupHealth, mirrorBackup, runAutoBackup } from '../modules/backup/auto.ts';
import { loadMigrations } from '../db/migrate.ts';
import { exportUserData, importUserData } from '../modules/userdata/userdata.ts';
import type { AppSession } from '../session/app-session.ts';

const backupName = z.string().regex(/^[A-Za-z0-9._-]{1,120}\.bazabak$/);
const restoreBody = z
  .object({
    name: backupName,
    source: z.enum(['local', 'mirror']).default('local'),
    password: z.string().min(1).max(256).optional(),
    recoveryKey: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((b) => !!b.password !== !!b.recoveryKey, {
    message: 'Podaj hasło albo klucz odzyskiwania z chwili tworzenia kopii.',
  });
const restoreApplyBody = z
  .object({
    name: backupName,
    source: z.enum(['local', 'mirror']).default('local'),
    password: z.string().min(1).max(256).optional(),
    recoveryKey: z.string().min(1).max(120).optional(),
    confirm: z.literal(true),
  })
  .strict()
  .refine((b) => !!b.password !== !!b.recoveryKey, {
    message: 'Podaj hasło albo klucz odzyskiwania z chwili tworzenia kopii.',
  });

export type BackupRouteDeps = { session: AppSession; paths: AppPaths; now: () => Date };

export function registerBackupRoutes(app: FastifyInstance, deps: BackupRouteDeps): void {
  const { session, paths } = deps;
  const appSchemaVersion = loadMigrations().length;

  function resolveBackupFile(name: string, source: 'local' | 'mirror'): string {
    const dir =
      source === 'mirror' ? session.currentSettings.backupMirrorDir.trim() : paths.backupsDir;
    if (!dir) throw new BackupError('bad_format', 'Nie ustawiono dodatkowego folderu kopii.');
    const base = resolve(dir);
    const file = resolve(base, name);
    if (!file.startsWith(base + sep))
      throw new BackupError('bad_format', 'Nieprawidłowa nazwa pliku kopii.');
    if (!existsSync(file)) throw new BackupError('bad_format', 'Nie znaleziono pliku kopii.');
    return file;
  }

  const credentialsOf = (b: {
    password?: string | undefined;
    recoveryKey?: string | undefined;
  }): Credentials => (b.password ? { password: b.password } : { recoveryKey: b.recoveryKey! });

  app.get('/api/backups', async () => {
    const { db } = session.requireUnlocked();
    const settings = session.currentSettings;
    const mirrorDir = settings.backupMirrorDir.trim();
    return {
      backups: await listBackups(paths.backupsDir),
      directory: paths.backupsDir,
      mirrorBackups: mirrorDir ? await listBackups(mirrorDir).catch(() => []) : [],
      health: await getBackupHealth(db, paths, settings, deps.now()),
    };
  });

  app.post('/api/backups', async () => {
    const { db, dek, vault } = session.requireUnlocked();
    const now = deps.now();
    const info = await createBackup({
      db,
      dek,
      vault,
      dir: paths.backupsDir,
      kind: 'manual',
      appVersion: APP_VERSION,
      now,
    });
    const mirror = await mirrorBackup(db, paths, info, session.currentSettings, now);
    return { ...info, mirror };
  });

  /** Wykonuje kopię automatyczną, jeśli jest potrzebna (wywoływane też przy odblokowaniu). */
  app.post('/api/backups/auto', async () => {
    const { db, dek, vault } = session.requireUnlocked();
    return runAutoBackup({
      db,
      dek,
      vault,
      paths,
      settings: session.currentSettings,
      now: deps.now(),
    });
  });

  app.post('/api/backups/restore/preview', async (req) => {
    const body = restoreBody.parse(req.body);
    const { dek } = session.requireUnlocked();
    return previewRestore({
      file: resolveBackupFile(body.name, body.source),
      credentials: credentialsOf(body),
      paths,
      appSchemaVersion,
      currentDek: dek,
      now: deps.now(),
    });
  });

  app.post('/api/backups/restore', async (req) => {
    const body = restoreApplyBody.parse(req.body);
    const file = resolveBackupFile(body.name, body.source);
    const { dek } = session.requireUnlocked();
    const currentDek = Uint8Array.from(dek);
    const options = {
      file,
      credentials: credentialsOf(body),
      paths,
      appSchemaVersion,
      currentDek,
      now: deps.now(),
    };
    // Najpierw pełna weryfikacja (błędne hasło albo uszkodzona kopia nie zamykają aplikacji).
    await previewRestore(options);
    session.lock(); // baza musi być zamknięta na czas podmiany pliku
    try {
      return await applyRestore(options);
    } finally {
      currentDek.fill(0);
    }
  });

  // Przywrócenie przy pierwszym uruchomieniu (np. po awarii dysku): kopia musi leżeć w folderze kopii.
  app.post('/api/restore/initial', async (req, reply) => {
    if (await session.vaultExists())
      return reply.code(409).send({
        error: 'bad_state',
        message: 'Aplikacja jest już skonfigurowana. Przywracanie wykonaj z Ustawień.',
      });
    const body = restoreApplyBody.parse(req.body);
    return applyRestore({
      file: resolveBackupFile(body.name, 'local'),
      credentials: credentialsOf(body),
      paths,
      appSchemaVersion,
      currentDek: null,
      now: deps.now(),
    });
  });

  app.get('/api/restore/initial/list', async (_req, reply) => {
    if (await session.vaultExists())
      return reply
        .code(409)
        .send({ error: 'bad_state', message: 'Aplikacja jest już skonfigurowana.' });
    return { backups: await listBackups(paths.backupsDir), directory: paths.backupsDir };
  });

  // ── dane użytkownika ─────────────────────────────────────────────────────────────────────────
  app.get('/api/user-data/export', async (_req, reply) => {
    const { db } = session.requireUnlocked();
    const data = exportUserData(db, deps.now());
    const stamp = deps.now().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="lumen-dane-${stamp}.json"`)
      .send(JSON.stringify(data));
  });

  app.post('/api/user-data/import', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const { db, dek, vault } = session.requireUnlocked();
    // Kopia zabezpieczająca przed scaleniem – import można w razie czego cofnąć przywróceniem.
    await createBackup({
      db,
      dek,
      vault,
      dir: paths.backupsDir,
      kind: 'pre-operation',
      label: 'przed importem danych',
      appVersion: APP_VERSION,
      now: deps.now(),
    });
    return importUserData(db, req.body);
  });
}
