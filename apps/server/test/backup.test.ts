import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.ts';
import { openEncrypted } from '../src/db/connection.ts';
import { readSettings, writeSettings } from '../src/db/settings-repo.ts';
import {
  applyRestore,
  createBackup,
  listBackups,
  previewRestore,
  verifyBackup,
  verifyBackupWithDek,
} from '../src/modules/backup/backup.ts';
import { readVaultFile, rewrapPassword, writeVaultFile } from '../src/vault/vault.ts';
import { resolvePaths } from '../src/config.ts';
import { FAST_KDF, TEST_PASSWORD, makeEnv, makeTempDir, type TestEnv } from './helpers.ts';

const SCHEMA = loadMigrations().length;
let env: TestEnv;

beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  await env.cleanup();
});

async function backup(kind: 'manual' | 'auto' | 'pre-operation' = 'manual') {
  return createBackup({
    db: env.db,
    dek: env.created.dek,
    vault: env.created.vault,
    dir: env.paths.backupsDir,
    kind,
    appVersion: '0.0.0-test',
  });
}

describe('tworzenie i weryfikacja kopii', () => {
  it('tworzy kopię, która przechodzi weryfikację hasłem i kluczem odzyskiwania', async () => {
    writeSettings(env.db, { autoLockMinutes: 33 });
    const info = await backup();
    const file = join(env.paths.backupsDir, info.name);
    expect(info.name).toMatch(/^lumen-\d{8}-\d{6}-manual\.bazabak$/);

    const byPassword = await verifyBackup(file, { password: TEST_PASSWORD });
    expect(byPassword.ok).toBe(true);
    if (byPassword.ok) expect(byPassword.counts.settings).toBe(1);

    const byRecovery = await verifyBackup(file, { recoveryKey: env.created.recoveryKey });
    expect(byRecovery.ok).toBe(true);
  });

  it('odrzuca złe hasło', async () => {
    const info = await backup();
    const result = await verifyBackup(join(env.paths.backupsDir, info.name), {
      password: 'to nie jest hasło',
    });
    expect(result).toMatchObject({ ok: false, reason: 'wrong_credentials' });
  });

  it('nie zostawia plików tymczasowych ani nie zawiera jawnych danych', async () => {
    env.db.exec("INSERT INTO meta (key, value) VALUES ('probe', 'TAJNE-ĄĘŚĆ-777')");
    const info = await backup();
    const names = await readdir(env.paths.backupsDir);
    expect(names).toEqual([info.name]);
    const raw = await readFile(join(env.paths.backupsDir, info.name));
    expect(raw.includes(Buffer.from('TAJNE-ĄĘŚĆ-777'))).toBe(false);
    expect(raw.includes(Buffer.from('LUMENBAK'))).toBe(true);
  });

  it('wykrywa uszkodzenie danych (zmieniony bajt payloadu)', async () => {
    const info = await backup();
    const file = join(env.paths.backupsDir, info.name);
    const raw = await readFile(file);
    raw[raw.length - 100] = raw[raw.length - 100]! ^ 0xff;
    await writeFile(file, raw);
    expect(await verifyBackup(file, { password: TEST_PASSWORD })).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
  });

  it('wykrywa ucięty plik', async () => {
    const info = await backup();
    const file = join(env.paths.backupsDir, info.name);
    const raw = await readFile(file);
    await writeFile(file, raw.subarray(0, raw.length - 4096));
    const result = await verifyBackup(file, { password: TEST_PASSWORD });
    expect(result.ok).toBe(false);
  });

  it('wykrywa zmodyfikowany nagłówek (MAC), nawet gdy suma payloadu się zgadza', async () => {
    const info = await backup();
    const file = join(env.paths.backupsDir, info.name);
    const raw = await readFile(file);
    const headerLen = raw.readUInt32BE(8);
    const header = JSON.parse(raw.subarray(12, 12 + headerLen).toString('utf8'));
    header.createdAt = '2001-01-01T00:00:00.000Z'; // ta sama długość, inna treść
    const patched = Buffer.from(JSON.stringify(header));
    expect(patched.length).toBe(headerLen);
    patched.copy(raw, 12);
    await writeFile(file, raw);
    expect(await verifyBackup(file, { password: TEST_PASSWORD })).toMatchObject({
      ok: false,
      reason: 'tampered',
    });
  });

  it('odrzuca plik, który nie jest kopią', async () => {
    await mkdir(env.paths.backupsDir, { recursive: true });
    const fake = join(env.paths.backupsDir, 'obcy.bazabak');
    await writeFile(fake, 'to na pewno nie jest kopia zapasowa Lumen');
    expect(await verifyBackup(fake, { password: TEST_PASSWORD })).toMatchObject({
      ok: false,
      reason: 'bad_format',
    });
  });

  it('weryfikacja kluczem z żywej sesji działa i nie wymaga hasła', async () => {
    const info = await backup();
    const result = await verifyBackupWithDek(
      join(env.paths.backupsDir, info.name),
      env.created.dek,
    );
    expect(result.ok).toBe(true);
  });

  it('kolejne kopie w tej samej sekundzie dostają unikalne nazwy', async () => {
    const now = new Date();
    const make = () =>
      createBackup({
        db: env.db,
        dek: env.created.dek,
        vault: env.created.vault,
        dir: env.paths.backupsDir,
        kind: 'manual',
        appVersion: 't',
        now,
      });
    const [a, b] = [await make(), await make()];
    expect(a.name).not.toBe(b.name);
  });
});

