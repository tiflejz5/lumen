/** Typy API kopii zapasowych oraz eksportu i importu danych użytkownika. */

export type BackupHealth = {
  lastBackupAt: string | null;
  lastAutoAt: string | null;
  ageDays: number | null;
  mirrorDir: string;
  lastMirrorAt: string | null;
  mirrorError: string | null;
  /** none = brak kopii, warn = kopia stara lub tylko na tym dysku, ok = wszystko w porządku */
  level: 'none' | 'warn' | 'ok';
  message: string;
};

export type RestoreRequest = {
  name: string;
  source: 'local' | 'mirror';
  password?: string;
  recoveryKey?: string;
};

export type RestorePreviewDto = {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  vaultWillBeReplaced: boolean;
};

export type UserDataTableReport = {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

export type UserDataImportReport = {
  exportedAt: string | null;
  tables: Record<string, UserDataTableReport>;
  notes: string[];
};

export const USER_DATA_FORMAT = 'lumen-user-data';
export const USER_DATA_VERSION = 1;
