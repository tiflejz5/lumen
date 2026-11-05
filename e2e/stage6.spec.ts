import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import {
  PASSWORD,
  makePack,
  makeRelease,
  makeTopic,
  setupVault,
  tempDir,
  writeReleaseZip,
} from './helpers';

// Scenariusz sekwencyjny: kopia zapasowa, zmiana danych, przywrócenie z interfejsu, eksport/import.
let page: Page;
const dir = tempDir('lumen-e2e-kopie-');

const test = base.extend({});
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL: baseURL!,
    locale: 'pl-PL',
    acceptDownloads: true,
  });
  page = await context.newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

async function addNote(text: string) {
  await page.goto('/tematy/fin-0001');
  await page.getByLabel('Dodaj notatkę do tego tematu').fill(text);
  await page.getByRole('button', { name: 'Zapisz notatkę' }).click();
  await expect(page.getByText(text)).toBeVisible();
}

test('przygotowanie: konfiguracja, import tematów i pierwsza notatka', async () => {
  await setupVault(page);
  const topics = Array.from({ length: 3 }, (_, i) => makeTopic({ n: i + 1 }));
  const zip = writeReleaseZip(makeRelease([makePack('pack-001', topics)]), join(dir, 'w.zip'));
  await page.getByRole('link', { name: 'Zaimportuj bazę tematów' }).click();
  await page.getByLabel('Wybierz pliki lub archiwum ZIP').setInputFiles(zip);
  await expect(page.getByRole('heading', { name: /Podgląd wydania/ })).toBeVisible();
  await page.getByRole('button', { name: /Zaimportuj/ }).click();
  await addNote('Notatka przed kopią');
});

test('kopia ręczna i ostrzeżenie o braku kopii poza komputerem', async () => {
  await page.goto('/ustawienia');
  await expect(page.getByText('Brak kopii zapasowej')).toBeVisible();
  await page.getByRole('button', { name: 'Utwórz kopię teraz' }).click();
  await expect(page.getByText('Warto poprawić kopie zapasowe')).toBeVisible();
  await expect(page.getByText(/Kopie leżą tylko na tym komputerze/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Przywróć…' }).first()).toBeVisible();
});

test('przywracanie z interfejsu cofa późniejszą notatkę', async () => {
  await addNote('Notatka po kopii');
  await page.goto('/ustawienia');
  await page.getByRole('button', { name: 'Przywróć…' }).first().click();

  // błędne hasło jest odrzucone, a aplikacja zostaje odblokowana
  await page.getByLabel('Hasło z chwili wykonania kopii').fill('to jest złe hasło');
  await page.getByRole('button', { name: 'Sprawdź kopię' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Hasło z chwili wykonania kopii').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sprawdź kopię' }).click();
  await expect(page.getByRole('button', { name: 'Przywróć kopię' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Rozumiem/ }).check();
  await page.getByRole('button', { name: 'Przywróć kopię' }).click();
  await expect(page.getByText('Kopia została przywrócona.')).toBeVisible();

  await page.getByRole('button', { name: 'Przejdź do logowania' }).click();
  await expect(page.getByRole('heading', { name: 'Odblokuj bazę' })).toBeVisible();
  await page.getByLabel('Hasło', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Odblokuj', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();
  await page.goto('/notatki');
  await expect(page.getByText('Notatka przed kopią')).toBeVisible();
  await expect(page.getByText('Notatka po kopii')).toHaveCount(0);
});

test('eksport danych pobiera plik, a jego import niczego nie psuje', async () => {
  await page.goto('/ustawienia');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Eksportuj dane' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^lumen-dane-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(dir, 'dane.json');
  await download.saveAs(file);

  await page.getByLabel('Wybierz plik danych do importu').setInputFiles(file);
  await expect(page.getByText('Import zakończony')).toBeVisible();
  await expect(page.getByText('Wszystkie dane były już w tej bazie.')).toBeVisible();

  await page.getByLabel('Wybierz plik danych do importu').setInputFiles({
    name: 'zly.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nie":"to"}'),
  });
  await expect(page.getByText(/To nie jest poprawny plik danych Lumen/)).toBeVisible();
});

test('ekran odblokowania mieści się na telefonie bez poziomego przewijania', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 375, height: 800 },
  });
  const p = await ctx.newPage();
  await p.goto('/');
  // brak sesji w nowym kontekście -> ekran odblokowania
  await expect(p.getByRole('heading', { name: 'Odblokuj bazę' })).toBeVisible();
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await ctx.close();
});
