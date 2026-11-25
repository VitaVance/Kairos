/**
 * Version comparison — pure, dependency-free, "semver-ish".
 *
 * This exists so the update checker can answer "is the manifest newer than
 * me?" without pulling in a semver package (the domain layer depends only on
 * TypeScript, and the desktop bundle should stay small). It intentionally
 * follows Semantic Versioning 2.0 *precedence* rules:
 *
 *   - release > prerelease        (1.0.0 > 1.0.0-rc.1)
 *   - prerelease identifiers compare left-to-right;
 *     numeric < alphanumeric, numerics numerically, strings lexically
 *   - a shorter prerelease is lower when it is a prefix (alpha < alpha.1)
 *   - build metadata is ignored   (1.0.0+a == 1.0.0+b)
 *
 * "ish" means the parser is deliberately forgiving at the edges, because the
 * values come from a hand-written `update.json`: an optional leading `v`, and
 * 1–3 numeric core parts (`1`, `1.2`, `1.2.3`) are accepted and padded with
 * zeros. Anything else yields `null` rather than a guess — callers must show
 * "无法比较" instead of silently treating a malformed version as newest.
 *
 * Numbers are capped at 9 digits by the parser, so no unsafe-integer or
 * precision surprises are possible.
 */

/** A prerelease identifier: numeric when it is all digits, else a string. */
export type VersionIdentifier = string | number;

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Empty for a release version; identifiers in declaration order otherwise. */
  readonly prerelease: readonly VersionIdentifier[];
}

/**
 * `v?` + 1..3 numeric parts, then optional `-prerelease` and `+build`.
 * The prerelease/build character class is the SemVer ASCII set; empty
 * identifiers (`1.0.0-a.`) are rejected after splitting, below.
 */
const VERSION_PATTERN =
  /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a version string. Returns `null` when it is not a recognisable version. */
export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(input.trim());
  if (match === null) return null;

  const prerelease: VersionIdentifier[] = [];
  const preRaw = match[4];
  if (preRaw !== undefined) {
    for (const identifier of preRaw.split('.')) {
      // "1.0.0-alpha." and "1.0.0-.." split to empty identifiers.
      if (identifier === '') return null;
      prerelease.push(/^\d+$/.test(identifier) ? Number(identifier) : identifier);
    }
  }

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease,
  };
}

/** SemVer identifier precedence. Assumes non-empty identifiers. */
function compareIdentifier(a: VersionIdentifier, b: VersionIdentifier): -1 | 0 | 1 {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Compare two versions by precedence.
 *
 * Returns `-1` if `a < b`, `0` if equal, `1` if `a > b`, or `null` when either
 * input cannot be parsed. Build metadata never affects the result.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;

  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;

  // A release version outranks any prerelease of the same core version.
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const shared = Math.min(leftPre.length, rightPre.length);
  for (let i = 0; i < shared; i += 1) {
    // Both indices are inside `shared`, so the values are present.
    const result = compareIdentifier(leftPre[i]!, rightPre[i]!);
    if (result !== 0) return result;
  }

  if (leftPre.length === rightPre.length) return 0;
  return leftPre.length < rightPre.length ? -1 : 1;
}

/**
 * True when `latest` is strictly newer than `current`.
 * `null` means one of the strings is not a recognisable version.
 */
export function isUpdateAvailable(current: string, latest: string): boolean | null {
  const result = compareVersions(current, latest);
  return result === null ? null : result < 0;
}
