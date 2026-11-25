#Requires -Version 5.1
<#
.SYNOPSIS
  Build the Tauri desktop installers (.msi + NSIS -setup.exe) and list artifacts.

.DESCRIPTION
  Runs the preflight toolchain check, installs deps with a frozen lockfile,
  builds with Tauri, then prints every produced installer with its size.
  Exits non-zero on any failure.

.PARAMETER Bundle
  Optional. "msi" or "nsis" to build only one target. Omit to build both
  (as configured in tauri.conf.json).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -Bundle nsis
#>
[CmdletBinding()]
param(
    [ValidateSet('msi', 'nsis', '')]
    [string]$Bundle = ''
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location (no hardcoded paths).
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$BundleDir = Join-Path $Root 'apps\desktop\src-tauri\target\release\bundle'

Write-Host "==> repo: $Root"

Write-Host "==> preflight (toolchain check)"
& node (Join-Path $Root 'scripts\check-toolchain.mjs')
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Error 'Preflight failed. Install the missing tools (see output above) and re-run.'
    exit 1
}

Write-Host ''
Write-Host '==> pnpm install --frozen-lockfile'
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# The updater signature.
#
# `bundle.createUpdaterArtifacts` is enabled, so every build must also emit a
# `.sig` over each installer. Without a private key Tauri writes the installers
# and then fails with "A public key has been found, but no private key", which
# reads like a broken build even though the artifacts are on disk.
#
# Prefer an explicit env var (CI), else use the default key location that
# `npx tauri signer generate -w $HOME\.tauri\todolist.key` writes to.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $defaultKey = Join-Path $HOME '.tauri\todolist.key'
    if (Test-Path $defaultKey) {
        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $defaultKey
        if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
            $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
        }
        Write-Host "==> updater signing key: $defaultKey"
    }
    else {
        Write-Host ''
        Write-Error @'
No updater signing key found.
Generate one once:  npx tauri signer generate -w $HOME\.tauri\todolist.key
Then put its PUBLIC key in tauri.conf.json -> plugins.updater.pubkey.
(Set TAURI_SIGNING_PRIVATE_KEY to use a different key.)
'@
        exit 1
    }
}

Write-Host ''
switch ($Bundle) {
    'msi'  { Write-Host '==> pnpm desktop:build:msi';  & pnpm desktop:build:msi }
    'nsis' { Write-Host '==> pnpm desktop:build:nsis'; & pnpm desktop:build:nsis }
    default { Write-Host '==> pnpm desktop:build (msi + nsis)'; & pnpm desktop:build }
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host '==> artifacts'
$artifacts = @()
foreach ($sub in @('msi', 'nsis')) {
    $dir = Join-Path $BundleDir $sub
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $patterns = if ($sub -eq 'msi') { @('*.msi') } else { @('*-setup.exe') }
    foreach ($pat in $patterns) {
        $items = Get-ChildItem -LiteralPath $dir -File -Filter $pat -ErrorAction SilentlyContinue
        if ($items) { $artifacts += $items }
    }
}

if (-not $artifacts) {
    Write-Error "No installers found under $BundleDir - the build may have failed."
    exit 1
}

foreach ($f in $artifacts) {
    $sizeMb = [math]::Round($f.Length / 1MB, 2)
    Write-Host ("  {0,8} MB  {1}" -f $sizeMb, $f.FullName)
}

$portable = Join-Path $Root 'apps\desktop\src-tauri\target\release\todolist.exe'
Write-Host ''
Write-Host "==> portable exe (no installer): $portable"
Write-Host 'DONE'
exit 0
