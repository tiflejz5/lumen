import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { makePack, makeRelease, makeTopic, setupVault, tempDir, writeReleaseZip } from './helpers';

// Scenariusz sekwencyjny: ukończenie tematu planuje powtórkę; statystyki i odznaki odzwierciedlają postęp.
let page: Page;
const dir = tempDir('lumen-e2e-postep-');

const test = base.extend({});
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL!, locale: 'pl-PL' });
  page = await context.newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('przygotowanie: konfiguracja i import tematów', async () => {
  await setupVault(page);
  const topics = Array.from({ length: 3 }, (_, i) => makeTopic({ n: i + 1 }));
  const zip = writeReleaseZip(makeRelease([makePack('pack-001', topics)]), join(dir, 'w.zip'));
  await page.getByRole('link', { name: 'Zaimportuj bazę tematów' }).click();
  await page.getByLabel('Wybierz pliki lub archiwum ZIP').setInputFiles(zip);
  await expect(page.getByRole('heading', { name: /Podgląd wydania/ })).toBeVisible();
  await page.getByRole('button', { name: /Zaimportuj/ }).click();
});

test('puste statystyki, osiągnięcia i powtórki zachęcają do pierwszej sesji', async () => {
  await page.goto('/statystyki');
  await expect(page.getByText('Statystyki pojawią się po pierwszej sesji')).toBeVisible();
  await page.goto('/osiagniecia');
  await expect(page.getByText('Zdobyte: 0 z 10')).toBeVisible();
  await page.goto('/powtorki');
  await expect(page.getByText('Brak powtórek na dziś')).toBeVisible();
});

test('ukończona sesja: seria, statystyki, odznaka i zaplanowana powtórka', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rozpocznij sesję' }).click();
  await page.getByRole('button', { name: 'Przejdź do sprawdzenia' }).click();
  for (const n of [0, 1]) {
    await page
      .getByRole('radio')
      .nth(n === 0 ? 1 : 1)
      .check();
    await page.getByRole('button', { name: 'Sprawdź' }).first().click();
    await expect(page.getByText(/Dobrze\.|Nie tym razem\./)).toHaveCount(n + 1);
  }
  await page.getByRole('button', { name: 'Przejdź do wypowiedzi' }).click();
  await page.getByRole('button', { name: '3', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Zakończ i zalicz temat' }).click();
  await expect(page.getByText('Dzień zaliczony')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Seria: 1 dni')).toBeVisible();

  await page.goto('/statystyki');
  await expect(page.getByRole('heading', { name: 'Ostatnie 30 dni' })).toBeVisible();
  await expect(page.getByText('Ukończone tematy')).toBeVisible();
  await expect(page.getByRole('img', { name: /Aktywność w ostatnich 30 dniach/ })).toBeVisible();

  await page.goto('/osiagniecia');
  await expect(page.getByText('Zdobyte: 1 z 10')).toBeVisible();

  // powtórka jest zaplanowana na jutro, więc dziś nic do zrobienia, ale jest na liście
  await page.goto('/powtorki');
  await expect(page.getByText('Brak powtórek na dziś')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Najbliższe powtórki' })).toBeVisible();
});

test('widok mobilny: nowe ekrany bez poziomego przewijania', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/', '/powtorki', '/statystyki', '/osiagniecia']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(false);
  }
});
