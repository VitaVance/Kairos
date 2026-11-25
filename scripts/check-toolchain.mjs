#!/usr/bin/env node
/**
 * Desktop build preflight.
 *
 * Checks that everything needed to produce the Windows MSI/NSIS installers is
 * on this machine. Prints a ✓/✗ checklist, with the exact fix command for every
 * ✗, then exits 0 (ready) or 1 (not ready).
 *
 * No dependencies — plain Node, works before `pnpm install`.
 *
 * Usage:
 *   node scripts/check-toolchain.mjs
 *   pnpm desktop:preflight
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const MIN_NODE_MAJOR = 22;
const REQUIRED_RUST_TARGET = 'x86_64-pc-windows-msvc';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

const OK = c.green('✓');
const BAD = c.red('✗');
const WARN = c.yellow('!');

/** Run a command, returning {ok, stdout, stderr}. Never throws. */
function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    ...opts,
  });
  if (res.error) {
    return { ok: false, stdout: '', stderr: res.error.message };
  }
  return {
    ok: res.status === 0,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

/** Windows: commands like pnpm/cargo are .cmd/.exe shims, so go through cmd.exe. */
function runWin(cmd, args = []) {
  if (IS_WINDOWS) {
    // Use cmd /c so packaged shims (pnpm.cmd, rustc.exe, etc.) resolve.
    return run(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
      // A toolchain installed while this shell was already open is not on PATH
      // yet. Prepend the default rustup location so the check reflects reality
      // instead of reporting a false "not installed".
      env: withRustupOnPath(process.env),
    });
  }
  return run(cmd, args, { env: withRustupOnPath(process.env) });
}

/**
 * Returns env with `~/.cargo/bin` prepended when it exists and is not already
 * on PATH. Idempotent and safe on machines without rustup.
 */
function withRustupOnPath(env) {
  const home = env.USERPROFILE || env.HOME;
  if (!home) return env;
  const cargoBin = resolve(home, '.cargo', 'bin');
  if (!existsSync(cargoBin)) return env;
  const key = IS_WINDOWS ? 'Path' : 'PATH';
  const current = env[key] || env.PATH || '';
  const sep = IS_WINDOWS ? ';' : ':';
  if (current.split(sep).some((p) => p.toLowerCase() === cargoBin.toLowerCase())) return env;
  return { ...env, [key]: `${cargoBin}${sep}${current}`, PATH: `${cargoBin}${sep}${current}` };
}

const results = [];

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {string} detail
 * @param {{fix?: string, required?: boolean, hint?: string}} [opts]
 */
function check(label, ok, detail, opts = {}) {
  const { fix, required = true, hint } = opts;
  results.push({ label, ok, required });
  const mark = ok ? OK : required ? BAD : WARN;
  console.log(`  ${mark} ${label}${detail ? c.dim(` — ${detail}`) : ''}`);
  if (!ok && hint) console.log(`      ${c.dim(hint)}`);
  if (!ok && fix) console.log(`      ${c.bold('fix:')} ${c.yellow(fix)}`);
}

/** Extract the first `x.y.z` from a version-ish string. */
function firstVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], text: m[0] } : null;
}

console.log(c.bold('\nTauri desktop build — preflight check'));
console.log(c.dim(`repo: ${REPO_ROOT}`));
console.log(c.dim(`platform: ${process.platform} ${process.arch}, node ${process.version}\n`));

// ── Node ────────────────────────────────────────────────────────────────────
{
  const v = firstVersion(process.version);
  const ok = !!v && (v.major > MIN_NODE_MAJOR || (v.major === MIN_NODE_MAJOR && v.minor >= 0));
  check(
    `Node.js ≥ ${MIN_NODE_MAJOR}`,
    ok,
    process.version,
    {
      fix: 'winget install OpenJS.NodeJS.LTS   (then open a new terminal)',
      hint: 'Use https://nodejs.org or a version manager (fnm/nvm-windows).',
    },
  );
}

