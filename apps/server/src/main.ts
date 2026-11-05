import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { APP_NAME, APP_VERSION, PREFERRED_PORT, resolvePaths } from './config.ts';
import { buildApp } from './http/app.ts';
import { AppSession } from './session/app-session.ts';

const HOST = '127.0.0.1';
const TICK_MS = 5_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function findPort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 30; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`Nie znaleziono wolnego portu w zakresie ${preferred}–${preferred + 29}.`);
}

async function healthyInstance(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = (await res.json()) as { app?: string };
    return body.app === 'lumen';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const paths = resolvePaths();
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.logsDir, { recursive: true });

  // Jedna instancja na raz.
  try {
    const existing = JSON.parse(await fs.readFile(paths.lockFile, 'utf8')) as { port: number };
    if (await healthyInstance(existing.port)) {
      console.log(`${APP_NAME} już działa: http://${HOST}:${existing.port}`);
      return;
    }
  } catch {
    // brak lub nieczytelny plik blokady – kontynuujemy
  }

  const logFile = join(paths.logsDir, 'server.log');
  try {
    if ((await fs.stat(logFile)).size > MAX_LOG_BYTES) await fs.rename(logFile, `${logFile}.1`);
  } catch {
    // brak logu – OK
  }

  const port = await findPort(Number(process.env.LUMEN_PORT) || PREFERRED_PORT);
  const session = new AppSession({ paths });
  const shutdownToken = randomBytes(24).toString('base64url');
  let lastRequest = Date.now();
  const idleExitMs = (Number(process.env.LUMEN_IDLE_EXIT_MINUTES) || 30) * 60_000;

  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const app = await buildApp({
    session,
    paths,
    allowedHosts: [`${HOST}:${port}`, `localhost:${port}`, `[::1]:${port}`],
    webRoot,
    shutdownToken,
    logger: { level: 'info', file: logFile },
    onActivity: () => {
      lastRequest = Date.now();
    },
    onShutdown: () => void shutdown('żądanie zatrzymania'),
  });

  let closing = false;
  async function shutdown(reason: string): Promise<void> {
    if (closing) return;
    closing = true;
    app.log.info(`zatrzymywanie: ${reason}`);
    clearInterval(timer);
    session.lock();
    await app.close().catch(() => {});
    await fs.rm(paths.lockFile, { force: true });
    process.exit(0);
  }

  const timer = setInterval(() => {
    if (session.tick()) app.log.info('automatyczna blokada po bezczynności');
    if (Date.now() - lastRequest > idleExitMs) void shutdown('brak aktywności');
  }, TICK_MS);

  await app.listen({ port, host: HOST });
  await fs.writeFile(
    paths.lockFile,
    JSON.stringify({
      pid: process.pid,
      port,
      token: shutdownToken,
      startedAt: new Date().toISOString(),
      version: APP_VERSION,
    }),
    { mode: 0o600 },
  );

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
  process.on('uncaughtException', (error) => {
    app.log.error({ err: { name: error.name, message: error.message } }, 'uncaughtException');
    void shutdown('błąd krytyczny').finally(() => process.exit(1));
  });

  console.log(`\n  ${APP_NAME} ${APP_VERSION} działa: http://${HOST}:${port}`);
  console.log('  To okno jest serwerem lokalnym – nie zamykaj go podczas nauki.');
  console.log('  Aby zakończyć, użyj „Zakończ” w ustawieniach albo zamknij to okno.\n');
}

main().catch((error: unknown) => {
  console.error(`\n  Nie udało się uruchomić aplikacji: ${(error as Error).message}\n`);
  process.exit(1);
});
