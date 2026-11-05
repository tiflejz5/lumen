import { randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import _sodium from 'libsodium-wrappers-sumo';
import { base32Decode, base32Encode, fromBase64, toBase64 } from './encoding.ts';

/**
 * Vault – klucze aplikacji.
 *
 *   hasło ──Argon2id──► KEK ──┐
 *                             ├─► opakowują ten sam losowy DEK (klucz bazy)
 *   klucz odzyskiwania ──────►┘
 *
 * Zmiana hasła przepakowuje tylko DEK – baza nie jest szyfrowana od nowa.
 * Używamy wyłącznie sprawdzonych prymitywów libsodium (Argon2id, XChaCha20-Poly1305, BLAKE2b).
 */

const MiB = 1024 * 1024;
const DEK_BYTES = 32;
const RECOVERY_BYTES = 32;
const SALT_BYTES = 16;
const GROUP_SIZE = 4;

export const PRODUCTION_KDF = { opslimit: 3, memlimit: 256 * MiB } as const;
const FALLBACK_KDF = { opslimit: 3, memlimit: 64 * MiB } as const;

export type KdfParams = { opslimit: number; memlimit: number };

export type VaultErrorCode =
  'wrong_password' | 'invalid_recovery_key' | 'wrong_recovery_key' | 'corrupt_vault';

export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

const wrapped = z.object({ nonce: z.string(), ct: z.string() });

export const vaultFileSchema = z.object({
  v: z.literal(1),
  createdAt: z.string(),
  kdf: z.object({
    alg: z.literal('argon2id13'),
    salt: z.string(),
    // Dolne ograniczenie chroni przed podstawieniem absurdalnie słabych parametrów, górne przed DoS.
    opslimit: z.number().int().min(2).max(12),
    memlimit: z
      .number()
      .int()
      .min(16 * MiB)
      .max(1024 * MiB),
  }),
  pw: wrapped,
  rk: wrapped,
});
export type VaultFile = z.infer<typeof vaultFileSchema>;

async function sodium(): Promise<typeof _sodium> {
  await _sodium.ready;
  return _sodium;
}

const AD_PW = new TextEncoder().encode('lumen-vault-v1|pw');
const AD_RK = new TextEncoder().encode('lumen-vault-v1|rk');

/** Hasło normalizujemy (NFKC), aby ten sam tekst z różnych klawiatur dawał ten sam klucz. */
function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'));
}

async function deriveKek(password: string, kdf: VaultFile['kdf']): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_pwhash(
    32,
    passwordBytes(password),
    fromBase64(kdf.salt),
    kdf.opslimit,
    kdf.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

async function recoveryWrapKey(rk: Uint8Array): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_kdf_derive_from_key(32, 1, 'lumenrk1', rk);
}

async function wrap(key: Uint8Array, plain: Uint8Array, ad: Uint8Array) {
  const s = await sodium();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, ad, null, nonce, key);
  return { nonce: toBase64(nonce), ct: toBase64(ct) };
}

async function unwrap(
  key: Uint8Array,
  w: { nonce: string; ct: string },
  ad: Uint8Array,
): Promise<Uint8Array | null> {
  const s = await sodium();
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(w.ct),
      ad,
      fromBase64(w.nonce),
      key,
    );
  } catch {
    return null;
  }
}

// ── klucz odzyskiwania: 32 bajty losowe + 4 znaki sumy kontrolnej, zapis w grupach po 4 ─────────

async function recoveryChecksum(rk: Uint8Array): Promise<string> {
  const s = await sodium();
  const digest = s.crypto_generichash(3, rk, new TextEncoder().encode('lumen-rk-checksum'));
  return base32Encode(digest).slice(0, 4);
}

export async function formatRecoveryKey(rk: Uint8Array): Promise<string> {
  const text = base32Encode(rk) + (await recoveryChecksum(rk));
  return (text.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g')) ?? []).join('-');
}

/** Zwraca bajty klucza albo null, gdy tekst jest błędny (zły format lub suma kontrolna). */
export async function parseRecoveryKey(text: string): Promise<Uint8Array | null> {
  const chars = Math.ceil((RECOVERY_BYTES * 8) / 5);
  const clean = text.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== chars + 4) return null;
  const rk = base32Decode(clean.slice(0, chars), RECOVERY_BYTES);
  if (!rk) return null;
  const expected = await recoveryChecksum(rk);
  const given = clean.slice(chars).replace(/O/g, '0').replace(/[IL]/g, '1');
  return given === expected ? rk : null;
}

/** Wybiera 3 różne numery grup (od 1) do potwierdzenia, że użytkownik zapisał klucz. */
export function pickChallenge(groupCount: number, count = 3): number[] {
  const picked = new Set<number>();
  while (picked.size < count) picked.add(randomInt(1, groupCount + 1));
  return [...picked].sort((a, b) => a - b);
}

export function checkChallengeAnswers(
  formattedKey: string,
  challenge: number[],
  answers: string[],
): boolean {
  const groups = formattedKey.split('-');
  if (challenge.length !== answers.length) return false;
  return challenge.every((n, i) => {
    const expected = groups[n - 1];
    const given = (answers[i] ?? '')
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
    return expected !== undefined && given === expected;
  });
}

// ── operacje na vaulcie ──────────────────────────────────────────────────────────────────────

