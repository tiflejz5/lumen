# Pobiera przenosna wersje Node.js z nodejs.org do folderu runtime\ i weryfikuje jej sume SHA-256.
# Kod i komunikaty tylko ASCII (zgodnosc z Windows PowerShell 5 bez BOM).
param(
  [string]$Version = '26.8.1',
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Target) { $Target = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime' }
$file = "node-v$Version-win-x64.zip"
$base = "https://nodejs.org/dist/v$Version"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("lumen-node-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host "  Pobieranie $file ..."
  Invoke-WebRequest -Uri "$base/$file" -OutFile (Join-Path $tmp $file) -UseBasicParsing
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1) -replace '\s+.*$', ''
  if (-not $expected) { throw "Brak sumy kontrolnej dla $file na nodejs.org." }
  $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $file)).Hash.ToLower()
  if ($actual -ne $expected.Trim().ToLower()) { throw "Suma SHA-256 sie nie zgadza (oczekiwano $expected, jest $actual). Przerywam." }
  Write-Host "  Suma kontrolna SHA-256 poprawna."
  Expand-Archive -Path (Join-Path $tmp $file) -DestinationPath $tmp -Force
  $src = Join-Path $tmp "node-v$Version-win-x64"
  if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
  New-Item -ItemType Directory -Path $Target | Out-Null
  Copy-Item -Path (Join-Path $src 'node.exe') -Destination $Target
  Copy-Item -Path (Join-Path $src 'LICENSE') -Destination $Target -ErrorAction SilentlyContinue
  Write-Host "  Zainstalowano Node.js $Version w: $Target"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
