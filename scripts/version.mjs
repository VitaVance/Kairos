#!/usr/bin/env node
/**
 * One version, many manifests.
 *
 * The app version is declared once — in the root `package.json` — and every
 * other manifest derives from it. `tauri.conf.json` already points at that
 * file directly, so the shipped binary cannot disagree with it. The workspace
 * packages cannot do that (npm does not support a version reference), so they
 * are written by this script.
 *
 * Why not `pnpm version`: it bumps only the package it runs against, leaving
 * seven other manifests behind, which is exactly the drift this prevents.
 *
 * Usage:
 *   node scripts/version.mjs            # report drift, exit 1 if any
 *   node scripts/version.mjs --write    # rewrite the derived manifests
 *   node scripts/version.mjs --bump patch|minor|major   # bump + write
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The single source of truth. */
const SOURCE = resolve(ROOT, 'package.json');

/** Manifests that carry a copy and must follow the source. */
const DERIVED = [
  'apps/desktop/package.json',
  'apps/mobile/package.json',
  'packages/adapters/package.json',
  'packages/core/package.json',
  'packages/features/package.json',
  'packages/ui/package.json',
];

/**
 * Cargo gets its own treatment: it declares its version in TOML, not JSON, and
 * that value is what ends up in the Windows resource table (FileVersion /
 * ProductVersion) via `CARGO_PKG_VERSION`. Leaving it behind was how a build
 * shipped as 0.1.1 in the installer filename while the executable inside still
 * reported 0.1.0 — `tauri.conf.json`'s pointer to package.json only governs the
 * bundle, not the compiler's metadata.
 */
const CARGO_MANIFEST = 'apps/desktop/src-tauri/Cargo.toml';

const args = process.argv.slice(2);
const wantWrite = args.includes('--write');
const bumpIndex = args.indexOf('--bump');
const bumpKind = bumpIndex >= 0 ? args[bumpIndex + 1] : null;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function readVersion(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')).version;
}

/** Cargo.toml's `[package]` version — the only `version =` at column zero. */
function readCargoVersion() {
  const raw = readFileSync(resolve(ROOT, CARGO_MANIFEST), 'utf8');
  const m = /^version = "([^"]+)"/m.exec(raw);
  if (!m) throw new Error(`no package version in ${CARGO_MANIFEST}`);
  return m[1];
}

function writeCargoVersion(version) {
  const abs = resolve(ROOT, CARGO_MANIFEST);
  const raw = readFileSync(abs, 'utf8');
  // Anchored at column zero so a dependency's inline `version = "2"` is never
  // touched — those are always nested under a table and indented or prefixed.
  const next = raw.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  if (next === raw) throw new Error(`no package version rewritten in ${CARGO_MANIFEST}`);
  writeFileSync(abs, next);
}

/** Rewrite only the version string, preserving the file's existing layout. */
function writeVersion(path, version) {
  const abs = resolve(ROOT, path);
  const raw = readFileSync(abs, 'utf8');
  // Anchored to the first top-level "version" key, which is the manifest's
  // own — nested dependency versions are indented inside "dependencies".
  const next = raw.replace(/^(\s*)"version":\s*"[^"]*"/m, `$1"version": "${version}"`);
  if (next === raw) throw new Error(`no version field rewritten in ${path}`);
  writeFileSync(abs, next);
}

function bump(version, kind) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`source version is not semver: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`--bump expects patch | minor | major, got "${kind ?? ''}"`);
  }
}

let source = readVersion('package.json');

if (bumpKind) {
  if (!SEMVER.test(source)) throw new Error(`source version is not semver: ${source}`);
  const next = bump(source, bumpKind);
  writeVersion('package.json', next);
  console.log(`bumped ${source} -> ${next}`);
  source = next;
}

if (wantWrite || bumpKind) {
  let changed = 0;
  for (const path of DERIVED) {
    if (readVersion(path) === source) continue;
    writeVersion(path, source);
    console.log(`  wrote ${path}`);
    changed++;
  }
  if (readCargoVersion() !== source) {
    writeCargoVersion(source);
    console.log(`  wrote ${CARGO_MANIFEST}`);
    changed++;
  }
  console.log(changed === 0 ? `all manifests already at ${source}` : `synced ${changed} manifest(s) to ${source}`);
  process.exit(0);
}

// Report mode: fail loudly on drift so CI catches it before a tag does.
const drifted = DERIVED.filter((path) => readVersion(path) !== source);
const tauriVersion = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
).version;

if (tauriVersion !== '../package.json') {
  console.error(
    `✗ tauri.conf.json version is "${tauriVersion}" — it must be "../package.json" ` +
      'so the shipped binary cannot drift from the root manifest.',
  );
  process.exit(1);
}

if (drifted.length > 0 || readCargoVersion() !== source) {
  console.error(`✗ version drift — root is ${source}, these disagree:`);
  for (const path of drifted) console.error(`    ${path}: ${readVersion(path)}`);
  if (readCargoVersion() !== source) {
    console.error(`    ${CARGO_MANIFEST}: ${readCargoVersion()}`);
  }
  console.error('  Fix with: node scripts/version.mjs --write');
  process.exit(1);
}

console.log(`✓ all manifests at ${source}`);