/** Dobiera parametry Argon2id tak, by odblokowanie trwało rozsądnie (cel ≲ 1,5 s). */
export async function calibrateKdf(): Promise<KdfParams> {
  const s = await sodium();
  const started = performance.now();
  s.crypto_pwhash(
    32,
    new Uint8Array([1]),
    s.randombytes_buf(SALT_BYTES),
    PRODUCTION_KDF.opslimit,
    PRODUCTION_KDF.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
  return performance.now() - started > 2500 ? { ...FALLBACK_KDF } : { ...PRODUCTION_KDF };
}

export type CreatedVault = {
  vault: VaultFile;
  dek: Uint8Array;
  /** Sformatowany klucz odzyskiwania – do jednorazowego pokazania. */
  recoveryKey: string;
};

export async function createVault(password: string, kdf?: KdfParams): Promise<CreatedVault> {
  const s = await sodium();
  const params = kdf ?? (await calibrateKdf());
  const dek = s.randombytes_buf(DEK_BYTES);
  const rk = s.randombytes_buf(RECOVERY_BYTES);
  const kdfSection = {
    alg: 'argon2id13' as const,
    salt: toBase64(s.randombytes_buf(SALT_BYTES)),
    opslimit: params.opslimit,
    memlimit: params.memlimit,
  };
  const kek = await deriveKek(password, kdfSection);
  const vault: VaultFile = {
    v: 1,
    createdAt: new Date().toISOString(),
    kdf: kdfSection,
    pw: await wrap(kek, dek, AD_PW),
    rk: await wrap(await recoveryWrapKey(rk), dek, AD_RK),
  };
  const recoveryKey = await formatRecoveryKey(rk);
  s.memzero(kek);
  s.memzero(rk);
  return { vault, dek, recoveryKey };
}

export async function unlockWithPassword(vault: VaultFile, password: string): Promise<Uint8Array> {
  const kek = await deriveKek(password, vault.kdf);
  const dek = await unwrap(kek, vault.pw, AD_PW);
  (await sodium()).memzero(kek);
  if (!dek || dek.length !== DEK_BYTES) {
    throw new VaultError('wrong_password', 'Nieprawidłowe hasło.');
  }
  return dek;
}

export async function unlockWithRecoveryKey(
  vault: VaultFile,
  recoveryKey: string,
): Promise<Uint8Array> {
  const rk = await parseRecoveryKey(recoveryKey);
  if (!rk) {
    throw new VaultError(
      'invalid_recovery_key',
      'Klucz odzyskiwania ma nieprawidłowy format lub zawiera literówkę.',
    );
  }
  const dek = await unwrap(await recoveryWrapKey(rk), vault.rk, AD_RK);
  (await sodium()).memzero(rk);
  if (!dek || dek.length !== DEK_BYTES) {
    throw new VaultError('wrong_recovery_key', 'Ten klucz odzyskiwania nie pasuje do tej bazy.');
  }
  return dek;
}

/** Nowe hasło = nowa sól i nowy KEK; DEK i klucz odzyskiwania bez zmian. */
export async function rewrapPassword(
  vault: VaultFile,
  dek: Uint8Array,
  newPassword: string,
  kdf?: KdfParams,
): Promise<VaultFile> {
  const s = await sodium();
  const params = kdf ?? { opslimit: vault.kdf.opslimit, memlimit: vault.kdf.memlimit };
  const kdfSection = {
    alg: 'argon2id13' as const,
    salt: toBase64(s.randombytes_buf(SALT_BYTES)),
    opslimit: params.opslimit,
    memlimit: params.memlimit,
  };
  const kek = await deriveKek(newPassword, kdfSection);
  const next: VaultFile = { ...vault, kdf: kdfSection, pw: await wrap(kek, dek, AD_PW) };
  s.memzero(kek);
  return next;
}

/** Unieważnia stary klucz odzyskiwania i tworzy nowy dla tego samego DEK. */
export async function rotateRecoveryKey(
  vault: VaultFile,
  dek: Uint8Array,
): Promise<{ vault: VaultFile; recoveryKey: string }> {
  const s = await sodium();
  const rk = s.randombytes_buf(RECOVERY_BYTES);
  const next: VaultFile = { ...vault, rk: await wrap(await recoveryWrapKey(rk), dek, AD_RK) };
  const recoveryKey = await formatRecoveryKey(rk);
  s.memzero(rk);
  return { vault: next, recoveryKey };
}

// ── plik vault.json ──────────────────────────────────────────────────────────────────────────

export function parseVaultFile(text: string): VaultFile {
  try {
    return vaultFileSchema.parse(JSON.parse(text));
  } catch {
    throw new VaultError(
      'corrupt_vault',
      'Plik vault.json jest uszkodzony lub ma nieznany format.',
    );
  }
}

export async function readVaultFile(path: string): Promise<VaultFile | null> {
  try {
    return parseVaultFile(await fs.readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Zapis atomowy: plik tymczasowy → fsync → rename. Nie zostawiamy kopii poprzedniej wersji,
 * bo przechowywałaby opakowanie klucza otwierane starym hasłem.
 */
export async function writeVaultFile(path: string, vault: VaultFile): Promise<void> {
  const tmp = `${path}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(vault, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, path);
}
