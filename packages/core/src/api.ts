import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.ts';

export const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`)
  .max(MAX_PASSWORD_LENGTH);

export const setupStartBody = z.object({ password: passwordField }).strict();
export const setupFinishBody = z
  .object({ answers: z.array(z.string().max(16)).length(3) })
  .strict();
export const unlockBody = z
  .object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) })
  .strict();
export const recoveryUnlockBody = z
  .object({ recoveryKey: z.string().min(10).max(120), newPassword: passwordField })
  .strict();
export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: passwordField,
  })
  .strict();
export const rotateRecoveryBody = z
  .object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) })
  .strict();

export type AppState = 'uninitialized' | 'locked' | 'unlocked';

export type StatusResponse = {
  state: AppState;
  version: string;
  /** sekundy do automatycznej blokady (tylko gdy odblokowana) */
  autoLockInSeconds: number | null;
  /** Jest plik bazy, ale brak vault.json (np. usunięty przypadkiem). Dotyczy stanu „uninitialized”. */
  orphanDatabase: boolean;
};

export type SetupStartResponse = {
  /** Klucz odzyskiwania – pokazywany tylko raz. */
  recoveryKey: string;
  /** Numery grup (od 1) do przepisania w kroku potwierdzenia. */
  challenge: number[];
};

export type BackupInfo = {
  name: string;
  createdAt: string;
  sizeBytes: number;
  kind: 'manual' | 'auto' | 'pre-operation';
  label?: string;
};

export type ApiError = { error: string; message: string; retryAfterSeconds?: number };
