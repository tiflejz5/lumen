import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Każdy zestaw testów dostaje własny serwer na osobnym porcie i z osobnym, tymczasowym katalogiem
// danych – testy nigdy nie dotykają prawdziwej bazy użytkownika i nie zależą od kolejności.
const stages = [
  { name: 'etap1', match: /stage1\.spec\.ts/, port: 47901 },
  { name: 'etap2', match: /stage2\.spec\.ts/, port: 47902 },
  { name: 'etap3', match: /stage3\.spec\.ts/, port: 47903 },
  { name: 'etap4', match: /stage4\.spec\.ts/, port: 47904 },
  { name: 'etap5', match: /stage5\.spec\.ts/, port: 47905 },
];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: { locale: 'pl-PL', trace: 'retain-on-failure' },
  projects: stages.map((s) => ({
    name: s.name,
    testMatch: s.match,
    use: { ...devices['Desktop Firefox'], baseURL: `http://127.0.0.1:${s.port}` },
  })),
  webServer: stages.map((s) => ({
    command: 'node launcher/start.mjs',
    url: `http://127.0.0.1:${s.port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      LUMEN_DATA_DIR: mkdtempSync(join(tmpdir(), `lumen-e2e-${s.name}-`)),
      LUMEN_PORT: String(s.port),
      LUMEN_NO_BROWSER: '1',
    },
  })),
});
