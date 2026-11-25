import type {
  UpdateChecker,
  UpdateFetchOutcome,
  UpdateManifest,
  UpdateSource,
} from '@todolist/features';
import { isTauri } from '../host';

/**
 * Tauri host implementation of `UpdateChecker`, built on the official
 * `tauri-plugin-updater`.
 *
 * Why the plugin rather than a hand-rolled fetch: it verifies a **signature**
 * over the update artifact before anything is installed. A plain `fetch` of a
 * `latest.json` tells you a version number exists; it does not prove the
 * installer you are about to run was published by this project. For a public,
 * open-source release channel that signature is the whole security story, so
 * the plugin is the correct tool even though it costs a small crate.
 *
 * Nothing is loaded until a method is called — the browser dev build never
 * bundles or evaluates the native bridge.
 */

type UpdaterModule = typeof import('@tauri-apps/plugin-updater');

let updaterPromise: Promise<UpdaterModule | null> | null = null;

function loadUpdater(): Promise<UpdaterModule | null> {
  if (updaterPromise === null) {
    updaterPromise = import('@tauri-apps/plugin-updater').catch((error: unknown) => {
      console.warn('[update] 更新插件不可用', error);
      return null;
    });
  }
  return updaterPromise;
}

/** The running app's version, injected at build time. */
const APP_VERSION: string =
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.1.0';

/**
 * The release feed this build checks against.
 *
 * Must match `plugins.updater.endpoints` in `tauri.conf.json` — that copy is
 * what the Rust plugin actually fetches; this one only lets the UI say whether
 * a feed is configured at all. `OWNER/REPO` is replaced when the repository is
 * published; until then the panel honestly reports "尚未配置更新源".
 */
export const UPDATE_ENDPOINT =
  (import.meta.env?.VITE_UPDATE_ENDPOINT as string | undefined) ?? '';

/**
 * Read a manifest from a local file over IPC.
 *
 * The plugin only speaks HTTP endpoints, so the offline/manual path uses the
 * Rust command instead. Both paths end in the same `UpdateManifest` shape.
 */
async function readLocalManifest(path: string): Promise<UpdateFetchOutcome> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<{
      version: string;
      notes?: string;
      releaseUrl?: string;
    }>('read_update_manifest', { path });

    const notes = raw.notes;
    const releaseUrl = raw.releaseUrl;
    return {
      status: 'manifest-read',
      manifest: {
        version: raw.version,
        ...(notes === undefined ? {} : { notes }),
        ...(releaseUrl === undefined ? {} : { releaseUrl }),
      },
    };
  } catch (error: unknown) {
    const status = (error as { status?: string } | null)?.status;
    if (status === 'invalid-source' || status === 'unreachable' || status === 'invalid-manifest') {
      return { status };
    }
    console.warn('[update] 读取本地更新清单失败', error);
    return { status: 'unreachable' };
  }
}

/**
 * Read a manifest from an HTTPS endpoint via the updater plugin.
 *
 * `check()` reads the endpoint's `latest.json`, verifies the signature of the
 * artifact it points at, and returns `null` when the running version is already
 * current. We surface the version/notes and let the panel decide what to show.
 */
async function readEndpointManifest(url: string): Promise<UpdateFetchOutcome> {
  if (!url.startsWith('https://')) return { status: 'invalid-source' };

  const updater = await loadUpdater();
  if (updater === null) return { status: 'unreachable' };

  try {
    const update = await updater.check({ headers: {}, proxy: undefined });
    // `null` means "up to date"; report our own version so the panel can say so
    // in the same shape as every other outcome.
    if (update === null) {
      return { status: 'manifest-read', manifest: { version: APP_VERSION } };
    }

    const manifest: UpdateManifest = {
      version: update.version,
      ...(update.body === undefined || update.body === '' ? {} : { notes: update.body }),
    };
    return { status: 'manifest-read', manifest };
  } catch (error: unknown) {
    // A network failure and a bad endpoint are different problems for the user:
    // one means "try later", the other means "the release feed is broken".
    const message = error instanceof Error ? error.message : String(error);
    if (/json|manifest|parse|invalid/i.test(message)) {
      return { status: 'invalid-manifest' };
    }
    console.warn('[update] 读取更新端点失败', error);
    return { status: 'unreachable' };
  }
}

export function createTauriUpdateChecker(): UpdateChecker {
  return {
    currentVersion: async () => APP_VERSION,

    fetchManifest: async (source: UpdateSource): Promise<UpdateFetchOutcome> => {
      if (source.kind === 'file') {
        const path = source.path.trim();
        if (path.length === 0) return { status: 'not-configured' };
        if (!isTauri()) return { status: 'unreachable' };
        return readLocalManifest(path);
      }

      const url = source.url.trim();
      if (url.length === 0) return { status: 'not-configured' };
      if (!isTauri()) return { status: 'unreachable' };
      return readEndpointManifest(url);
    },

    /**
     * Opens the release page in the system browser on an explicit click.
     *
     * `https://` only: handing an arbitrary scheme to the OS opener is a way to
     * turn a release-notes string into code execution on some platforms.
     */
    openReleasePage: async (url: string) => {
      if (!url.startsWith('https://')) return;

      if (!isTauri()) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch (error: unknown) {
        console.warn('[update] 无法打开发布页', error);
      }
    },
  };
}