describe('lista kopii', () => {
  it('zwraca kopie od najnowszej i pomija nieczytelne pliki', async () => {
    const old = await createBackup({
      db: env.db,
      dek: env.created.dek,
      vault: env.created.vault,
      dir: env.paths.backupsDir,
      kind: 'auto',
      appVersion: 't',
      now: new Date('2026-01-01T10:00:00Z'),
    });
    const recent = await backup('pre-operation');
    await writeFile(join(env.paths.backupsDir, 'smieci.bazabak'), 'xx');
    const list = await listBackups(env.paths.backupsDir);
    expect(list.map((b) => b.name)).toEqual([recent.name, old.name]);
    expect(list[0]?.kind).toBe('pre-operation');
  });

  it('brak katalogu → pusta lista', async () => {
    expect(await listBackups(join(env.paths.dataDir, 'nie-ma'))).toEqual([]);
  });
});

describe('przywracanie', () => {
  it('przywraca stan z kopii i zostawia kopię bieżących plików', async () => {
    writeSettings(env.db, { autoLockMinutes: 11 });
    const info = await backup();
    writeSettings(env.db, { autoLockMinutes: 99 });
    env.db.close();

    const result = await applyRestore({
      file: join(env.paths.backupsDir, info.name),
      credentials: { password: TEST_PASSWORD },
      paths: env.paths,
      appSchemaVersion: SCHEMA,
    });

    const restored = openEncrypted(env.paths.dbFile, env.created.dek);
    expect(readSettings(restored).autoLockMinutes).toBe(11);
    restored.close();

    expect(result.preRestoreDir).not.toBeNull();
    const saved = openEncrypted(join(result.preRestoreDir!, 'lumen.db'), env.created.dek);
    expect(readSettings(saved).autoLockMinutes).toBe(99); // stan sprzed przywrócenia nie przepadł
    saved.close();
  });

  it('usuwa stary plik WAL, żeby nie uszkodzić przywróconej bazy', async () => {
    const info = await backup();
    writeSettings(env.db, { autoLockMinutes: 77 });
    // symulacja twardego zakończenia procesu: WAL z niezakończonymi zmianami zostaje na dysku
    const walPath = `${env.paths.dbFile}-wal`;
    const staleWal = await readFile(walPath);
    expect(staleWal.length).toBeGreaterThan(0);
    env.db.close();
    await writeFile(walPath, staleWal);
    expect((await stat(walPath)).size).toBeGreaterThan(0);
    await applyRestore({
      file: join(env.paths.backupsDir, info.name),
      credentials: { password: TEST_PASSWORD },
      paths: env.paths,
      appSchemaVersion: SCHEMA,
    });
    const restored = openEncrypted(env.paths.dbFile, env.created.dek);
    expect(restored.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
    expect(readSettings(restored).autoLockMinutes).toBe(15);
    restored.close();
  });

  it('na czystej maszynie przywraca także vault (hasło z chwili kopii)', async () => {
    writeSettings(env.db, { autoLockMinutes: 21 });
    const info = await backup();
    const backupFile = join(env.paths.backupsDir, info.name);

    const fresh = await makeTempDir();
    try {
      const paths = resolvePaths(join(fresh.dir, 'nowa-maszyna'));
      await mkdir(paths.dataDir, { recursive: true });
      const result = await applyRestore({
        file: backupFile,
        credentials: { password: TEST_PASSWORD },
        paths,
        appSchemaVersion: SCHEMA,
      });
      expect(result.vaultWillBeReplaced).toBe(true);
      expect(result.preRestoreDir).toBeNull();
      const vault = await readVaultFile(paths.vaultFile);
      expect(vault).toEqual(env.created.vault);
      const db = openEncrypted(paths.dbFile, env.created.dek);
      expect(readSettings(db).autoLockMinutes).toBe(21);
      db.close();
    } finally {
      await fresh.cleanup();
    }
  });

  it('przy odblokowanej aplikacji zachowuje bieżące (nowsze) hasło, gdy DEK jest ten sam', async () => {
    const info = await backup();
    const newer = await rewrapPassword(
      env.created.vault,
      env.created.dek,
      'nowe hasło po zmianie 2026',
      FAST_KDF,
    );
    await writeVaultFile(env.paths.vaultFile, newer);
    env.db.close();

    const result = await applyRestore({
      file: join(env.paths.backupsDir, info.name),
      credentials: { password: TEST_PASSWORD }, // stare hasło otwiera kopię
      paths: env.paths,
      appSchemaVersion: SCHEMA,
      currentDek: env.created.dek,
    });
    expect(result.vaultWillBeReplaced).toBe(false);
    expect(await readVaultFile(env.paths.vaultFile)).toEqual(newer);
  });

  it('podgląd niczego nie zmienia', async () => {
    writeSettings(env.db, { autoLockMinutes: 5 });
    const info = await backup();
    writeSettings(env.db, { autoLockMinutes: 6 });
    env.db.close();
    const before = await readFile(env.paths.dbFile);
    const preview = await previewRestore({
      file: join(env.paths.backupsDir, info.name),
      credentials: { recoveryKey: env.created.recoveryKey },
      paths: env.paths,
      appSchemaVersion: SCHEMA,
    });
    expect(preview.counts.settings).toBe(1);
    expect((await readFile(env.paths.dbFile)).equals(before)).toBe(true);
    expect((await readdir(env.paths.dataDir)).some((n) => n.endsWith('.restoring'))).toBe(false);
  });

  it('odmawia kopii z nowszego schematu i nie rusza bieżących plików', async () => {
    const info = await backup();
    env.db.close();
    const before = await readFile(env.paths.dbFile);
    await expect(
      applyRestore({
        file: join(env.paths.backupsDir, info.name),
        credentials: { password: TEST_PASSWORD },
        paths: env.paths,
        appSchemaVersion: SCHEMA - 1,
      }),
    ).rejects.toMatchObject({ code: 'newer_schema' });
    expect((await readFile(env.paths.dbFile)).equals(before)).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'przy otwartej bazie zgłasza czytelny błąd zamiast uszkodzić pliki',
    async () => {
      const info = await backup();
      writeSettings(env.db, { autoLockMinutes: 8 }); // połączenie zostaje otwarte
      await expect(
        applyRestore({
          file: join(env.paths.backupsDir, info.name),
          credentials: { password: TEST_PASSWORD },
          paths: env.paths,
          appSchemaVersion: SCHEMA,
        }),
      ).rejects.toMatchObject({ code: 'io' });
      expect(readSettings(env.db).autoLockMinutes).toBe(8);
    },
  );

  it('odmawia przy złym haśle i nie rusza bieżących plików', async () => {
    const info = await backup();
    env.db.close();
    const before = await readFile(env.paths.dbFile);
    await expect(
      applyRestore({
        file: join(env.paths.backupsDir, info.name),
        credentials: { password: 'złe hasło do kopii' },
        paths: env.paths,
        appSchemaVersion: SCHEMA,
      }),
    ).rejects.toMatchObject({ code: 'wrong_credentials' });
    expect((await readFile(env.paths.dbFile)).equals(before)).toBe(true);
  });
});
