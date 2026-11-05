import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
  type SetupStartResponse,
} from '@lumen/core';
import { APP_VERSION, type AppPaths } from '../config.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { openEncrypted, type Db } from '../db/connection.ts';
import { readSettings, writeSettings } from '../db/settings-repo.ts';
import { createBackup } from '../modules/backup/backup.ts';
import {
  checkChallengeAnswers,
  createVault,
  pickChallenge,
  readVaultFile,
  rewrapPassword,
  rotateRecoveryKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  writeVaultFile,
  type KdfParams,
  type VaultFile,
} from '../vault/vault.ts';

export type SessionErrorCode =
  'locked' | 'bad_state' | 'rate_limited' | 'setup_expired' | 'setup_mismatch';

export class SessionError extends Error {
  code: SessionErrorCode;
  retryAfterSeconds?: number;
  constructor(code: SessionErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Pending = {
  vault: VaultFile;
  dek: Uint8Array;
  recoveryKey: string;
  challenge: number[];
  expiresAt: number;
  attempts: number;
};

export type AppSessionOptions = {
  paths: AppPaths;
  now?: () => number;
  /** Tylko do testów: słabsze parametry Argon2id. */
  kdf?: KdfParams;
  appVersion?: string;
};

const SETUP_TTL_MS = 15 * 60 * 1000;
const FREE_ATTEMPTS = 3;
const MAX_DELAY_SECONDS = 60;

/**
 * Stan aplikacji: zablokowana / odblokowana / nieskonfigurowana. Klucz DEK i otwarta baza istnieją
 * wyłącznie w pamięci i tylko po odblokowaniu. Blokada zamyka bazę i zeruje klucz (best effort w JS).
 */
export class AppSession {
  private readonly paths: AppPaths;
  private readonly now: () => number;
  private readonly kdf: KdfParams | undefined;
  private readonly appVersion: string;

  private dek: Uint8Array | null = null;
  private db: Db | null = null;
  private vault: VaultFile | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private tokens = new Set<string>(); // SHA-256 tokenów sesji
  private lastActivity = 0;
  private pending: Pending | null = null;

  private failures = 0;
  private blockedUntil = 0;

  constructor(options: AppSessionOptions) {
    this.paths = options.paths;
    this.now = options.now ?? Date.now;
    this.kdf = options.kdf;
    this.appVersion = options.appVersion ?? APP_VERSION;
  }

  // ── stan ───────────────────────────────────────────────────────────────────────────────────

  get isUnlocked(): boolean {
    return this.dek !== null && this.db !== null;
  }

  async vaultExists(): Promise<boolean> {
    return (await readVaultFile(this.paths.vaultFile)) !== null;
  }

  /** Jest plik bazy, ale brak vault.json – prawdopodobnie przypadkowo usunięty klucz. */
  async hasOrphanDatabase(): Promise<boolean> {
    if (await this.vaultExists()) return false;
    return fileExists(this.paths.dbFile);
  }

  get currentSettings(): Settings {
    return this.settings;
  }

  autoLockInSeconds(): number | null {
    if (!this.isUnlocked) return null;
    const left = this.settings.autoLockMinutes * 60_000 - (this.now() - this.lastActivity);
    return Math.max(0, Math.ceil(left / 1000));
  }

  requireUnlocked(): { db: Db; dek: Uint8Array; vault: VaultFile } {
    if (!this.db || !this.dek || !this.vault) {
      throw new SessionError('locked', 'Baza jest zablokowana.');
    }
    return { db: this.db, dek: this.dek, vault: this.vault };
  }

  // ── tokeny sesji (ciasteczko) ───────────────────────────────────────────────────────────────

  private issueToken(): string {
    const token = randomBytes(32).toString('base64url');
    this.tokens.add(hashToken(token));
    return token;
  }

  isValidToken(token: string | undefined): boolean {
    if (!token || !this.isUnlocked) return false;
    const hash = hashToken(token);
    for (const known of this.tokens) {
      if (known.length === hash.length && timingSafeEqual(Buffer.from(known), Buffer.from(hash)))
        return true;
    }
    return false;
  }

  touch(): void {
    if (this.isUnlocked) this.lastActivity = this.now();
  }

  /** Wywoływane cyklicznie. Zwraca true, jeśli właśnie zablokowano. */
  tick(): boolean {
    if (this.isUnlocked && this.autoLockInSeconds() === 0) {
      this.lock();
      return true;
    }
    if (this.pending && this.now() > this.pending.expiresAt) this.clearPending();
    return false;
  }

  lock(): void {
    try {
      this.db?.close();
    } catch {
      // zamykamy dalej
    }
    this.dek?.fill(0);
    this.db = null;
    this.dek = null;
    this.vault = null;
    this.tokens.clear();
    this.clearPending();
  }

  // ── limit prób ──────────────────────────────────────────────────────────────────────────────

  private assertNotRateLimited(): void {
    const wait = Math.ceil((this.blockedUntil - this.now()) / 1000);
    if (wait > 0) {
      throw new SessionError(
        'rate_limited',
        `Zbyt wiele nieudanych prób. Spróbuj za ${wait} s.`,
        wait,
      );
    }
  }

  private registerFailure(): void {
    this.failures += 1;
    if (this.failures >= FREE_ATTEMPTS) {
      const delay = Math.min(2 ** (this.failures - FREE_ATTEMPTS + 1), MAX_DELAY_SECONDS);
      this.blockedUntil = this.now() + delay * 1000;
    }
  }

  private registerSuccess(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }

  /** Wspólna ścieżka: sprawdź limit → wykonaj weryfikację → zaktualizuj licznik. */
  private async guarded<T>(verify: () => Promise<T>): Promise<T> {
    this.assertNotRateLimited();
    try {
      const result = await verify();
      this.registerSuccess();
      return result;
    } catch (error) {
      if ((error as { name?: string }).name === 'VaultError') this.registerFailure();
      throw error;
    }
  }

  // ── konfiguracja początkowa (dwuetapowa: nic nie trafia na dysk przed potwierdzeniem klucza) ────

  async startSetup(password: string): Promise<SetupStartResponse> {
    if (await this.vaultExists())
      throw new SessionError('bad_state', 'Aplikacja jest już skonfigurowana.');
    this.clearPending();
    const created = await createVault(password, this.kdf);
    const challenge = pickChallenge(created.recoveryKey.split('-').length);
    this.pending = {
      vault: created.vault,
      dek: created.dek,
      recoveryKey: created.recoveryKey,
      challenge,
      expiresAt: this.now() + SETUP_TTL_MS,
      attempts: 0,
    };
    return { recoveryKey: created.recoveryKey, challenge };
  }

  async finishSetup(answers: string[]): Promise<string> {
    const pending = this.pending;
    if (!pending) throw new SessionError('setup_expired', 'Konfiguracja wygasła. Zacznij od nowa.');
    if (this.now() > pending.expiresAt) {
      this.clearPending();
      throw new SessionError('setup_expired', 'Konfiguracja wygasła. Zacznij od nowa.');
    }
    if (!checkChallengeAnswers(pending.recoveryKey, pending.challenge, answers)) {
      pending.attempts += 1;
      if (pending.attempts >= 5) this.clearPending();
      throw new SessionError(
        'setup_mismatch',
        'Przepisane fragmenty klucza nie zgadzają się. Sprawdź zapis klucza.',
      );
    }

    await fs.mkdir(this.paths.dataDir, { recursive: true });
    if (await fileExists(this.paths.dbFile)) {
      // Osierocona baza bez klucza – nie kasujemy, tylko odkładamy na bok.
      await fs.rename(this.paths.dbFile, `${this.paths.dbFile}.orphan-${this.now()}`);
      await Promise.all(
        [`${this.paths.dbFile}-wal`, `${this.paths.dbFile}-shm`].map((f) =>
          fs.rm(f, { force: true }),
        ),
      );
    }
    const db = openEncrypted(this.paths.dbFile, pending.dek, { create: true });
    try {
      await bootstrapDatabase(db);
      await writeVaultFile(this.paths.vaultFile, pending.vault);
    } catch (error) {
      db.close();
      await fs.rm(this.paths.dbFile, { force: true });
      throw error;
    }
    this.vault = pending.vault;
    this.dek = pending.dek;
    this.db = db;
    this.pending = null;
    this.afterUnlock();
    return this.issueToken();
  }

  private clearPending(): void {
    this.pending?.dek.fill(0);
    this.pending = null;
  }

  // ── odblokowanie ────────────────────────────────────────────────────────────────────────────

  async unlock(password: string): Promise<string> {
    const vault = await this.loadVault();
    const dek = await this.guarded(() => unlockWithPassword(vault, password));
    return this.completeUnlock(vault, dek);
  }

  async unlockWithRecovery(recoveryKey: string, newPassword: string): Promise<string> {
    const vault = await this.loadVault();
    const dek = await this.guarded(() => unlockWithRecoveryKey(vault, recoveryKey));
    const rewrapped = await rewrapPassword(vault, dek, newPassword, this.kdf);
    await writeVaultFile(this.paths.vaultFile, rewrapped);
    return this.completeUnlock(rewrapped, dek);
  }

  private async loadVault(): Promise<VaultFile> {
    const vault = await readVaultFile(this.paths.vaultFile);
    if (!vault) throw new SessionError('bad_state', 'Aplikacja nie jest jeszcze skonfigurowana.');
    return vault;
  }

  private async completeUnlock(vault: VaultFile, dek: Uint8Array): Promise<string> {
    if (this.isUnlocked) {
      dek.fill(0); // już odblokowana – tylko wydajemy kolejny token (np. nowa karta przeglądarki)
      this.vault = vault;
      return this.issueToken();
    }
    const db = openEncrypted(this.paths.dbFile, dek);
    try {
      await bootstrapDatabase(db, {
        beforeMigrate: async (from, to) => {
          await createBackup({
            db,
            dek,
            vault,
            dir: this.paths.backupsDir,
            kind: 'pre-operation',
            label: `migracja ${from}-${to}`,
            appVersion: this.appVersion,
          });
        },
      });
    } catch (error) {
      db.close();
      dek.fill(0);
      throw error;
    }
    this.vault = vault;
    this.dek = dek;
    this.db = db;
    this.afterUnlock();
    return this.issueToken();
  }

  private afterUnlock(): void {
    this.settings = readSettings(this.requireUnlocked().db);
    this.lastActivity = this.now();
    this.registerSuccess();
  }

  // ── operacje na koncie ──────────────────────────────────────────────────────────────────────

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { dek, vault } = this.requireUnlocked();
    await this.guarded(() => unlockWithPassword(vault, currentPassword));
    const next = await rewrapPassword(vault, dek, newPassword, this.kdf);
    await writeVaultFile(this.paths.vaultFile, next);
    this.vault = next;
  }

  /** Zwraca nowy klucz odzyskiwania (do jednorazowego pokazania). Stary przestaje działać. */
  async rotateRecovery(password: string): Promise<string> {
    const { dek, vault } = this.requireUnlocked();
    await this.guarded(() => unlockWithPassword(vault, password));
    const rotated = await rotateRecoveryKey(vault, dek);
    await writeVaultFile(this.paths.vaultFile, rotated.vault);
    this.vault = rotated.vault;
    return rotated.recoveryKey;
  }

  updateSettings(patch: SettingsPatch): Settings {
    const { db } = this.requireUnlocked();
    this.settings = writeSettings(db, patch);
    return this.settings;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
