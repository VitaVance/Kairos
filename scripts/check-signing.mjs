#!/usr/bin/env node
/**
 * Code-signing preflight (read-only).
 *
 * Reports, without changing anything:
 *   - whether a code-signing certificate with a private key exists in
 *     Cert:\CurrentUser\My (and its thumbprint / subject / expiry),
 *   - whether signtool.exe is reachable (PATH or the Windows SDK bin),
 *   - what apps/desktop/src-tauri/tauri.conf.json currently declares under
 *     bundle.windows (certificateThumbprint / digestAlgorithm / timestampUrl /
 *     signCommand).
 *
 * This is informational only and ALWAYS exits 0, so it can be wired into any
 * script without becoming a gate. Signing itself is opt-in — see
 * docs/PACKAGING.md section 6 and scripts/sign-desktop.ps1.
 *
 * Style mirrors scripts/check-toolchain.mjs (✓ / ✗ / ! checklist, no deps).
 *
 * Usage:
 *   node scripts/check-signing.mjs
 *   pnpm desktop:signing-check
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const TAURI_CONF = resolve(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json');

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const OK = c.green('✓');
const BAD = c.red('✗');
const WARN = c.yellow('!');
const INFO = c.cyan('i');

/** Run a PowerShell command, returning {ok, stdout, stderr}. Never throws. */
function runPowerShell(script) {
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  );
  if (res.error) return { ok: false, stdout: '', stderr: res.error.message };
  return {
    ok: res.status === 0,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

console.log(c.bold('\nWindows code signing — preflight check (read-only)'));
console.log(c.dim(`repo: ${REPO_ROOT}`));
console.log(c.dim(`platform: ${process.platform} ${process.arch}\n`));

// ── 1. Signing certificate ──────────────────────────────────────────────────
let certThumbprint = null;
if (!IS_WINDOWS) {
  console.log(`  ${WARN} Not on Windows — certificate store check skipped.`);
} else {
  const ps = runPowerShell(
    [
      '$certs = @(Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert -ErrorAction SilentlyContinue |',
      '  Where-Object { $_.HasPrivateKey });',
      "$certs | ForEach-Object { '{0}|{1}|{2}' -f $_.Thumbprint, $_.Subject, $_.NotAfter.ToString('yyyy-MM-dd') }",
    ].join(' '),
  );

  const lines = ps.ok
    ? ps.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (lines.length === 0) {
    console.log(`  ${BAD} code-signing certificate in Cert:\\CurrentUser\\My — none with a private key`);
    console.log(
      `      ${c.dim('Create one with: powershell -ExecutionPolicy Bypass -File scripts\\sign-desktop.ps1 -Generate -File <exe>')}`,
    );
  } else {
    console.log(`  ${OK} code-signing certificate in Cert:\\CurrentUser\\My — ${lines.length} found`);
    for (const line of lines) {
      const [thumb, subject, notAfter] = line.split('|');
      certThumbprint = certThumbprint || thumb;
      const expired = notAfter && new Date(notAfter) < new Date();
      const mark = expired ? WARN : OK;
      console.log(
        `      ${mark} ${c.cyan(thumb)}  ${subject}  ${c.dim(`expires ${notAfter}${expired ? ' (EXPIRED)' : ''}`)}`,
      );
    }
  }
}

// ── 2. signtool.exe ─────────────────────────────────────────────────────────
if (!IS_WINDOWS) {
  console.log(`  ${WARN} Not on Windows — signtool check skipped.`);
} else {
  const onPath = spawnSync('where', ['signtool.exe'], { encoding: 'utf8', windowsHide: true });
  if (onPath.status === 0 && onPath.stdout.trim()) {
    console.log(`  ${OK} signtool.exe on PATH — ${onPath.stdout.split(/\r?\n/)[0].trim()}`);
  } else {
    const sdk = runPowerShell(
      [
        "$roots = @((Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\\10\\bin'),",
        "  (Join-Path $env:ProgramFiles 'Windows Kits\\10\\bin')) | Where-Object { $_ -and (Test-Path $_) };",
        '$hit = $null;',
        'foreach ($r in $roots) {',
        '  $d = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending |',
        "    Where-Object { Test-Path (Join-Path $_.FullName 'x64\\signtool.exe') } | Select-Object -First 1;",
        "  if ($d) { $hit = Join-Path $d.FullName 'x64\\signtool.exe'; break }",
        '}',
        'if ($hit) { $hit }',
      ].join(' '),
    );
    if (sdk.ok && sdk.stdout) {
      console.log(`  ${WARN} signtool.exe not on PATH — found in Windows SDK: ${sdk.stdout}`);
      console.log(`      ${c.dim('scripts/sign-desktop.ps1 locates it automatically.')}`);
    } else {
      console.log(`  ${BAD} signtool.exe — not on PATH and not found in the Windows SDK`);
      console.log(
        `      ${c.bold('fix:')} ${c.yellow('winget install Microsoft.WindowsSDK')}  ${c.dim('(or add the SDK x64 bin folder to PATH)')}`,
      );
      console.log(
        `      ${c.dim('normally: C:\\Program Files (x86)\\Windows Kits\\10\\bin\\<version>\\x64\\signtool.exe')}`,
      );
    }
  }
}

// ── 3. tauri.conf.json signing config ────────────────────────────────────────
let conf = null;
try {
  conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
} catch (err) {
  console.log(`  ${BAD} tauri.conf.json — could not read/parse: ${err.message}`);
}
if (conf) {
  const w = conf?.bundle?.windows ?? {};
  const keys = ['certificateThumbprint', 'digestAlgorithm', 'timestampUrl', 'signCommand'];
  const declared = keys.filter((k) => w[k] !== undefined && w[k] !== null);

  if (declared.length === 0) {
    console.log(
      `  ${INFO} tauri.conf.json bundle.windows — signing NOT configured ${c.dim('(unsigned-by-default)')}`,
    );
  } else {
    console.log(`  ${OK} tauri.conf.json bundle.windows — signing configured`);
    for (const k of declared) {
      const v = k === 'signCommand' ? JSON.stringify(w[k]) : String(w[k]);
      console.log(`      ${c.cyan(k)}: ${v}`);
    }
    if (w.certificateThumbprint && certThumbprint) {
      const match =
        String(w.certificateThumbprint).replace(/\s/g, '').toUpperCase() === certThumbprint.toUpperCase();
      console.log(
        match
          ? `      ${OK} certificateThumbprint matches a cert in CurrentUser\\My`
          : `      ${WARN} certificateThumbprint does NOT match any cert in CurrentUser\\My`,
      );
    }
    if (w.certificateThumbprint) {
      console.log(
        `      ${c.dim('Reminder: never commit a real thumbprint in a public repo — see docs/PACKAGING.md section 6.')}`,
      );
    }
  }
}

// ── summary (always informational, always exit 0) ───────────────────────────
console.log('');
console.log(
  c.dim(
    'Signing is opt-in. To enable it, merge "certificateThumbprint" into bundle.windows\n' +
      'locally (see apps/desktop/src-tauri/signing.example.jsonc and docs/PACKAGING.md §6).',
  ),
);
console.log(c.green(c.bold('✓ signing preflight complete (informational, exit 0)')));
process.exit(0);