// ── pnpm ────────────────────────────────────────────────────────────────────
{
  const r = runWin('pnpm', ['--version']);
  const v = r.ok ? firstVersion(r.stdout) : null;
  check('pnpm present', r.ok, r.ok ? r.stdout.split('\n')[0] : 'not found on PATH', {
    fix: 'corepack enable && corepack prepare pnpm@11.21.0 --activate',
    hint: 'This repo pins packageManager pnpm@11.21.0 (see package.json).',
  });
  if (v) {
    const expected = '11.21.0';
    const [emaj, emin, epat] = expected.split('.').map(Number);
    const older = v.major < emaj || (v.major === emaj && (v.minor < emin || (v.minor === emin && v.patch < epat)));
    if (older) {
      console.log(
        `      ${WARN} pnpm ${v.text} detected; repo expects ${expected}. Run: corepack prepare pnpm@${expected} --activate`,
      );
    }
  }
}

// ── cargo / rustc / rustup ──────────────────────────────────────────────────
let cargoOk = false;
{
  const r = runWin('cargo', ['--version']);
  const v = r.ok ? firstVersion(r.stdout) : null;
  cargoOk = r.ok;
  check('cargo (Rust toolchain)', r.ok, r.ok ? r.stdout.split('\n')[0] : 'not found on PATH', {
    fix: 'winget install Rustlang.Rustup',
    hint: 'After Rustup installs, run: rustup default stable-msvc',
  });
  if (v && (v.major < 1 || (v.major === 1 && v.minor < 77))) {
    console.log(
      `      ${WARN} Rust ${v.text} is older than Cargo.toml rust-version 1.77 — run \`rustup update stable\`.`,
    );
  }
}

{
  const r = runWin('rustc', ['--version']);
  check('rustc compiler', r.ok, r.ok ? r.stdout.split('\n')[0] : 'not found on PATH', {
    fix: 'winget install Rustlang.Rustup',
  });
}

let rustupOk = false;
{
  const r = runWin('rustup', ['--version']);
  rustupOk = r.ok;
  if (IS_WINDOWS) {
    check('rustup', r.ok, r.ok ? r.stdout.split('\n')[0] : 'not found on PATH', {
      fix: 'winget install Rustlang.Rustup',
      required: false,
      hint: 'rustup is optional if Rust was installed some other way, but the MSVC target check below needs it.',
    });

    if (rustupOk) {
      const t = runWin('rustup', ['target', 'list', '--installed']);
      const installed = t.ok ? t.stdout.split(/\r?\n/).map((s) => s.trim()) : [];
      const hasMsvc = installed.includes(REQUIRED_RUST_TARGET);
      check(
        `MSVC target ${REQUIRED_RUST_TARGET}`,
        hasMsvc,
        hasMsvc ? 'installed' : t.ok ? 'not installed' : `could not query (${t.stderr || 'error'})`,
        {
          fix: 'rustup default stable-msvc',
          hint: 'A GNU toolchain (stable-x86_64-pc-windows-gnu) will not link the MSI/NSIS build correctly.',
        },
      );

      const show = runWin('rustup', ['show', 'active-toolchain']);
      if (show.ok && /gnu/i.test(show.stdout)) {
        console.log(
          `      ${WARN} Active toolchain is GNU (${show.stdout.split('\n')[0]}). Switch to MSVC: rustup default stable-msvc`,
        );
      }
    }
  }
}

// ── MSVC build tools (Windows only) ─────────────────────────────────────────
let msvcOk = false;
if (IS_WINDOWS) {
  msvcOk = detectMsvcBuildTools();
  check(
    'MSVC Build Tools (link.exe)',
    msvcOk,
    msvcOk ? 'Visual Studio 2022 C++ workload detected' : 'not detected',
    {
      fix:
        'winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
      hint: 'The Rust MSVC target needs the C++ linker (link.exe). Close and reopen terminals after install.',
    },
  );
} else {
  console.log(`  ${WARN} Not running on Windows — MSVC check skipped (targeting Windows from another OS is unsupported here).`);
}

