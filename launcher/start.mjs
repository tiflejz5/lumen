// Uruchamia Lumen: jeśli serwer już działa, tylko otwiera przeglądarkę; w przeciwnym razie
// startuje serwer w tym procesie i otwiera przeglądarkę, gdy będzie gotowy.
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../apps/server/src/config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = resolvePaths();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLock() {
  try {
    return JSON.parse(await fs.readFile(paths.lockFile, 'utf8'));
  } catch {
    return null;
  }
}

async function healthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return (await res.json()).app === 'lumen';
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.env.LUMEN_NO_BROWSER) return; // używane w testach
  // `start` otwiera domyślną przeglądarkę systemu (u Ciebie: Firefox).
  spawn('cmd', ['/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lock = await readLock();
    if (lock && (await healthy(lock.port))) return lock;
    await sleep(250);
  }
  return null;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const existing = await readLock();
if (existing && (await healthy(existing.port))) {
  console.log(`Lumen już działa – otwieram przeglądarkę (port ${existing.port}).`);
  openBrowser(`http://127.0.0.1:${existing.port}`);
  process.exit(0);
}

if (!existsSync(new URL('../apps/web/dist/index.html', import.meta.url))) {
  fail(
    'Brakuje zbudowanego interfejsu (apps/web/dist). Uruchom w folderze projektu: npm run build',
  );
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  fail(
    `Wymagany jest Node.js 24 lub nowszy (jest ${process.versions.node}). Uruchom ponownie Zainstaluj.cmd.`,
  );
}

process.chdir(root);
waitForServer(30_000).then((lock) => {
  if (lock) openBrowser(`http://127.0.0.1:${lock.port}`);
  else
    console.error(
      '\n  Serwer nie odpowiedział w ciągu 30 s. Sprawdź komunikaty powyżej oraz plik logs\\server.log w folderze danych.\n',
    );
});

await import('../apps/server/src/main.ts');
