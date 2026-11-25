#Requires -Version 5.1
<#
.SYNOPSIS
  Sign a built Tauri artifact (.exe / .msi / NSIS -setup.exe) with a local
  code-signing certificate, then prove the signature with `signtool verify /pa`.

.DESCRIPTION
  100% local: the certificate lives in Cert:\CurrentUser\My and no cloud signing
  service is used. Nothing is written into the repository.

  The certificate can be:
    * generated on the fly with -Generate (New-SelfSignedCertificate), or
    * selected by -Thumbprint, or
    * auto-selected when exactly one code-signing cert with a private key exists
      in Cert:\CurrentUser\My.

  Signing uses SHA-256 and an RFC3161 timestamp. If the timestamp server is
  unreachable (offline machine), the script retries without a timestamp so the
  local flow still works. Pass -TimestampUrl '' to skip timestamping entirely.

  The script refuses to run if signtool.exe cannot be found, and tells you where
  it normally lives (Windows SDK bin).

.PARAMETER File
  Path to the file to sign. Example:
  apps\desktop\src-tauri\target\release\todolist.exe

.PARAMETER Thumbprint
  Thumbprint (40 hex chars) of an existing code-signing certificate in
  Cert:\CurrentUser\My. If omitted, -Generate creates one, otherwise the single
  available code-signing cert is used.

.PARAMETER Generate
  Create a new self-signed code-signing certificate in Cert:\CurrentUser\My
  when no -Thumbprint is supplied. The thumbprint is printed in copy-pasteable
  form when done.

.PARAMETER TimestampUrl
  RFC3161 timestamp server. Default: http://timestamp.digicert.com
  Pass -TimestampUrl '' to sign without a timestamp (fully offline).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\sign-desktop.ps1 -Generate -File apps\desktop\src-tauri\target\release\todolist.exe

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\sign-desktop.ps1 -Thumbprint ABCDEF0123456789ABCDEF0123456789ABCDEF01 -File apps\desktop\src-tauri\target\release\bundle\msi\*.msi
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$File,

    [string]$Thumbprint = '',

    [switch]$Generate,

    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

function Fail {
    param([string]$Message)
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Locate signtool.exe. It is not on PATH by default on Windows; it ships with
# the Windows SDK under Windows Kits\10\bin\<version>\x64.
# ---------------------------------------------------------------------------
function Find-SignTool {
    $cmd = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'),
        (Join-Path $env:ProgramFiles 'Windows Kits\10\bin')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $found = @()
    foreach ($root in $roots) {
        $dirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        foreach ($d in $dirs) {
            $candidate = Join-Path $d.FullName 'x64\signtool.exe'
            if (Test-Path -LiteralPath $candidate) { $found += $candidate }
        }
    }
    if ($found.Count -gt 0) { return $found[0] }
    return $null
}

$SignTool = Find-SignTool
if (-not $SignTool) {
    Write-Host ''
    Write-Host 'ERROR: signtool.exe was not found on PATH or in the Windows SDK.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'signtool.exe ships with the Windows SDK. Install it with (admin PowerShell):'
    Write-Host '    winget install Microsoft.WindowsSDK'
    Write-Host 'or via the Visual Studio Installer:'
    Write-Host '    Modify -> Individual components -> "Windows 11 SDK" (or "Windows 10 SDK")'
    Write-Host ''
    Write-Host 'It is normally located at:'
    Write-Host '    C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe'
    Write-Host ''
    Write-Host 'After installing, either re-run this script (it searches the SDK automatically)'
    Write-Host 'or add that x64 folder to PATH and open a new terminal.'
    exit 2
}

Write-Host "==> signtool: $SignTool"

# ---------------------------------------------------------------------------
# Resolve the target file (supports wildcards such as bundle\msi\*.msi).
# ---------------------------------------------------------------------------
$targets = @(Get-Item -Path $File -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer })
if ($targets.Count -eq 0) {
    Fail "No file matched: $File  (build the app first, or pass an existing .exe/.msi/-setup.exe)"
}
if ($targets.Count -gt 1) {
    Fail "Multiple files matched '$File'. Pass a single, explicit path."
}
$target = $targets[0]
$targetPath = $target.FullName
Write-Host "==> signing: $targetPath"

# ---------------------------------------------------------------------------
# Select or create the certificate.
# ---------------------------------------------------------------------------
$store = 'Cert:\CurrentUser\My'
$normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()

if ([string]::IsNullOrWhiteSpace($normalized) -and $Generate) {
    Write-Host '==> generating a new self-signed code-signing certificate (CurrentUser\My)'
    $newCert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject 'CN=todolist local code signing' `
        -KeyUsage DigitalSignature `
        -FriendlyName 'todolist local code signing' `
        -CertStoreLocation $store `
        -NotAfter (Get-Date).AddYears(3)
    $normalized = $newCert.Thumbprint.ToUpperInvariant()
}

if ([string]::IsNullOrWhiteSpace($normalized)) {
    $candidates = @(
        Get-ChildItem -Path $store -CodeSigningCert -ErrorAction SilentlyContinue |
            Where-Object { $_.HasPrivateKey }
    )
    if ($candidates.Count -eq 1) {
        $normalized = $candidates[0].Thumbprint.ToUpperInvariant()
        Write-Host "==> using the only code-signing certificate found: $normalized"
    }
    elseif ($candidates.Count -eq 0) {
        Fail 'No code-signing certificate with a private key in Cert:\CurrentUser\My. Re-run with -Generate to create one, or pass -Thumbprint <40-hex>.'
    }
    else {
        Write-Host 'Multiple code-signing certificates found; pass -Thumbprint to choose one:'
        foreach ($c in $candidates) {
            Write-Host ("    {0}  {1}" -f $c.Thumbprint, $c.Subject)
        }
        exit 1
    }
}

