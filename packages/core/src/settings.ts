import { z } from 'zod';

export const settingsSchema = z.object({
  /** Po ilu minutach bezczynności baza jest blokowana. */
  autoLockMinutes: z.number().int().min(1).max(240),
  /** Godzina (0–6), od której zaczyna się „nowy dzień nauki”. */
  dayStartHour: z.number().int().min(0).max(6),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  dayStartHour: 3,
};

export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
