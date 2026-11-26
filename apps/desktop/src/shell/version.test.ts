/// <reference types="node" />
/**
 * Unit tests for `resolveAppVersion` — the rule that turns the raw
 * `tauri.conf.json > version` value into the number injected as
 * `import.meta.env.VITE_APP_VERSION` (P0-9).
 *
 * Run with Node's built-in runner (the desktop package has no vitest config):
 *
 *     node --test apps/desktop/src/shell/version.test.ts
 *
 * Node executes TypeScript directly and needs an explicit `.ts` extension on
 * the relative import; `allowImportingTsExtensions` is off for the app, hence
 * the targeted `@ts-expect-error` (tsc fails if the error ever disappears, so
 * this cannot rot silently).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
// @ts-expect-error -- Node's ESM loader requires the explicit .ts extension.
import { resolveAppVersion } from './version.ts';

/** The directory Tauri resolves `version` references against. */
const TAURI_DIR = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
/** `../package.json` as written in tauri.conf.json. */
const REFERENCE = '../package.json';

/** Read a path relative to the Tauri config, like Tauri's own deserializer. */
const readFromTauriDir = (path: string): string => readFileSync(resolve(TAURI_DIR, path), 'utf8');

test('a literal semver version is returned unchanged', () => {
  // readFile must not be consulted at all for a literal.
  const readFile = () => {
    throw new Error('readFile should not be called for a literal version');
  };
  assert.equal(resolveAppVersion('0.1.3', readFile), '0.1.3');
  assert.equal(resolveAppVersion('  1.2.3-rc.1  ', readFile), '1.2.3-rc.1');
  assert.equal(resolveAppVersion('1.2.3+build.7', readFile), '1.2.3+build.7');
});

test('"../package.json" resolves to the real version in apps/desktop/package.json', () => {
  // The bug's precondition: tauri.conf.json really stores the reference, not a
  // literal. If it is ever changed to a literal, this test says so.
  const tauriConfig = JSON.parse(readFromTauriDir('tauri.conf.json')) as { version: string };
  assert.equal(tauriConfig.version, REFERENCE);

  const resolved = resolveAppVersion(tauriConfig.version, readFromTauriDir);

  // The reference is relative to apps/desktop/src-tauri/, i.e. apps/desktop.
  const desktopManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  assert.equal(resolved, desktopManifest.version);

  // scripts/version.mjs keeps the root manifest and every workspace manifest in
  // lockstep, and asserts tauri.conf.json references exactly this path.
  const rootManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  assert.equal(resolved, rootManifest.version);

  // The bug: the raw reference string must never be the result.
  assert.notEqual(resolved, REFERENCE);
  assert.match(resolved, /^\d+\.\d+\.\d+/);
});

test('a missing file throws instead of silently returning the path', () => {
  assert.throws(
    () => resolveAppVersion('../does-not-exist.json', readFromTauriDir),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /could not be read/);
      assert.match(error.message, /\.\.\/does-not-exist\.json/);
      return true;
    },
  );
});

test('a referenced file whose version is not semver throws', () => {
  const notSemver = (path: string) => {
    assert.equal(path, REFERENCE);
    return JSON.stringify({ name: 'demo', version: 'not-a-version' });
  };
  assert.throws(() => resolveAppVersion(REFERENCE, notSemver), /not semver/);

  const missingVersion = () => JSON.stringify({ name: 'demo' });
  assert.throws(() => resolveAppVersion(REFERENCE, missingVersion), /no string "version" field/);

  const notJson = () => '{ nope';
  assert.throws(() => resolveAppVersion(REFERENCE, notJson), /not valid JSON/);
});

test('a value that is neither semver nor a file reference throws', () => {
  assert.throws(() => resolveAppVersion('latest', () => ''), /neither a semver string/);
  assert.throws(() => resolveAppVersion('', () => ''), /is empty/);
});
