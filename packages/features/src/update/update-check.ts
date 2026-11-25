/**
 * Update-check port — the frontend declares it, the host implements it.
 *
 * ## What "纯本地" actually means
 *
 * The product is 纯本地 about **your data**: no account, no sync, no telemetry,
 * and your tasks never leave the machine. It has never meant "the app may never
 * touch the network". Checking a release endpoint for a newer version is a
 * normal, user-understood desktop behaviour, so this port models a proper
 * updater rather than a hand-copied file.
 *
 * The distinction that DOES hold:
 *
 *   - no background polling on a timer, and no request at startup;
 *   - nothing is sent about the user, the device, or their data — an update
 *     check is a plain GET for a static manifest, and the release server learns
 *     only what any HTTP request reveals;
 *   - the user opts in. Auto-download can be turned off; the manual check is a
 *     button, not a heartbeat.
 *
 * ## Transport
 *
 * The default source is a Tauri `latest.json` endpoint — the same file
 * `tauri-plugin-updater` consumes, which can be served by GitHub Releases, a
 * static host, or a local file. The host validates the response and reports a
 * normalized status; it never echoes a raw exception into the UI.
 *
 * ## Division of labour
 *
 * The host fetches and validates the transport. Comparing versions is done by
 * the pure, tested `evaluateUpdate()` below, so there is exactly one version
 * comparison implementation in TypeScript with unit tests backing it.
 *
 * ## Manifest shape (Tauri `latest.json`)
 *
 * ```json
 * {
 *   "version": "0.2.0",
 *   "notes": "可选的更新说明",
 *   "pub_date": "2026-11-24T00:00:00Z",
 *   "platforms": { "windows-x86_64": { "signature": "…", "url": "…" } }
 * }
 * ```
 *
 * Only `version` is read here; the platform URLs and signatures are consumed by
 * `tauri-plugin-updater` itself, never parsed in the UI.
 */

import { isUpdateAvailable } from '@todolist/core';

/** Where the manifest lives. Exactly one mode per check. */
export type UpdateSource =
  | {
      /**
       * Default for a GitHub-hosted release. `tauri-plugin-updater` fetches this
       * and verifies the signature before anything is installed.
       */
      readonly kind: 'endpoint';
      readonly url: string;
    }
  | {
      /**
       * A manifest the user already has on disk. Kept for air-gapped or
       * offline installs, and for testing without a live release.
       */
      readonly kind: 'file';
      readonly path: string;
    };

export interface UpdateManifest {
  /** Version string as written in the manifest (parsed later). */
  readonly version: string;
  /** Optional human-readable release notes. */
  readonly notes?: string;
  /** Optional release page; opened in the system browser on explicit click. */
  readonly releaseUrl?: string;
}

/**
 * Normalized transport outcome. The UI maps these to Chinese copy; a raw code
 * is never shown to the user.
 */
export type UpdateFetchStatus =
  /** A usable manifest was read; compare it with `evaluateUpdate`. */
  | 'manifest-read'
  /** No source configured yet. */
  | 'not-configured'
  /** The source was supplied but is malformed (empty path, non-https URL, …). */
  | 'invalid-source'
  /** File missing/unreadable, or the endpoint did not answer 2xx. */
  | 'unreachable'
  /** Not JSON, or does not match the manifest shape. */
  | 'invalid-manifest';

/** Result of asking the host to read a manifest. */
export type UpdateFetchOutcome =
  | { readonly status: 'manifest-read'; readonly manifest: UpdateManifest }
  | { readonly status: Exclude<UpdateFetchStatus, 'manifest-read'> };

/**
 * The only update capability the UI is given.
 *
 * Implementations MUST be side-effect free until a method is called. They MUST
 * NOT be wired to a startup effect or an interval.
 */
export interface UpdateChecker {
  /** Version of the running app, for display before any check happens. */
  readonly currentVersion: () => Promise<string>;
  /** Read the manifest at `source` (the user's explicit request). */
  readonly fetchManifest: (source: UpdateSource) => Promise<UpdateFetchOutcome>;
  /** Open an `https://` release page in the system browser (user click). */
  readonly openReleasePage: (url: string) => Promise<void>;
}

/** What the UI shows after comparing a manifest with the running version. */
export type UpdateAvailability = 'update-available' | 'up-to-date' | 'invalid-version';

export interface UpdateEvaluation {
  readonly status: UpdateAvailability;
  readonly currentVersion: string;
  readonly latestVersion: string;
}

/**
 * Pure comparison step: is the manifest's version newer than ours?
 *
 * Kept separate from transport so the (only) version logic is testable without
 * a host. An unparseable version yields `invalid-version` rather than guessing —
 * the panel then says 「无法比较版本」 instead of 「已是最新」.
 */
export function evaluateUpdate(currentVersion: string, manifest: UpdateManifest): UpdateEvaluation {
  const latestVersion = manifest.version;
  const newer = isUpdateAvailable(currentVersion, latestVersion);
  return {
    status: newer === null ? 'invalid-version' : newer ? 'update-available' : 'up-to-date',
    currentVersion,
    latestVersion,
  };
}

/**
 * The project's default update endpoint.
 *
 * Written as a GitHub Releases URL so it works as soon as the repository is
 * public: `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.
 * Empty means "not configured" — the panel then explains how to set it rather
 * than silently doing nothing.
 */
export const DEFAULT_UPDATE_ENDPOINT = '';

/** True when a source is ready to be fetched. */
export function isSourceConfigured(source: UpdateSource | null): source is UpdateSource {
  if (source === null) return false;
  if (source.kind === 'file') return source.path.trim().length > 0;
  return source.url.trim().length > 0;
}