// ── WebView2 (Windows only, informational) ──────────────────────────────────
if (IS_WINDOWS) {
  console.log(
    `  ${OK} WebView2 runtime — ships with Windows 11; the NSIS installer also bundles a bootstrapper as a fallback.`,
  );
}

// ── local project state (informational) ────────────────────────────────────
{
  const lock = existsSync(resolve(REPO_ROOT, 'pnpm-lock.yaml'));
  const modules = existsSync(resolve(REPO_ROOT, 'node_modules'));
  console.log(
    `  ${lock && modules ? OK : WARN} dependencies — ${lock ? 'pnpm-lock.yaml present' : 'pnpm-lock.yaml MISSING'}${modules ? ', node_modules present' : ', node_modules missing (run pnpm install)'}`,
  );
}

// ── expected artifacts ──────────────────────────────────────────────────────
console.log(c.bold('\nArtifacts will be written to:'));
const releaseDir = resolve(REPO_ROOT, 'apps/desktop/src-tauri/target/release');
const sep = IS_WINDOWS ? '\\' : '/';
console.log(`  MSI : ${[releaseDir, 'bundle', 'msi'].join(sep)}${sep}*.msi`);
console.log(`  NSIS: ${[releaseDir, 'bundle', 'nsis'].join(sep)}${sep}*-setup.exe`);
console.log(c.dim(`  exe : ${[releaseDir, 'todolist.exe'].join(sep)}  (portable, no installer)`));

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok && r.required);
console.log('');
if (failed.length === 0) {
  console.log(c.green(c.bold('✓ All prerequisites satisfied — you can run `pnpm desktop:build`.')));
  if (!cargoOk) {
    // Defensive: should be unreachable because cargo is a required check.
    console.log(c.red('But cargo was missing — treat this as NOT ready.'));
    process.exit(1);
  }
  console.log(c.dim('  Tip: `pnpm desktop:build` → both .msi and NSIS -setup.exe. Single-target: desktop:build:msi / desktop:build:nsis.'));
  process.exit(0);
} else {
  console.log(c.red(c.bold(`✗ Not ready for a desktop build — ${failed.length} blocking issue(s):`)));
  for (const f of failed) console.log(`    - ${f.label}`);
  console.log('');
  console.log(c.bold('Install steps (run in PowerShell on Windows):'));
  console.log('  1. Rust toolchain:');
  console.log(c.yellow('       winget install Rustlang.Rustup'));
  console.log(c.yellow('       rustup default stable-msvc'));
  console.log('  2. MSVC Build Tools (C++ workload, provides link.exe):');
  console.log(
    c.yellow(
      '       winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    ),
  );
  console.log('  3. WebView2: already present on Windows 11; the NSIS installer bundles a bootstrapper.');
  console.log(c.dim('  After installing, open a NEW terminal so PATH updates take effect, then re-run this script.'));
  console.log('');
  process.exit(1);
}

// ── helpers ─────────────────────────────────────────────────────────────────
/**
 * Detect the MSVC linker. Preferred: vswhere (authoritative). Fallback when
 * vswhere is absent (very rare): search link.exe on PATH, rejecting false
 * positives such as Git-for-Windows' coreutils `usr/bin/link.exe`.
 */
function detectMsvcBuildTools() {
  const vswhere = resolve(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (existsSync(vswhere)) {
    const r = run(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ]);
    if (r.ok && r.stdout.trim()) return true;
    if (r.ok) return false; // vswhere ran but found no C++ workload — authoritative.
  }
  // No vswhere (rare — it ships with every VS 2017+ installer): fall back to
  // link.exe on PATH. Reject false positives such as Git-for-Windows'
  // `usr/bin/link.exe`, which is a coreutils helper, not the MSVC linker.
  const w = run('where', ['link.exe']);
  if (w.ok) {
    const hits = w.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return hits.some(
      (p) => /[\\/]VC[\\/]Tools[\\/]MSVC[\\/]/i.test(p) || /[\\/]Microsoft Visual Studio[\\/]/i.test(p),
    );
  }
  return false;
}
