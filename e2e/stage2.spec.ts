import { join } from 'node:path';
import { expect, test as base, type Browser, type Page } from '@playwright/test';
import {
  makePack,
  makeRelease,
  makeTopic,
  setupVault,
  tempDir,
  writeReleaseFolder,
  writeReleaseZip,
} from './helpers';

// Scenariusz sekwencyjny na jednej karcie przeglądarki i jednej bazie.
let page: Page;
const dir = tempDir('lumen-e2e-pliki-');
const externalRequests: string[] = [];
const consoleProblems: string[] = [];

const test = base.extend({});
test.describe.configure({ mode: 'serial' });

// Wydanie 1: 6 poprawnych tematów + 1 celowo nieprawidłowy rekord (brak tytułu).
function releaseV1() {
  const topics: Record<string, unknown>[] = Array.from({ length: 6 }, (_, i) =>
    makeTopic({ n: i + 1 }),
  );
  const broken = makeTopic({ n: 7 }) as { core: Record<string, unknown> };
  delete broken.core.title;
  return makeRelease([makePack('pack-001', [...topics, broken])]);
}

// Wydanie 2: ten sam zestaw, ale temat nr 4 ma nową rewizję (aktualizacja).
function releaseV2() {
  const topics = Array.from({ length: 6 }, (_, i) =>
    makeTopic({
      n: i + 1,
      ...(i === 3
        ? {
            revision: 2,
            core: {
              summary:
                'Zaktualizowany opis tematu, który po zmianie jest dostatecznie długi, by spełnić wymagania schematu.',
            },
          }
        : {}),
    }),
  );
  return makeRelease([makePack('pack-001', topics)], { baseVersion: '0.2.0' });
}

test.beforeAll(async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
  const context = await browser.newContext({ baseURL: baseURL!, locale: 'pl-PL' });
  page = await context.newPage();
  page.on('request', (req) => {
    if (!req.url().startsWith(baseURL!) && !req.url().startsWith('data:'))
      externalRequests.push(req.url());
  });
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()))
      consoleProblems.push(`${msg.type()}: ${msg.text()}`);
  });
});
test.afterAll(async () => {
  await page.context().close();
});

test('pusta baza: ekran „Dziś” zachęca do importu', async () => {
  await setupVault(page);
  await expect(page.getByText('Nie ma jeszcze tematów do nauki')).toBeVisible();
  await page.getByRole('link', { name: 'Zaimportuj bazę tematów' }).click();
  await expect(page.getByRole('heading', { name: 'Import tematów' })).toBeVisible();
});

test('import z pliku ZIP: podgląd, odrzucenie błędnego rekordu i zatwierdzenie', async () => {
  const zip = writeReleaseZip(releaseV1(), join(dir, 'wydanie-1.zip'));
  await page.getByLabel('Wybierz pliki lub archiwum ZIP').setInputFiles(zip);

  await expect(page.getByRole('heading', { name: /Podgląd wydania/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Nowy \d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Nieprawidłowy 1$/ })).toBeVisible();

  // nowe tematy domyślnie zaznaczone, nieprawidłowy – zablokowany
  await expect(page.getByRole('checkbox', { name: 'Importuj fin-0001' })).toBeChecked();
  await page.getByRole('button', { name: /^Nieprawidłowy/ }).click();
  const invalid = page.getByRole('checkbox', { name: /Importuj/ });
  await expect(invalid).toHaveCount(1);
  await expect(invalid.first()).toBeDisabled();
  await page
    .getByRole('button', { name: /Szczegóły/ })
    .first()
    .click();
  await expect(page.getByText('Błędy', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Wszystkie/ }).click();
  await page.getByRole('button', { name: 'Zaimportuj zaznaczone (6)' }).click();

  await expect(page.getByRole('heading', { name: 'Import zakończony' })).toBeVisible();
  await expect(page.getByText('Przed importem wykonano kopię zapasową')).toBeVisible();
  await expect(page.getByText('Odrzucone jako nieprawidłowe')).toBeVisible();
});

