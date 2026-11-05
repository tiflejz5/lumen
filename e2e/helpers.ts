import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { expect, type Page } from '@playwright/test';
import {
  makePack,
  makeRelease,
  makeTopic,
  type Release,
} from '../apps/server/test/fixtures/release';

export const PASSWORD = 'zielony koń skacze przez płot';

/** Przechodzi kreator pierwszej konfiguracji i zwraca klucz odzyskiwania. */
export async function setupVault(page: Page, password = PASSWORD): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByLabel('Powtórz hasło').fill(password);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: 'Twój klucz odzyskiwania' })).toBeVisible();
  const groups = await page
    .getByRole('list', { name: /Klucz odzyskiwania/ })
    .locator('li')
    .allInnerTexts();
  const parsed = groups.map((g) => g.split('\n').pop()!.trim());
  expect(parsed).toHaveLength(14);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(
    page.getByRole('heading', { name: 'Potwierdź, że klucz jest zapisany' }),
  ).toBeVisible();
  const labels = await page.locator('label', { hasText: /^Grupa nr/ }).allInnerTexts();
  const numbers = labels.map((l) => Number(l.replace(/\D/g, '')));
  const inputs = page.getByLabel(/Grupa nr/);
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(parsed[numbers[i]! - 1]!);
  await page.getByRole('button', { name: 'Utwórz zaszyfrowaną bazę' }).click();
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();
  return parsed.join('-');
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Zapisuje wydanie jako folder na dysku (do wyboru przez „Wybierz folder wydania”). */
export function writeReleaseFolder(release: Release, root: string): string {
  const dir = join(root, 'wydanie');
  for (const [path, bytes] of Object.entries(release.files)) {
    const full = join(dir, ...path.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, bytes);
  }
  return dir;
}

/** Zapisuje wydanie jako archiwum ZIP. */
export function writeReleaseZip(release: Release, file: string): string {
  const entries = Object.fromEntries(
    Object.entries(release.files).map(([p, b]) => [p, new Uint8Array(b)]),
  );
  writeFileSync(file, zipSync(entries));
  return file;
}

export { makePack, makeRelease, makeTopic };
