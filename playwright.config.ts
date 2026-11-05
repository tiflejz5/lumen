import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 47901;
// Osobny, tymczasowy katalog danych – testy nigdy nie dotykają prawdziwej bazy użytkownika.
const dataDir = process.env.LUMEN_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'lumen-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'pl-PL', trace: 'retain-on-failure' },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: {
    command: 'node launcher/start.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { LUMEN_DATA_DIR: dataDir, LUMEN_PORT: String(PORT), LUMEN_NO_BROWSER: '1' },
  },
});
