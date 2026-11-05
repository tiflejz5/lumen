import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { makePack, makeRelease, makeTopic, setupVault, tempDir, writeReleaseZip } from './helpers';

// Scenariusz sekwencyjny: baza wiedzy, powiązania, notatki przy temacie i wyszukiwanie.
let page: Page;
const dir = tempDir('lumen-e2e-wiedza-');

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
  await page.goto('/baza-wiedzy');
  await expect(page.getByText('Baza wiedzy jest pusta')).toBeVisible();
});

test('pojęcia i powiązania: brakujące pojęcie, potem link i odnośnik zwrotny', async () => {
  await page.getByRole('button', { name: 'Nowe pojęcie' }).click();
  await page.getByLabel('Pojęcie', { exact: true }).fill('Procent składany');
  await page
    .getByLabel('Definicja własnymi słowami')
    .fill('Odsetki od odsetek, zależne od [[Inflacja]].');
  await page.getByRole('button', { name: 'Dodaj pojęcie' }).click();
  await page.getByRole('link', { name: /^Procent składany/ }).click();
  // pojęcia „Inflacja” jeszcze nie ma – wyróżnione, bez linku
  await expect(page.getByText('Inflacja', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inflacja' })).toHaveCount(0);

  await page.goto('/baza-wiedzy');
  await page.getByRole('button', { name: 'Nowe pojęcie' }).click();
  await page.getByLabel('Pojęcie', { exact: true }).fill('inflacja');
  await page
    .getByLabel('Definicja własnymi słowami')
    .fill('Wzrost cen. Zob. [[Procent składany]].');
  await page.getByRole('button', { name: 'Dodaj pojęcie' }).click();
  // duplikat jest odrzucony czytelnym komunikatem
  await page.getByRole('button', { name: 'Nowe pojęcie' }).click();
  await page.getByLabel('Pojęcie', { exact: true }).fill('INFLACJA');
  await page.getByLabel('Definicja własnymi słowami').fill('x');
  await page.getByRole('button', { name: 'Dodaj pojęcie' }).click();
  await expect(page.getByText('Takie pojęcie już jest w bazie wiedzy.')).toBeVisible();

  await page.goto('/baza-wiedzy');
  await page.getByRole('link', { name: /^Procent składany/ }).click();
  await expect(page.getByRole('link', { name: 'Inflacja' }).first()).toBeVisible();
  await expect(page.getByText('Odwołują się do tego pojęcia')).toBeVisible();
});

test('wyszukiwanie pojęć ignoruje ogonki', async () => {
  await page.goto('/baza-wiedzy');
  await page.getByLabel('Szukaj w bazie wiedzy').fill('odsetki');
  await expect(page.getByRole('link', { name: /^Procent składany/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Wzrost cen/ })).toHaveCount(0);
});

test('notatka dodana przy temacie trafia do Notatek i da się ją znaleźć', async () => {
  await page.goto('/tematy');
  await page
    .getByRole('link', { name: /fin-0001|Obiekt|Temat/ })
    .first()
    .click();
  await page.getByLabel('Dodaj notatkę do tego tematu').fill('Zapamiętać: łańcuch dostaw.');
  await page.getByRole('button', { name: 'Zapisz notatkę' }).click();
  await expect(page.getByText('Zapamiętać: łańcuch dostaw.')).toBeVisible();

  await page.goto('/notatki');
  await page.getByLabel('Szukaj w notatkach').fill('lancuch');
  await expect(page.getByText('Zapamiętać: łańcuch dostaw.')).toBeVisible();
  await page.getByLabel('Szukaj w notatkach').fill('zzz');
  await expect(page.getByText('Zapamiętać: łańcuch dostaw.')).toHaveCount(0);
});

test('zapis pojęcia z sesji do bazy wiedzy', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rozpocznij sesję' }).click();
  await page.getByRole('button', { name: 'Przejdź do sprawdzenia' }).click();
  for (const n of [0, 1]) {
    await page.getByRole('radio').nth(n).check();
    await page.getByRole('button', { name: 'Sprawdź' }).first().click();
    await expect(page.getByText(/Dobrze\.|Nie tym razem\./)).toHaveCount(n + 1);
  }
  await page.getByRole('button', { name: 'Przejdź do wypowiedzi' }).click();
  await page.getByText('Pojęcia, mity i granice wiedzy').click();
  await page.getByRole('button', { name: 'Zapisz do bazy wiedzy' }).first().click();
  await expect(page.getByText('Zapisano')).toBeVisible();
  await page.goto('/baza-wiedzy');
  await expect(page.locator('ul li a[href^="/baza-wiedzy/"]')).toHaveCount(3);
});
