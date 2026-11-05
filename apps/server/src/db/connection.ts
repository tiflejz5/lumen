import Database from 'better-sqlite3-multiple-ciphers';

export type Db = Database.Database;

export class DbError extends Error {
  code: 'wrong_key' | 'not_found';
  constructor(code: 'wrong_key' | 'not_found', message: string) {
    super(message);
    this.name = 'DbError';
    this.code = code;
  }
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Otwiera bazę SQLCipher (AES-256 + HMAC na stronę) z surowym kluczem 256 bit.
 * Surowy klucz pomija PBKDF2 SQLCipher – wyprowadzanie z hasła robi już Argon2id w vaulcie.
 */
export function openEncrypted(
  file: string,
  dek: Uint8Array,
  options: { create?: boolean } = {},
): Db {
  const db = new Database(file, { fileMustExist: !options.create });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.pragma(`key="x'${hex(dek)}'"`);
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch {
      throw new DbError(
        'wrong_key',
        'Nie można otworzyć bazy tym kluczem (zły klucz lub uszkodzony plik).',
      );
    }
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('secure_delete = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
