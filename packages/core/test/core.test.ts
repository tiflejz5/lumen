import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  passwordStrength,
  settingsPatchSchema,
  settingsSchema,
  uuidv7,
} from '../src/index.ts';

describe('uuidv7', () => {
  it('ma poprawny format, wersję 7 i wariant RFC', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('koduje czas w pierwszych 48 bitach (sortowalność)', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(a.replace('-', '').slice(0, 12)).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });

  it('daje unikalne identyfikatory', () => {
    const set = new Set(Array.from({ length: 2000 }, () => uuidv7()));
    expect(set.size).toBe(2000);
  });

  it('odrzuca zbyt krótką losowość', () => {
    expect(() => uuidv7(1, new Uint8Array(3))).toThrow();
  });
});

describe('passwordStrength', () => {
  it('uznaje krótkie hasło za za krótkie', () => {
    expect(passwordStrength('abc').score).toBe(0);
  });
  it('wykrywa przewidywalne hasła', () => {
    expect(passwordStrength('qwerty123456').score).toBe(1);
  });
  it('wysoko ocenia długą frazę', () => {
    expect(passwordStrength('zielony koń skacze przez płot nocą').score).toBe(4);
  });
});

describe('settings', () => {
  it('domyślne ustawienia są poprawne', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
  it('odrzuca nieznane pola i wartości spoza zakresu', () => {
    expect(settingsPatchSchema.safeParse({ foo: 1 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ autoLockMinutes: 0 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ autoLockMinutes: 30 }).success).toBe(true);
  });
});
