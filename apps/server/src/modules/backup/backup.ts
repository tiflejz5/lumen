import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import _sodium from 'libsodium-wrappers-sumo';
import type { BackupInfo } from '@lumen/core';
import type { AppPaths } from '../../config.ts';
import { openEncrypted, type Db } from '../../db/connection.ts';
import { currentVersion } from '../../db/migrate.ts';
import {
  unlockWithPassword,
  unlockWithRecoveryKey,
  vaultFileSchema,
  VaultError,
  writeVaultFile,
  type VaultFile,
} from '../../vault/vault.ts';

/**
 * Kontener kopii `.bazabak`:
 *
 *   "LUMENBAK" (8) | długość nagłówka u32 BE | nagłówek JSON | MAC (32) | payload
 *
 * payload = zaszyfrowana baza SQLCipher (snapshot z VACUUM INTO). Nagłówek zawiera SHA-256 payloadu,
 * kopię vault.json (DEK opakowany hasłem i kluczem odzyskiwania) oraz metadane. MAC (BLAKE2b z kluczem
 * wyprowadzonym z DEK) obejmuje cały nagłówek, a więc pośrednio payload. Dzięki kopii vaulta backup
 * da się otworzyć na czystej maszynie hasłem albo kluczem odzyskiwania.
 */

const MAGIC = Buffer.from('LUMENBAK', 'ascii');
const MAX_HEADER_BYTES = 1024 * 1024;
const EXTENSION = '.bazabak';

export type BackupKind = 'manual' | 'auto' | 'pre-operation';

const headerSchema = z.object({
  v: z.literal(1),
  createdAt: z.string(),
  appVersion: z.string(),
  schemaVersion: z.number().int().min(0),
  kind: z.enum(['manual', 'auto', 'pre-operation']),
  label: z.string().max(40).optional(),
  payloadBytes: z.number().int().min(0),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  vault: vaultFileSchema,
});
export type BackupHeader = z.infer<typeof headerSchema>;

export type BackupFailure =
  'bad_format' | 'corrupt' | 'tampered' | 'wrong_credentials' | 'db_check_failed';

export type VerifyResult =
  | {
      ok: true;
      createdAt: string;
      appVersion: string;
      schemaVersion: number;
      kind: BackupKind;
      payloadBytes: number;
      counts: Record<string, number>;
    }
  | { ok: false; reason: BackupFailure; message: string };

export type Credentials = { password: string } | { recoveryKey: string };

export class BackupError extends Error {
  code: BackupFailure | 'newer_schema' | 'io';
  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

async function sodium(): Promise<typeof _sodium> {
  await _sodium.ready;
  return _sodium;
}

async function macFor(headerBytes: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  const s = await sodium();
  const key = s.crypto_kdf_derive_from_key(32, 2, 'lumenbak', dek);
  return s.crypto_generichash(32, headerBytes, key);
}

function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

async function sha256OfRange(file: string, start: number): Promise<{ hex: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file, { start })) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { hex: hash.digest('hex'), bytes };
}

type Container = { header: BackupHeader; headerBytes: Buffer; mac: Buffer; payloadOffset: number };

async function readContainer(file: string): Promise<Container> {
  const handle = await fs.open(file, 'r');
  try {
    const prefix = Buffer.alloc(12);
    const { bytesRead } = await handle.read(prefix, 0, 12, 0);
    if (bytesRead < 12 || !prefix.subarray(0, 8).equals(MAGIC)) {
      throw new BackupError('bad_format', 'To nie jest plik kopii zapasowej Lumen.');
    }
    const headerLen = prefix.readUInt32BE(8);
    if (headerLen === 0 || headerLen > MAX_HEADER_BYTES) {
      throw new BackupError('bad_format', 'Nagłówek kopii jest uszkodzony.');
    }
    const headerBytes = Buffer.alloc(headerLen);
    const mac = Buffer.alloc(32);
    const h = await handle.read(headerBytes, 0, headerLen, 12);
    const m = await handle.read(mac, 0, 32, 12 + headerLen);
    if (h.bytesRead < headerLen || m.bytesRead < 32) {
      throw new BackupError('bad_format', 'Plik kopii jest ucięty.');
    }
    const parsed = headerSchema.safeParse(JSON.parse(headerBytes.toString('utf8')));
    if (!parsed.success) throw new BackupError('bad_format', 'Nagłówek kopii ma nieznany format.');
    return { header: parsed.data, headerBytes, mac, payloadOffset: 12 + headerLen + 32 };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('bad_format', 'Nie można odczytać pliku kopii.');
  } finally {
    await handle.close();
  }
}

