/**
 * Resolve the app version declared in `apps/desktop/src-tauri/tauri.conf.json`.
 *
 * Tauri's `version` field takes either a bare semver string **or** a path to a
 * JSON file whose `version` field is used instead. The Rust side
 * (`tauri-utils/src/config.rs`, the `PackageVersion` deserializer) reads the
 * file when the path exists and otherwise parses the value as semver. This
 * build uses the reference form:
 *
 *     "version": "../package.json"
 *
 * Vite knows nothing about that indirection. `JSON.stringify(tauriConfig.version)`
 * therefore baked the literal `"../package.json"` into the bundle as
 * `import.meta.env.VITE_APP_VERSION`. That string reached the About pane and
 * `parseVersion()` / `compareVersions()`, which reject it, so every update
 * check ended in `invalid-version` — the panel blamed the release manifest for
 * a version we injected ourselves. This module follows the reference exactly
 * as Tauri does, so the two can never disagree.
 *
 * ## Which `package.json` does `../package.json` mean?
 *
 * Tauri resolves the reference relative to the directory that holds
 * `tauri.conf.json`: `tauri-codegen` (and the bundler) change the process cwd to
 * that parent before deserialising the config, precisely so "relative paths in
 * it are parsed correctly" (`tauri-codegen/src/lib.rs`). The config lives in
 * `apps/desktop/src-tauri/`, so `../package.json` resolves to
 * `apps/desktop/package.json`.
 *
 * That file *does* have a `version` field (`"0.1.3"` at the time of writing),
 * and `scripts/version.mjs` keeps it, every other workspace manifest, and
 * `Cargo.toml` at the root manifest's version. It also refuses any
 * `tauri.conf.json` whose version is not exactly `../package.json`, which makes
 * this reference the canonical one. Root `package.json` and
 * `apps/desktop/package.json` therefore always carry the same number; we follow
 * Tauri's own base directory rather than guessing the root, so the injected
 * value always matches the binary's `ProductVersion`.
 *
 * ## Why a pure function
 *
 * `readFile` is injected so the whole resolver is testable without touching
 * the filesystem, and so the vite config (which alone knows the base
 * directory) owns path resolution. There is exactly one implementation of the
 * reference-following rule, and it is unit-tested.
 */

/**
 * A strict SemVer 2.0 version — `major.minor.patch` plus optional prerelease
 * and build metadata, no leading `v`, no shorthand parts.
 *
 * Stricter than `@todolist/core`'s forgiving `parseVersion()` on purpose:
 * this runs at build time, where a malformed value should stop the build
 * instead of shipping and surfacing as `invalid-version` at runtime. It mirrors
 * `semver::Version::from_str`, which is what Tauri itself validates with.
 */
const SEMVER = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Reads a file as UTF-8; throws when it does not exist or is unreadable. */
export type ReadFile = (path: string) => string;

/** A value that points at a JSON manifest rather than being a version. */
function isFileReference(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.endsWith('.json');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the raw `tauri.conf.json > version` value to a concrete version.
 *
 * - a bare semver string (`"0.1.3"`) is returned unchanged;
 * - a file reference (`"../package.json"`, `"./package.json"`) is read through
 *   `readFile` (the caller resolves it against the config's directory) and its
 *   `version` field is validated;
 * - a missing/unreadable file, a non-JSON file, a missing string `version`, or
 *   a `version` that is not semver all throw — never silently return the path.
 */
export function resolveAppVersion(raw: string, readFile: ReadFile): string {
  const value = raw.trim();

  if (value.length === 0) {
    throw new Error('tauri.conf.json > version is empty');
  }

  if (SEMVER.test(value)) return value;

  if (!isFileReference(value)) {
    throw new Error(
      `tauri.conf.json > version "${value}" is neither a semver string nor a path to a JSON file`,
    );
  }

  let contents: string;
  try {
    contents = readFile(value);
  } catch (error) {
    // The failure that P0-9 was: returning the path here would inject it as the
    // version. Fail the build instead, loudly.
    throw new Error(
      `tauri.conf.json > version points at "${value}", but that file could not be read: ${describe(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `tauri.conf.json > version points at "${value}", which is not valid JSON: ${describe(error)}`,
    );
  }

  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version !== 'string') {
    throw new Error(`tauri.conf.json > version points at "${value}", which has no string "version" field`);
  }
  if (!SEMVER.test(version)) {
    throw new Error(
      `tauri.conf.json > version points at "${value}", whose version "${version}" is not semver`,
    );
  }

  return version;
}
