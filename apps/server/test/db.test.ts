import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@lumen/core';
import { DbError, openEncrypted } from '../src/db/connection.ts';
import { getDeviceId } from '../src/db/bootstrap.ts';
import { currentVersion, loadMigrations, migrate, NewerDatabaseError } from '../src/db/migrate.ts';
import { readSettings, writeSettings } from '../src/db/settings-repo.ts';
import { makeEnv, type TestEnv } from './helpers.ts';
import Database from 'better-sqlite3-multiple-ciphers';

let env: TestEnv;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});

describe('szyfrowanie bazy', () => {
  it('plik nie ma nagłówka SQLite i nie zawiera jawnych danych', async () => {
    writeSettings(env.db, { autoLockMinutes: 42 });
    env.db.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', 'SEKRETNA-ŻÓŁĆ-12345')");
    env.db.pragma('wal_checkpoint(TRUNCATE)');
    const raw = await readFile(env.paths.dbFile);
    expect(raw.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(raw.includes(Buffer.from('SEKRETNA-ŻÓŁĆ-12345'))).toBe(false);
    expect(raw.includes(Buffer.from('autoLockMinutes'))).toBe(false);
  });

  it('odmawia otwarcia złym kluczem', () => {
    const wrongKey = new Uint8Array(32).fill(9);
    expect(() => openEncrypted(env.paths.dbFile, wrongKey)).toThrow(DbError);
  });

  it('bez klucza plik nie daje się odczytać', () => {
    const plain = new Database(env.paths.dbFile, { readonly: true });
    expect(() => plain.prepare('SELECT * FROM meta').all()).toThrow();
    plain.close();
  });

  it('poprawny klucz otwiera bazę ponownie, a dane są zachowane', () => {
    const copy = openEncrypted(env.paths.dbFile, env.created.dek);
    expect(readSettings(copy).autoLockMinutes).toBe(42);
    copy.close();
  });
});

describe('migracje', () => {
  it('stosują wszystko na świeżej bazie i są idempotentne', async () => {
    expect(currentVersion(env.db)).toBe(loadMigrations().length);
    const again = await migrate(env.db);
    expect(again.applied).toEqual([]);
  });

  it('device_id jest stały', () => {
    expect(getDeviceId(env.db)).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId(env.db)).toBe(getDeviceId(env.db));
  });

  it('wywołują snapshot tylko, gdy baza ma dane i są nowe migracje', async () => {
    const base = loadMigrations();
    const extra = [
      ...base,
      {
        version: base.length + 1,
        name: '002_test.sql',
        sql: 'CREATE TABLE t_test (a TEXT) STRICT;',
      },
    ];
    const hook = vi.fn(async () => {});
    const result = await migrate(env.db, { migrations: extra, beforeMigrate: hook });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.applied).toEqual(['002_test.sql']);
    const hook2 = vi.fn(async () => {});
    await migrate(env.db, { migrations: extra, beforeMigrate: hook2 });
    expect(hook2).not.toHaveBeenCalled();
  });

  it('odmawia pracy na bazie nowszej niż aplikacja', async () => {
    await expect(migrate(env.db, { migrations: loadMigrations() })).rejects.toBeInstanceOf(
      NewerDatabaseError,
    );
  });

  it('wycofuje nieudaną migrację bez zmiany wersji', async () => {
    const fresh = await makeEnv();
    try {
      const base = loadMigrations();
      const broken = [
        ...base,
        {
          version: base.length + 1,
          name: '002_broken.sql',
          sql: 'CREATE TABLE ok_t (a TEXT); SELECT * FROM nie_istnieje;',
        },
      ];
      await expect(migrate(fresh.db, { migrations: broken })).rejects.toThrow(/002_broken/);
      expect(currentVersion(fresh.db)).toBe(base.length);
      expect(
        fresh.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ok_t'").get(),
      ).toBeUndefined();
    } finally {
      await fresh.cleanup();
    }
  });
});

describe('ustawienia', () => {
  it('zwracają domyślne wartości, gdy nic nie zapisano', async () => {
    const fresh = await makeEnv();
    try {
      expect(readSettings(fresh.db)).toEqual(DEFAULT_SETTINGS);
    } finally {
      await fresh.cleanup();
    }
  });

  it('zapisują częściową zmianę i zachowują resztę', async () => {
    const fresh = await makeEnv();
    try {
      const next = writeSettings(fresh.db, { dayStartHour: 5 });
      expect(next).toEqual({ ...DEFAULT_SETTINGS, dayStartHour: 5 });
    } finally {
      await fresh.cleanup();
    }
  });
});