async function copyRange(file: string, start: number, dest: string): Promise<void> {
  await pipeline(createReadStream(file, { start }), createWriteStream(dest, { flags: 'w' }));
}

async function removeQuiet(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.rm(p, { force: true })));
}

/** Sprawdza spójność, MAC i otwieralność bazy w kopii. Zwraca ścieżkę wypakowanej bazy, jeśli `keep`. */
async function verifyContainer(
  file: string,
  dek: Uint8Array,
  keepExtractedAt?: string,
): Promise<VerifyResult> {
  let container: Container;
  try {
    container = await readContainer(file);
  } catch (error) {
    const e = error as BackupError;
    return { ok: false, reason: 'bad_format', message: e.message };
  }
  const { header, headerBytes, mac, payloadOffset } = container;

  const actual = await sha256OfRange(file, payloadOffset);
  if (actual.bytes !== header.payloadBytes || actual.hex !== header.payloadSha256) {
    return {
      ok: false,
      reason: 'corrupt',
      message: 'Plik kopii jest uszkodzony (suma kontrolna się nie zgadza).',
    };
  }
  const s = await sodium();
  const expectedMac = await macFor(headerBytes, dek);
  if (!s.memcmp(expectedMac, new Uint8Array(mac))) {
    return {
      ok: false,
      reason: 'tampered',
      message: 'Kopia została zmodyfikowana lub pochodzi z innej bazy.',
    };
  }

  const tmp =
    keepExtractedAt ?? join(dirname(file), `.verify-${randomBytes(6).toString('hex')}.tmp`);
  try {
    await copyRange(file, payloadOffset, tmp);
    const db = openEncrypted(tmp, dek);
    try {
      const check = db.pragma('quick_check') as { quick_check: string }[];
      if (check.length !== 1 || check[0]?.quick_check !== 'ok') {
        return {
          ok: false,
          reason: 'db_check_failed',
          message: 'Baza w kopii nie przechodzi kontroli integralności.',
        };
      }
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[];
      const counts: Record<string, number> = {};
      for (const { name } of tables) {
        counts[name] = (
          db.prepare(`SELECT count(*) AS c FROM "${name.replace(/"/g, '""')}"`).get() as {
            c: number;
          }
        ).c;
      }
      return {
        ok: true,
        createdAt: header.createdAt,
        appVersion: header.appVersion,
        schemaVersion: header.schemaVersion,
        kind: header.kind,
        payloadBytes: header.payloadBytes,
        counts,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'db_check_failed',
      message: `Nie można otworzyć bazy z kopii: ${(error as Error).message}`,
    };
  } finally {
    if (!keepExtractedAt) await removeQuiet(tmp, `${tmp}-wal`, `${tmp}-shm`);
  }
}

export async function verifyBackupWithDek(file: string, dek: Uint8Array): Promise<VerifyResult> {
  return verifyContainer(file, dek);
}

async function dekFromCredentials(vault: VaultFile, credentials: Credentials): Promise<Uint8Array> {
  return 'password' in credentials
    ? unlockWithPassword(vault, credentials.password)
    : unlockWithRecoveryKey(vault, credentials.recoveryKey);
}

/** Weryfikacja kopii poświadczeniami (hasłem lub kluczem odzyskiwania z chwili jej utworzenia). */
export async function verifyBackup(file: string, credentials: Credentials): Promise<VerifyResult> {
  let container: Container;
  try {
    container = await readContainer(file);
  } catch (error) {
    return { ok: false, reason: 'bad_format', message: (error as Error).message };
  }
  let dek: Uint8Array;
  try {
    dek = await dekFromCredentials(container.header.vault, credentials);
  } catch (error) {
    if (error instanceof VaultError) {
      return { ok: false, reason: 'wrong_credentials', message: error.message };
    }
    throw error;
  }
  return verifyContainer(file, dek);
}

export type CreateBackupOptions = {
  db: Db;
  dek: Uint8Array;
  vault: VaultFile;
  dir: string;
  kind: BackupKind;
  appVersion: string;
  label?: string;
  now?: Date;
};

export async function createBackup(options: CreateBackupOptions): Promise<BackupInfo> {
  const { db, dek, vault, dir, kind, appVersion } = options;
  const now = options.now ?? new Date();
  await fs.mkdir(dir, { recursive: true });
  const snapshot = join(dir, `.snapshot-${randomBytes(6).toString('hex')}.tmp`);
  let partial: string | null = null;
  try {
    db.prepare('VACUUM INTO ?').run(snapshot);
    const { hex, bytes } = await sha256OfRange(snapshot, 0);
    const header: BackupHeader = {
      v: 1,
      createdAt: now.toISOString(),
      appVersion,
      schemaVersion: currentVersion(db),
      kind,
      ...(options.label ? { label: options.label.slice(0, 40) } : {}),
      payloadBytes: bytes,
      payloadSha256: hex,
      vault,
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const prefix = Buffer.alloc(12);
    MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerBytes.length, 8);
    const mac = Buffer.from(await macFor(headerBytes, dek));

    let name = `lumen-${stamp(now)}-${kind}${EXTENSION}`;
    for (let i = 2; await exists(join(dir, name)); i++)
      name = `lumen-${stamp(now)}-${kind}-${i}${EXTENSION}`;
    const finalPath = join(dir, name);
    partial = `${finalPath}.partial`;

    await fs.writeFile(partial, Buffer.concat([prefix, headerBytes, mac]));
    await pipeline(createReadStream(snapshot), createWriteStream(partial, { flags: 'a' }));
    const handle = await fs.open(partial, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(partial, finalPath);
    partial = null;

    const verified = await verifyBackupWithDek(finalPath, dek);
    if (!verified.ok) {
      await removeQuiet(finalPath);
      throw new BackupError(verified.reason, `Kopia nie przeszła weryfikacji: ${verified.message}`);
    }
    const stat = await fs.stat(finalPath);
    return {
      name,
      createdAt: header.createdAt,
      sizeBytes: stat.size,
      kind,
      ...(header.label ? { label: header.label } : {}),
    };
  } finally {
    await removeQuiet(snapshot, ...(partial ? [partial] : []));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const infos: BackupInfo[] = [];
  for (const name of names.filter((n) => n.endsWith(EXTENSION))) {
    try {
      const file = join(dir, name);
      const { header } = await readContainer(file);
      const stat = await fs.stat(file);
      infos.push({
        name,
        createdAt: header.createdAt,
        sizeBytes: stat.size,
        kind: header.kind,
        ...(header.label ? { label: header.label } : {}),
      });
    } catch {
      // plik nieczytelny – pomijamy na liście (weryfikacja ręczna pokaże powód)
    }
  }
  return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── przywracanie ─────────────────────────────────────────────────────────────────────────────

export type RestoreOptions = {
  file: string;
  credentials: Credentials;
  paths: AppPaths;
  /** Najwyższa wersja schematu, którą rozumie ta wersja aplikacji. */
  appSchemaVersion: number;
  /** Klucz bieżącej bazy (gdy aplikacja była odblokowana). Jeśli pasuje do kopii, hasło się nie zmienia. */
  currentDek?: Uint8Array | null;
  now?: Date;
};

export type RestorePreview = {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  /** Czy po przywróceniu hasło będzie takie jak w chwili tworzenia kopii. */
  vaultWillBeReplaced: boolean;
};

export type RestoreResult = RestorePreview & { preRestoreDir: string | null };

async function prepareRestore(options: RestoreOptions) {
  const { header } = await readContainer(options.file);
  let dek: Uint8Array;
  try {
    dek = await dekFromCredentials(header.vault, options.credentials);
  } catch (error) {
    if (error instanceof VaultError) throw new BackupError('wrong_credentials', error.message);
    throw error;
  }
  if (header.schemaVersion > options.appSchemaVersion) {
    throw new BackupError(
      'newer_schema',
      `Kopia pochodzi z nowszej wersji aplikacji (schemat ${header.schemaVersion}, obsługiwany ${options.appSchemaVersion}). Zaktualizuj aplikację.`,
    );
  }
  const extracted = join(
    dirname(options.paths.dbFile),
    `${basename(options.paths.dbFile)}.restoring`,
  );
  await removeQuiet(extracted, `${extracted}-wal`, `${extracted}-shm`);
  const verified = await verifyContainer(options.file, dek, extracted);
  if (!verified.ok) {
    await removeQuiet(extracted, `${extracted}-wal`, `${extracted}-shm`);
    throw new BackupError(verified.reason, verified.message);
  }
  let keepCurrentVault = false;
  if (options.currentDek) {
    try {
      openEncrypted(extracted, options.currentDek).close();
      keepCurrentVault = true;
    } catch {
      keepCurrentVault = false;
    }
  }
  return { header, dek, extracted, verified, keepCurrentVault };
}

/** Podgląd: weryfikuje kopię i pokazuje, co zostanie przywrócone. Niczego nie zmienia. */
export async function previewRestore(options: RestoreOptions): Promise<RestorePreview> {
  const prepared = await prepareRestore(options);
  await removeQuiet(prepared.extracted, `${prepared.extracted}-wal`, `${prepared.extracted}-shm`);
  return {
    createdAt: prepared.verified.ok ? prepared.verified.createdAt : '',
    appVersion: prepared.header.appVersion,
    schemaVersion: prepared.header.schemaVersion,
    counts: prepared.verified.ok ? prepared.verified.counts : {},
    vaultWillBeReplaced: !prepared.keepCurrentVault,
  };
}

/**
 * Przywraca kopię. Baza MUSI być zamknięta (aplikacja zablokowana). Przed podmianą bieżące pliki
 * trafiają do `backups/pre-restore-…`, więc nic nie ginie bez śladu.
 */
export async function applyRestore(options: RestoreOptions): Promise<RestoreResult> {
  const prepared = await prepareRestore(options);
  const { paths } = options;
  const now = options.now ?? new Date();
  try {
    let preRestoreDir: string | null = null;
    if ((await exists(paths.dbFile)) || (await exists(paths.vaultFile))) {
      preRestoreDir = join(paths.backupsDir, `pre-restore-${stamp(now)}`);
      await fs.mkdir(preRestoreDir, { recursive: true });
      for (const f of [paths.dbFile, `${paths.dbFile}-wal`, paths.vaultFile]) {
        if (await exists(f)) await fs.copyFile(f, join(preRestoreDir, basename(f)));
      }
    }
    try {
      // Stary WAL zastosowany do nowej bazy ją uszkodzi – usuwamy go PRZED podmianą.
      await removeQuiet(`${paths.dbFile}-wal`, `${paths.dbFile}-shm`);
      await fs.rename(prepared.extracted, paths.dbFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new BackupError('io', 'Baza jest w użyciu. Zablokuj aplikację i spróbuj ponownie.');
      }
      throw error;
    }
    if (!prepared.keepCurrentVault) await writeVaultFile(paths.vaultFile, prepared.header.vault);
    return {
      createdAt: prepared.header.createdAt,
      appVersion: prepared.header.appVersion,
      schemaVersion: prepared.header.schemaVersion,
      counts: prepared.verified.ok ? prepared.verified.counts : {},
      vaultWillBeReplaced: !prepared.keepCurrentVault,
      preRestoreDir,
    };
  } finally {
    await removeQuiet(prepared.extracted, `${prepared.extracted}-wal`, `${prepared.extracted}-shm`);
  }
}
