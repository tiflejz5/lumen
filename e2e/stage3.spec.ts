import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { makePack, makeRelease, makeTopic, setupVault, tempDir, writeReleaseZip } from './helpers';

// Scenariusz sekwencyjny: import 6 tematów, pełna sesja nauki tematu dnia, historia i notatki.
let page: Page;
const dir = tempDir('lumen-e2e-sesja-');

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
  const topics = Array.from({ length: 6 }, (_, i) => makeTopic({ n: i + 1 }));
  const zip = writeReleaseZip(makeRelease([makePack('pack-001', topics)]), join(dir, 'w.zip'));
  await page.getByRole('link', { name: 'Zaimportuj bazę tematów' }).click();
  await page.getByLabel('Wybierz pliki lub archiwum ZIP').setInputFiles(zip);
  await expect(page.getByRole('heading', { name: /Podgląd wydania/ })).toBeVisible();
  await page.getByRole('button', { name: /Zaimportuj/ }).click();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Rozpocznij sesję' })).toBeVisible();
});

test('pełna sesja: research, quiz, wypowiedź, zaliczenie dnia', async () => {
  await page.getByRole('button', { name: 'Rozpocznij sesję' }).click();
  await expect(page.getByRole('list', { name: 'Etapy sesji' })).toBeVisible();
  await expect(page.getByText('Pytania badawcze')).toBeVisible();
  // quiz i opracowanie nie są jeszcze widoczne
  await expect(page.getByText('Sprawdź', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Przejdź do sprawdzenia' }).click();
  await expect(page.getByRole('button', { name: 'Przejdź do wypowiedzi' })).toBeDisabled();
  for (const n of [0, 1]) {
    await page
      .getByRole('radio')
      .nth(n === 0 ? 0 : 1)
      .check();
    await page.getByRole('button', { name: 'Sprawdź' }).first().click();
    await expect(page.getByText(/Dobrze\.|Nie tym razem\./)).toHaveCount(n + 1);
  }
  await page.getByRole('button', { name: 'Przejdź do wypowiedzi' }).click();
  await expect(page.getByText('Zadanie: wypowiedz się')).toBeVisible();

  await page.getByLabel('Moje podsumowanie (opcjonalnie)').fill('Zapamiętam najważniejsze.');
  await page.getByRole('button', { name: '5', exact: true }).first().click();
  await page.getByRole('button', { name: 'W sam raz' }).click();
  await page.getByRole('button', { name: 'Zakończ i zalicz temat' }).click();
  await expect(page.getByText('Dzień zaliczony')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Dzień zaliczony')).toBeVisible();
});

test('historia i notatki pokazują zakończoną sesję', async () => {
  await page.goto('/historia');
  await expect(page.getByText('Ukończony')).toBeVisible();
  await page.goto('/notatki');
  await expect(page.getByText('Zapamiętam najważniejsze.')).toBeVisible();
});

test('niedokończona sesja trafia do listy „Niedokończone”', async () => {
  await page.goto('/');
  const res = await page.request.post('/api/daily/extra', {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  const extra = (await res.json()) as { topic: { id: string } };
  await page.goto(`/tematy/${extra.topic.id}`);
  await page.getByRole('button', { name: 'Rozpocznij sesję' }).click();
  await page.getByRole('button', { name: 'Przerwij i wróć później' }).click();
  await expect(page.getByRole('heading', { name: 'Niedokończone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wróć do tematu' })).toHaveCount(1);
});