$cert = Get-Item -Path (Join-Path $store $normalized) -ErrorAction SilentlyContinue
if (-not $cert) {
    Fail "Certificate $normalized not found in $store. Run with -Generate to create one."
}
if (-not $cert.HasPrivateKey) {
    Fail "Certificate $normalized has no private key in $store (exported/imported without key?)."
}

$ekuOids = @($cert.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId.Value })
if ($ekuOids -and ($ekuOids -notcontains '1.3.6.1.5.5.7.3.3')) {
    Write-Host "WARNING: certificate EKU is $($ekuOids -join ',') (not Code Signing 1.3.6.1.5.5.7.3.3)." -ForegroundColor Yellow
}

Write-Host "==> certificate: $normalized"
Write-Host "    subject:     $($cert.Subject)"
Write-Host "    expires:     $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "    thumbprint:  $normalized"

# ---------------------------------------------------------------------------
# Sign. Try RFC3161 timestamp first; fall back to no timestamp when offline.
# ---------------------------------------------------------------------------
function Invoke-SignTool {
    param([string[]]$Arguments)
    # Pipe native output to the host so it does not become the function's return
    # value; only the exit code is returned.
    & $SignTool @Arguments | Out-Host
    return $LASTEXITCODE
}

$signWithTs = @(
    'sign', '/sha1', $normalized, '/fd', 'sha256', '/td', 'sha256',
    '/tr', $TimestampUrl, '/v', $targetPath
)
$signNoTs = @('sign', '/sha1', $normalized, '/fd', 'sha256', '/v', $targetPath)

Write-Host ''
if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
    Write-Host '==> signtool sign (no timestamp)'
    $code = Invoke-SignTool -Arguments $signNoTs
}
else {
    Write-Host "==> signtool sign (timestamp: $TimestampUrl)"
    $code = Invoke-SignTool -Arguments $signWithTs
    if ($code -ne 0) {
        Write-Host ''
        Write-Host 'Timestamp server unreachable/failed. Retrying without a timestamp (local-only signing).' -ForegroundColor Yellow
        $code = Invoke-SignTool -Arguments $signNoTs
    }
}
if ($code -ne 0) {
    Fail "signtool sign failed with exit code $code."
}

# ---------------------------------------------------------------------------
# Prove the signature.
#
# A self-signed root is not in the trusted root store by default, so
# `verify /pa` (which enforces Authenticode trust) fails even though the
# signature is valid. For a purely local, self-signed cert we add its PUBLIC
# key to Cert:\CurrentUser\Root (current user only, no admin) so the proof
# passes. This is reversible: see the printed removal command.
# ---------------------------------------------------------------------------
function Test-RootTrusted {
    param([string]$Thumb)
    $roots = @('Cert:\CurrentUser\Root', 'Cert:\LocalMachine\Root')
    foreach ($r in $roots) {
        if (Get-ChildItem -Path $r -ErrorAction SilentlyContinue |
                Where-Object { $_.Thumbprint -eq $Thumb }) { return $true }
    }
    return $false
}

if ($cert.Subject -eq $cert.Issuer -and -not (Test-RootTrusted $normalized)) {
    Write-Host ''
    Write-Host '==> self-signed cert: adding its public key to Cert:\CurrentUser\Root (current user only)'
    $cerPath = Join-Path $env:TEMP ("todolist-codesign-{0}.cer" -f $normalized)
    Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    Remove-Item -LiteralPath $cerPath -Force -ErrorAction SilentlyContinue
    Write-Host "    trusted root added (undo: Remove-Item 'Cert:\CurrentUser\Root\$normalized')"
}

Write-Host ''
Write-Host '==> signtool verify /pa'
& $SignTool verify /pa /v $targetPath
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'verify /pa failed.' -ForegroundColor Yellow
    Write-Host 'This is expected for a self-signed certificate whose root is not trusted:' -ForegroundColor Yellow
    Write-Host '    signtool verify /pa applies the Authenticode trust policy, which requires' -ForegroundColor Yellow
    Write-Host '    a chain to a trusted root. For purely internal use, import the public' -ForegroundColor Yellow
    Write-Host '    certificate into Cert:\CurrentUser\Root (see docs/PACKAGING.md section 6).' -ForegroundColor Yellow
    Write-Host 'The signature itself was applied; on this machine you can inspect it with:' -ForegroundColor Yellow
    Write-Host "    Get-AuthenticodeSignature '$targetPath'" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Print the thumbprint in copy-pasteable form for tauri.conf.json.
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '==> DONE. Certificate thumbprint (copy-pasteable):' -ForegroundColor Green
Write-Host $normalized -ForegroundColor Cyan
Write-Host ''
Write-Host 'Paste this fragment into the "bundle.windows" object of'
Write-Host 'apps/desktop/src-tauri/tauri.conf.json (do NOT commit it):'
Write-Host ''
Write-Host ('  "certificateThumbprint": "{0}",' -f $normalized)
Write-Host '  "digestAlgorithm": "sha256",'
Write-Host '  "timestampUrl": "http://timestamp.digicert.com"'
Write-Host ''
Write-Host "Certificate store location: $store\$normalized"
Write-Host 'To remove the certificate later:'
Write-Host "    Remove-Item -Path '$store\$normalized'"
exit 0
