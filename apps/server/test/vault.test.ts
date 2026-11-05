import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkChallengeAnswers,
  createVault,
  parseRecoveryKey,
  parseVaultFile,
  pickChallenge,
  readVaultFile,
  rewrapPassword,
  rotateRecoveryKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  VaultError,
  writeVaultFile,
  type CreatedVault,
} from '../src/vault/vault.ts';

const FAST = { opslimit: 2, memlimit: 16 * 1024 * 1024 };
const PASSWORD = 'zielony koń skacze przez płot';

let created: CreatedVault;

beforeAll(async () => {
  created = await createVault(PASSWORD, FAST);
});

async function expectVaultError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'VaultError', code });
}

describe('vault – hasło', () => {
  it('odblokowuje poprawnym hasłem i zwraca ten sam DEK', async () => {
    const dek = await unlockWithPassword(created.vault, PASSWORD);
    expect(Buffer.from(dek).equals(Buffer.from(created.dek))).toBe(true);
    expect(dek.length).toBe(32);
  });

  it('odrzuca złe hasło', async () => {
    await expectVaultError(
      unlockWithPassword(created.vault, 'zielony kon skacze przez plot'),
      'wrong_password',
    );
  });

  it('normalizuje Unicode (ą złożone i rozłożone to to samo hasło)', async () => {
    const composedPassword = 'pąk kwiatowy rośnie'; // ą, ś jako pojedyncze znaki
    const decomposedPassword = 'pąk kwiatowy rośnie'; // a + ogonek, s + akcent
    expect(decomposedPassword).not.toBe(composedPassword);
    const vault = await createVault(composedPassword, FAST);
    await expect(unlockWithPassword(vault.vault, decomposedPassword)).resolves.toBeDefined();
  });

  it('wykrywa podmianę zaszyfrowanego klucza', async () => {
    const tampered = structuredClone(created.vault);
    const bytes = Buffer.from(tampered.pw.ct, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    tampered.pw.ct = bytes.toString('base64');
    await expectVaultError(unlockWithPassword(tampered, PASSWORD), 'wrong_password');
  });

  it('wykrywa podmianę soli KDF', async () => {
    const tampered = structuredClone(created.vault);
    tampered.kdf.salt = Buffer.alloc(16, 7).toString('base64');
    await expectVaultError(unlockWithPassword(tampered, PASSWORD), 'wrong_password');
  });

  it('dwa vaulty z tym samym hasłem mają różne sole i różne DEK', async () => {
    const other = await createVault(PASSWORD, FAST);
    expect(other.vault.kdf.salt).not.toBe(created.vault.kdf.salt);
    expect(Buffer.from(other.dek).equals(Buffer.from(created.dek))).toBe(false);
  });
});

describe('vault – klucz odzyskiwania', () => {
  it('ma 14 grup po 4 znaki', () => {
    expect(created.recoveryKey).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  });

  it('odblokowuje tym samym DEK co hasło', async () => {
    const dek = await unlockWithRecoveryKey(created.vault, created.recoveryKey);
    expect(Buffer.from(dek).equals(Buffer.from(created.dek))).toBe(true);
  });

  it('toleruje małe litery, spacje i typowe pomyłki (O→0, I/L→1)', async () => {
    const sloppy = created.recoveryKey
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/0/g, 'o')
      .replace(/1/g, 'l');
    await expect(unlockWithRecoveryKey(created.vault, sloppy)).resolves.toBeDefined();
  });

  it('wykrywa literówkę sumą kontrolną', async () => {
    const chars = created.recoveryKey.split('');
    const idx = chars.findIndex((c) => c !== '-');
    chars[idx] = chars[idx] === '2' ? '3' : '2';
    await expectVaultError(
      unlockWithRecoveryKey(created.vault, chars.join('')),
      'invalid_recovery_key',
    );
  });

  it('odrzuca poprawny format klucza z innej bazy', async () => {
    const other = await createVault('zupełnie inne hasło 123', FAST);
    await expectVaultError(
      unlockWithRecoveryKey(created.vault, other.recoveryKey),
      'wrong_recovery_key',
    );
  });

  it('odrzuca śmieci', async () => {
    expect(await parseRecoveryKey('abc')).toBeNull();
    await expectVaultError(
      unlockWithRecoveryKey(created.vault, 'x'.repeat(60)),
      'invalid_recovery_key',
    );
  });
});

describe('vault – zmiana hasła i rotacja klucza', () => {
  it('nowe hasło działa, stare nie, klucz odzyskiwania nadal ważny, DEK bez zmian', async () => {
    const next = await rewrapPassword(created.vault, created.dek, 'zupełnie nowe hasło 2026', FAST);
    await expectVaultError(unlockWithPassword(next, PASSWORD), 'wrong_password');
    const dek = await unlockWithPassword(next, 'zupełnie nowe hasło 2026');
    expect(Buffer.from(dek).equals(Buffer.from(created.dek))).toBe(true);
    await expect(unlockWithRecoveryKey(next, created.recoveryKey)).resolves.toBeDefined();
    expect(next.kdf.salt).not.toBe(created.vault.kdf.salt);
  });

  it('rotacja unieważnia stary klucz odzyskiwania i nie rusza hasła', async () => {
    const { vault, recoveryKey } = await rotateRecoveryKey(created.vault, created.dek);
    expect(recoveryKey).not.toBe(created.recoveryKey);
    await expectVaultError(unlockWithRecoveryKey(vault, created.recoveryKey), 'wrong_recovery_key');
    await expect(unlockWithRecoveryKey(vault, recoveryKey)).resolves.toBeDefined();
    await expect(unlockWithPassword(vault, PASSWORD)).resolves.toBeDefined();
  });
});

describe('vault – potwierdzenie zapisu klucza', () => {
  it('wybiera 3 różne numery z zakresu', () => {
    for (let i = 0; i < 50; i++) {
      const c = pickChallenge(14);
      expect(new Set(c).size).toBe(3);
      expect(c.every((n) => n >= 1 && n <= 14)).toBe(true);
    }
  });

  it('akceptuje poprawne grupy, odrzuca błędne', () => {
    const groups = created.recoveryKey.split('-');
    const challenge = [2, 5, 14];
    const good = challenge.map((n) => groups[n - 1]!.toLowerCase());
    expect(checkChallengeAnswers(created.recoveryKey, challenge, good)).toBe(true);
    expect(
      checkChallengeAnswers(created.recoveryKey, challenge, [good[0]!, good[1]!, 'ZZZZ']),
    ).toBe(false);
    expect(checkChallengeAnswers(created.recoveryKey, challenge, good.slice(0, 2))).toBe(false);
  });
});

describe('vault.json', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lumen-vault-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('zapis i odczyt zachowują zawartość; brak pliku → null', async () => {
    const path = join(dir, 'vault.json');
    expect(await readVaultFile(path)).toBeNull();
    await writeVaultFile(path, created.vault);
    expect(await readVaultFile(path)).toEqual(created.vault);
  });

  it('nie zawiera jawnych sekretów', async () => {
    const path = join(dir, 'vault-secrets.json');
    await writeVaultFile(path, created.vault);
    const text = await readFile(path, 'utf8');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(created.recoveryKey);
    expect(text).not.toContain(Buffer.from(created.dek).toString('base64'));
  });

  it('odrzuca uszkodzony plik i zbyt słabe parametry KDF', () => {
    expect(() => parseVaultFile('{nie json')).toThrow(VaultError);
    const weak = structuredClone(created.vault);
    weak.kdf.memlimit = 1024;
    expect(() => parseVaultFile(JSON.stringify(weak))).toThrow(VaultError);
  });
});
