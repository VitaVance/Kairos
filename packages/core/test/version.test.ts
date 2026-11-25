import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isUpdateAvailable,
  parseVersion,
} from '../src/shared/version.js';

/**
 * SemVer 2.0 precedence, as used by the update checker.
 *
 * The point of these tests is the *edges*: a hand-written `update.json` will
 * contain `v1.2`, `1.0.0-rc.1`, and outright garbage, and the checker must
 * answer "newer / not newer / cannot compare" without ever guessing. Treating
 * an unparseable version as newest would offer a downgrade as an update.
 */

describe('parseVersion', () => {
  it('parses a full semantic version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('accepts a leading v and pads short cores with zeros', () => {
    expect(parseVersion('v1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] });
    expect(parseVersion('v2.4')).toEqual({ major: 2, minor: 4, patch: 0, prerelease: [] });
  });

  it('splits prerelease identifiers into numeric and alphabetic parts', () => {
    expect(parseVersion('1.0.0-alpha.2')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', 2],
    });
  });

  it('ignores build metadata', () => {
    expect(parseVersion('1.0.0+build.7')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
    });
  });

  it('rejects input that is not a version rather than guessing', () => {
    for (const bad of ['', 'latest', '1.2.3.4', '1.0.0-', '1.0.0-alpha.', 'v', '1.x.3']) {
      expect(parseVersion(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.12.0', '1.2.0')).toBe(1);
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
  });

  it('treats differently-written equal versions as equal', () => {
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('ranks a release above any prerelease of the same core', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('ranks numeric prerelease identifiers below alphanumeric ones', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
  });

  it('compares numeric identifiers numerically, not as strings', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
  });

  it('ranks a shorter prerelease lower when it is a prefix', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('1.0.0', 'latest')).toBeNull();
    expect(compareVersions('', '1.0.0')).toBeNull();
    expect(compareVersions('nope', 'nope')).toBeNull();
  });
});

describe('isUpdateAvailable', () => {
  it('is true only when the manifest is strictly newer', () => {
    expect(isUpdateAvailable('0.1.0', '0.2.0')).toBe(true);
    expect(isUpdateAvailable('0.1.0', '0.1.0')).toBe(false);
    // A manifest OLDER than what is installed must not offer a downgrade.
    expect(isUpdateAvailable('0.2.0', '0.1.0')).toBe(false);
  });

  it('reports null, not false, when a version cannot be compared', () => {
    // A malformed manifest must surface as "cannot compare" in the UI; mapping
    // it to `false` would silently claim the app is up to date.
    expect(isUpdateAvailable('0.1.0', 'not-a-version')).toBeNull();
    expect(isUpdateAvailable('not-a-version', '0.1.0')).toBeNull();
  });

  it('does not treat a prerelease of the same version as an update', () => {
    expect(isUpdateAvailable('1.0.0-rc.1', '1.0.0')).toBe(true);
    expect(isUpdateAvailable('1.0.0', '1.0.0-rc.1')).toBe(false);
  });
});
