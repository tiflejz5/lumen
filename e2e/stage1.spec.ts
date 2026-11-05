import { expect, test as base, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'zielony koń skacze przez płot';
const NEW_PASSWORD = 'zupełnie nowe hasło po odzyskaniu';

// Scenariusz sekwencyjny: jedna baza i jedna karta przeglądarki (z ciasteczkiem sesji) przez cały czas.
let page: Page;
let recoveryKey = '';
const externalRequests: string[] = [];
const consoleProblems: string[] = [];

const test = base.extend({});
test.describe.configure({ mode: 'serial' });

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

async function unlock(page: Page, password: string) {
  await page.getByLabel('Hasło', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Odblokuj', exact: true }).click();
}

test('pierwsza konfiguracja: hasło, klucz odzyskiwania, potwierdzenie', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Zabezpiecz swoją bazę wiedzy' })).toBeVisible();

  // zbyt krótkie hasło blokuje przejście dalej
  await page.getByLabel('Hasło', { exact: true }).fill('krótkie');
  await expect(page.getByText('Co najmniej 10 znaków.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dalej' })).toBeDisabled();

  // niezgodne powtórzenie
  await page.getByLabel('Hasło', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Powtórz hasło').fill('inne hasło zupełnie');
  await expect(page.getByText('Hasła nie są takie same.')).toBeVisible();
  await page.getByLabel('Powtórz hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Dalej' }).click();

  // klucz: 14 grup, bez zapisu nie da się iść dalej
  await expect(page.getByRole('heading', { name: 'Twój klucz odzyskiwania' })).toBeVisible();
  const groups = await page
    .getByRole('list', { name: /Klucz odzyskiwania/ })
    .locator('li')
    .allInnerTexts();
  const parsed = groups.map((g) => g.split('\n').pop()!.trim());
  expect(parsed).toHaveLength(14);
  recoveryKey = parsed.join('-');
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  await expect(page.getByRole('button', { name: 'Dalej' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Dalej' }).click();

  // potwierdzenie: najpierw błędne fragmenty
  await expect(
    page.getByRole('heading', { name: 'Potwierdź, że klucz jest zapisany' }),
  ).toBeVisible();
  const labels = await page.locator('label', { hasText: /^Grupa nr/ }).allInnerTexts();
  const numbers = labels.map((l) => Number(l.replace(/\D/g, '')));
  expect(numbers).toHaveLength(3);
  const inputs = page.getByLabel(/Grupa nr/);
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill('AAAA');
  await page.getByRole('button', { name: 'Utwórz zaszyfrowaną bazę' }).click();
  await expect(page.getByText(/nie zgadzają się/)).toBeVisible();

  // potem poprawne
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(parsed[numbers[i]! - 1]!.toLowerCase());
  await page.getByRole('button', { name: 'Utwórz zaszyfrowaną bazę' }).click();
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();
});

test('ustawienia: kopia zapasowa tworzy się i przechodzi weryfikację', async () => {
  await page.goto('/ustawienia');
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await expect(page.getByText('Nie ma jeszcze żadnej kopii.')).toBeVisible();
  await page.getByRole('button', { name: 'Utwórz kopię teraz' }).click();
  await expect(page.getByText('Ręczna')).toBeVisible();
  await page.getByRole('button', { name: 'Sprawdź' }).click();
  await expect(page.getByText('Kopia jest poprawna')).toBeVisible();

  await page.getByLabel('Automatyczna blokada po bezczynności').selectOption('30');
  await page.reload();
  await expect(page.getByLabel('Automatyczna blokada po bezczynności')).toHaveValue('30');
});

test('blokada, złe hasło i ponowne odblokowanie', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Zablokuj' }).first().click();
  await expect(page.getByRole('heading', { name: 'Odblokuj bazę' })).toBeVisible();

  await unlock(page, 'to jest złe hasło');
  await expect(page.getByText('Nieprawidłowe hasło.')).toBeVisible();

  await unlock(page, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();
});

test('odzyskiwanie kluczem ustawia nowe hasło', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Zablokuj' }).first().click();
  await page.getByRole('button', { name: 'Nie pamiętam hasła' }).click();
  await expect(page.getByRole('heading', { name: 'Odzyskiwanie dostępu' })).toBeVisible();

  await page.getByLabel('Klucz odzyskiwania').fill(recoveryKey.toLowerCase().replaceAll('-', ' '));
  await page.getByLabel('Nowe hasło', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Powtórz nowe hasło').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Odblokuj i ustaw hasło' }).click();
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();

  // nowe hasło działa po blokadzie, stare już nie
  await page.getByRole('button', { name: 'Zablokuj' }).first().click();
  await unlock(page, PASSWORD);
  await expect(page.getByText('Nieprawidłowe hasło.')).toBeVisible();
  await unlock(page, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dziś' })).toBeVisible();
});

test('widok mobilny: dolna nawigacja zamiast paska bocznego, bez poziomego przewijania', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Nawigacja mobilna' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toBeHidden();
  for (const path of ['/', '/ustawienia', '/wiecej']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `przepełnienie poziome na ${path}`).toBeLessThanOrEqual(0);
  }
  await page.getByRole('link', { name: 'Więcej' }).click();
  await expect(page.getByRole('link', { name: 'Baza tematów' })).toBeVisible();
});

test('prywatność: żadnych zapytań poza własnym serwerem i brak błędów w konsoli', async () => {
  expect(externalRequests, 'zapytania na zewnątrz').toEqual([]);
  expect(consoleProblems, 'błędy lub ostrzeżenia w konsoli (np. naruszenia CSP)').toEqual([]);
});
