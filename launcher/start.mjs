// Uruchamia Lumen: jeśli serwer już działa, tylko otwiera przeglądarkę; w przeciwnym razie
// startuje serwer w tym procesie i otwiera przeglądarkę, gdy będzie gotowy.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fs, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

// Interfejs buduje się sam, gdy brakuje go albo kod źródłowy jest nowszy (np. po pobraniu aktualizacji).
const distIndex = new URL('../apps/web/dist/index.html', import.meta.url);

function newestSourceTime() {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  for (const d of ['apps/web/src', 'packages/core/src', 'apps/web/public'])
    if (existsSync(join(root, d))) walk(join(root, d));
  for (const f of ['apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/package.json'])
    if (existsSync(join(root, f))) newest = Math.max(newest, statSync(join(root, f)).mtimeMs);
  return newest;
}

const hasDist = existsSync(distIndex);
const stale = !hasDist || statSync(distIndex).mtimeMs < newestSourceTime();
if (stale && existsSync(join(root, 'node_modules', '.bin'))) {
  console.log('\n  Aktualizuję interfejs (jednorazowo, kilka sekund)…\n');
  const build = spawnSync('npm.cmd', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (build.status !== 0 && !hasDist)
    fail('Nie udało się zbudować interfejsu. Uruchom w folderze projektu: npm install');
  if (build.status !== 0)
    console.error('\n  Nie udało się odświeżyć interfejsu – uruchamiam poprzednią wersję.\n');
} else if (!hasDist) {
  fail('Brakuje zbudowanego interfejsu. Uruchom w folderze projektu: npm install');
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
