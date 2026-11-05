import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'Lumen';
export const APP_VERSION = '0.1.0';
export const PREFERRED_PORT = 47831;

export type AppPaths = {
  dataDir: string;
  vaultFile: string;
  dbFile: string;
  backupsDir: string;
  logsDir: string;
  lockFile: string;
};

/** Dane użytkownika leżą poza katalogiem kodu, żeby aktualizacje aplikacji ich nie dotykały. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LUMEN_DATA_DIR) return env.LUMEN_DATA_DIR;
  const base = env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, APP_NAME);
}

export function resolvePaths(dataDir: string = defaultDataDir()): AppPaths {
  return {
    dataDir,
    vaultFile: join(dataDir, 'vault.json'),
    dbFile: join(dataDir, 'lumen.db'),
    backupsDir: join(dataDir, 'backups'),
    logsDir: join(dataDir, 'logs'),
    lockFile: join(dataDir, 'server.lock'),
  };
}
