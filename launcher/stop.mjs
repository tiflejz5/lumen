// Zatrzymuje działający serwer Lumen (zapisuje i blokuje bazę, usuwa plik blokady).
import { promises as fs } from 'node:fs';
import { resolvePaths } from '../apps/server/src/config.ts';

const paths = resolvePaths();
let lock;
try {
  lock = JSON.parse(await fs.readFile(paths.lockFile, 'utf8'));
} catch {
  console.log('Lumen nie jest uruchomiony.');
  process.exit(0);
}

try {
  const res = await fetch(`http://127.0.0.1:${lock.port}/api/internal/shutdown`, {
    method: 'POST',
    headers: { 'x-lumen-shutdown-token': lock.token },
    signal: AbortSignal.timeout(3000),
  });
  console.log(
    res.ok ? 'Lumen został zatrzymany.' : `Serwer odmówił zatrzymania (HTTP ${res.status}).`,
  );
  process.exit(res.ok ? 0 : 1);
} catch {
  // Serwer nie odpowiada – plik blokady jest nieaktualny (np. po awarii zasilania).
  await fs.rm(paths.lockFile, { force: true });
  console.log('Serwer nie odpowiadał. Usunięto nieaktualny plik blokady.');
}
