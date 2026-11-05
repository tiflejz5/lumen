import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths, type AppPaths } from '../src/config.ts';
import { openEncrypted, type Db } from '../src/db/connection.ts';
import { bootstrapDatabase } from '../src/db/bootstrap.ts';
import { createVault, writeVaultFile, type CreatedVault } from '../src/vault/vault.ts';

export const FAST_KDF = { opslimit: 2, memlimit: 16 * 1024 * 1024 };
export const TEST_PASSWORD = 'zielony koń skacze przez płot';

export type TestEnv = {
  paths: AppPaths;
  created: CreatedVault;
  db: Db;
  cleanup: () => Promise<void>;
};

/** Pełne środowisko jak po pierwszej konfiguracji: vault + zaszyfrowana baza po migracjach. */
export async function makeEnv(password = TEST_PASSWORD): Promise<TestEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'lumen-test-'));
  const paths = resolvePaths(dir);
  const created = await createVault(password, FAST_KDF);
  await writeVaultFile(paths.vaultFile, created.vault);
  const db = openEncrypted(paths.dbFile, created.dek, { create: true });
  await bootstrapDatabase(db);
  return {
    paths,
    created,
    db,
    cleanup: async () => {
      try {
        db.close();
      } catch {
        // już zamknięta
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function makeTempDir(
  prefix = 'lumen-test-',
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
