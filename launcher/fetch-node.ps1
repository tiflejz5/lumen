# Pobiera przenosna wersje Node.js z nodejs.org do folderu runtime\ i weryfikuje jej sume SHA-256.
# Kod i komunikaty tylko ASCII (zgodnosc z Windows PowerShell 5 bez BOM). Uzywa wylacznie .NET,
# bez cmdletow z modulow, ktore bywaja niedostepne przy odziedziczonym PSModulePath.
param(
  [string]$Version = '26.8.1',
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Target) { $Target = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime' }
$file = "node-v$Version-win-x64.zip"
$base = "https://nodejs.org/dist/v$Version"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("lumen-node-" + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($tmp) | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $client = New-Object System.Net.WebClient
  $zip = Join-Path $tmp $file
  Write-Host "  Pobieranie $file ..."
  $client.DownloadFile("$base/$file", $zip)
  $sums = $client.DownloadString("$base/SHASUMS256.txt")
  $line = $sums -split "`n" | Where-Object { $_.Contains($file) } | Select-Object -First 1
  if (-not $line) { throw "Brak sumy kontrolnej dla $file na nodejs.org." }
  $expected = ($line.Trim() -split '\s+')[0].ToLower()
  $stream = [System.IO.File]::OpenRead($zip)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $actual = ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLower()
  } finally { $stream.Dispose() }
  if ($actual -ne $expected) { throw "Suma SHA-256 sie nie zgadza (oczekiwano $expected, jest $actual). Przerywam." }
  Write-Host "  Suma kontrolna SHA-256 poprawna."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $extract = Join-Path $tmp 'x'
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
  $src = Join-Path $extract "node-v$Version-win-x64"
  if (Test-Path $Target) { [System.IO.Directory]::Delete($Target, $true) }
  [System.IO.Directory]::CreateDirectory($Target) | Out-Null
  [System.IO.File]::Copy((Join-Path $src 'node.exe'), (Join-Path $Target 'node.exe'))
  if (Test-Path (Join-Path $src 'LICENSE')) { [System.IO.File]::Copy((Join-Path $src 'LICENSE'), (Join-Path $Target 'LICENSE')) }
  Write-Host "  Zainstalowano Node.js $Version w: $Target"
}
finally {
  if (Test-Path $tmp) { [System.IO.Directory]::Delete($tmp, $true) }
}
