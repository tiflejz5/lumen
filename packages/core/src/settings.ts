import { z } from 'zod';

export const settingsSchema = z.object({
  /** Po ilu minutach bezczynności baza jest blokowana. */
  autoLockMinutes: z.number().int().min(1).max(240),
  /** Godzina (0–6), od której zaczyna się „nowy dzień nauki”. */
  dayStartHour: z.number().int().min(0).max(6),
  /** Tryb demonstracyjny: losowanie obejmuje także tematy przykładowe z paczek `is_example`. */
  demoMode: z.boolean(),
  /** Automatyczne kopie zapasowe (raz na dobę, przy odblokowaniu i co godzinę podczas pracy). */
  autoBackup: z.boolean(),
  /** Ile ostatnich kopii automatycznych zachować (ręcznych nie usuwamy nigdy). */
  autoBackupKeep: z.number().int().min(1).max(60),
  /** Dodatkowy folder na kopie (pendrive, dysk zewnętrzny, folder synchronizowany z chmurą). Pusty = brak. */
  backupMirrorDir: z.string().max(500),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  dayStartHour: 3,
  demoMode: false,
  autoBackup: true,
  autoBackupKeep: 7,
  backupMirrorDir: '',
};

export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