test('baza tematów: statystyki, wyszukiwanie bez względu na polskie znaki, szczegóły bez odpowiedzi', async () => {
  await page.goto('/tematy');
  await expect(page.getByRole('heading', { name: 'Baza tematów' })).toBeVisible();
  await expect(page.getByText('Tematy aktywne')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Tematy \(6\)/ })).toBeVisible();

  await page.getByLabel('Szukaj tematów').fill('zegar wahadlowy');
  await expect(page.getByRole('heading', { name: /Tematy \(1\)/ })).toBeVisible();
  await page.getByRole('link', { name: /zegar wahadłowy/ }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('zegar wahadłowy');
  await expect(page.getByRole('heading', { name: 'Pytanie główne' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pytania badawcze' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sugerowane źródła' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Źródło testowe A' })).toHaveAttribute(
    'rel',
    /noopener/,
  );
  // warstwa rozszerzona i quiz są ukryte do czasu sesji
  await expect(page.getByText('Opracowanie', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Pora dnia')).toHaveCount(0);
});

test('temat dnia: stały po odświeżeniu, z uzasadnieniem; dodatkowe losowanie jest inne', async () => {
  await page.goto('/');
  const title = page.getByRole('heading', { level: 2 }).first();
  await expect(title).toBeVisible();
  const first = (await title.innerText()).trim();
  expect(first.length).toBeGreaterThan(10);

  await page.reload();
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(first);

  await page.getByRole('button', { name: 'Dlaczego ten temat?' }).click();
  await expect(page.getByText('Równowaga kategorii')).toBeVisible();
  await expect(page.getByText('Dopasowanie trudności')).toBeVisible();

  await page.getByRole('button', { name: 'Wylosuj dodatkowy temat' }).click();
  const extra = page.getByRole('heading', { level: 3 }).first();
  await expect(extra).toBeVisible();
  expect((await extra.innerText()).trim()).not.toBe(first);
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText(first);
});

test('oznaczenie tematu dnia jako nieinteresującego losuje inny temat', async () => {
  await page.goto('/');
  const before = (await page.getByRole('heading', { level: 2 }).first().innerText()).trim();
  await page.getByRole('button', { name: 'Nieinteresujący' }).click();
  await expect(page.getByRole('heading', { level: 2 }).first()).not.toHaveText(before);
});

test('ponowny import tego samego wydania nie ma nic do zrobienia', async () => {
  await page.goto('/tematy/import');
  await page.getByLabel('Wybierz pliki lub archiwum ZIP').setInputFiles(join(dir, 'wydanie-1.zip'));
  await expect(page.getByRole('button', { name: /^Bez zmian 6$/ })).toBeVisible();
  await expect(page.getByText('baza jest już aktualna')).toBeVisible();
  await expect(page.getByRole('button', { name: /Zaimportuj zaznaczone/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Anuluj' }).click();
});

test('aktualizacja wymaga świadomej zgody i zachowuje dane użytkownika', async () => {
  // przed aktualizacją oznaczamy jeden temat (dane użytkownika)
  await page.goto('/tematy');
  await page.getByRole('link', { name: /peryskop/ }).click();
  await page.getByRole('button', { name: 'Znam ten temat' }).click();
  await expect(page.getByText('Znany', { exact: true }).first()).toBeVisible();

  await page.goto('/tematy/import');
  const folder = writeReleaseFolder(releaseV2(), tempDir('lumen-e2e-v2-'));
  await page.getByLabel('Wybierz folder wydania').setInputFiles(folder);

  await expect(page.getByRole('heading', { name: /Podgląd wydania/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Aktualizacja 1$/ })).toBeVisible();
  const update = page.getByRole('checkbox', { name: 'Importuj his-0001' }); // „zegar wahadłowy” (n=4)
  await page.getByRole('button', { name: /^Aktualizacja/ }).click();
  await expect(update).not.toBeChecked(); // domyślnie niezaznaczona
  await expect(page.getByRole('button', { name: /Zaimportuj zaznaczone \(0\)/ })).toBeVisible();
  await page.getByRole('button', { name: /Szczegóły/ }).click();
  await expect(page.locator('p', { hasText: 'Zmienione:' })).toContainText('opis');

  await update.check();
  await page.getByRole('button', { name: 'Zaimportuj zaznaczone (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Import zakończony' })).toBeVisible();

  // dane użytkownika pozostały
  await page.goto('/tematy');
  await page.getByLabel('Szukaj tematów').fill('peryskop');
  await page.getByRole('link', { name: /peryskop/ }).click();
  await expect(page.getByText('Znany', { exact: true }).first()).toBeVisible();

  // historia importów
  await page.goto('/tematy/importy');
  await expect(page.getByRole('link', { name: /Wydanie/ })).toHaveCount(2);
});

test('widok mobilny: lista tematów, import i ekran główny bez poziomego przewijania', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/tematy', '/tematy/import', '/tematy/importy', '/ustawienia']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Nawigacja mobilna' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `przepełnienie poziome na ${path}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('prywatność: żadnych zapytań poza własnym serwerem i brak błędów w konsoli', async () => {
  expect(externalRequests, 'zapytania na zewnątrz').toEqual([]);
  expect(consoleProblems, 'błędy lub ostrzeżenia w konsoli (np. naruszenia CSP)').toEqual([]);
});
