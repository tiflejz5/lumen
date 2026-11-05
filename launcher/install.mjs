// Instalator: sprawdza interfejs, tworzy folder danych i skrót „Lumen” na pulpicie.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../apps/server/src/config.ts';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const paths = resolvePaths();

console.log('\n  Instalacja Lumen\n');

if (!existsSync(join(root, 'apps', 'web', 'dist', 'index.html'))) {
  console.log('  Buduję interfejs (to potrwa chwilę)...');
  const build = spawnSync('npm.cmd', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (build.status !== 0) {
    console.error(
      '\n  Nie udało się zbudować interfejsu. Upewnij się, że uruchomiono „npm install” w folderze projektu.',
    );
    process.exit(1);
  }
}

mkdirSync(paths.dataDir, { recursive: true });
console.log(`  Folder danych: ${paths.dataDir}`);

// Ścieżki przekazujemy przez zmienne środowiskowe, żeby polskie znaki i spacje nie psuły składni.
const script = `
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Lumen.lnk'))
$lnk.TargetPath = Join-Path $env:LUMEN_ROOT 'launcher\\Start.cmd'
$lnk.WorkingDirectory = $env:LUMEN_ROOT
$lnk.IconLocation = (Join-Path $env:LUMEN_ROOT 'launcher\\lumen.ico') + ',0'
$lnk.WindowStyle = 7
$lnk.Description = 'Lumen - codzienny rozwoj wiedzy'
$lnk.Save()
Write-Output $lnk.FullName
`;
const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
  {
    env: { ...process.env, LUMEN_ROOT: root },
    encoding: 'utf8',
  },
);
if (result.status !== 0) {
  console.error('\n  Nie udało się utworzyć skrótu:', result.stderr || result.stdout);
  process.exit(1);
}
console.log(`  Skrót na pulpicie: ${result.stdout.trim()}`);
console.log('\n  Gotowe. Kliknij skrót „Lumen” na pulpicie, aby zacząć.');
console.log('  Przy pierwszym uruchomieniu ustawisz hasło i zapiszesz klucz odzyskiwania.\n');
