/// <reference path="../types/temporal.d.ts" />

/**
 * Runtime resolver for the Temporal API.
 *
 * Native `Temporal` exists in Chrome 144+ / Firefox 139+ and is NOT available in
 * Safari (as of this writing). The date helpers are synchronous, so they cannot
 * `await` a polyfill import themselves. The contract is:
 *
 *   - On engines with native Temporal, everything works immediately.
 *   - On engines without it, the app shell MUST `await initTemporal()` once,
 *     before the first render / before any date helper is called.
 *
 * `initTemporal()` is idempotent and safe to call concurrently. `getTemporal()`
 * is synchronous: it returns the cached implementation (native or polyfill) and
 * throws a descriptive error when neither is available yet.
 *
 * Node/Electron (including the vitest runner) additionally supports a
 * synchronous lazy load via `require(esm)`, so sync helpers work there without
 * an explicit `initTemporal()` call. Browsers keep the async path only.
 */

type TemporalApi = typeof Temporal;

interface NodeProcessLike {
  versions?: { node?: string };
  getBuiltinModule?: (id: string) => unknown;
}

interface NodeModuleBuiltin {
  createRequire(url: string | URL): (id: string) => unknown;
}

const globalObject = globalThis as { Temporal?: TemporalApi; process?: NodeProcessLike };

let cached: TemporalApi | null = globalObject.Temporal ?? null;
let pending: Promise<void> | null = null;

/** True when the engine ships Temporal natively (i.e. no polyfill needed). */
export function hasNativeTemporal(): boolean {
  return typeof globalObject.Temporal !== 'undefined';
}

/**
 * Synchronous accessor for the resolved Temporal implementation. Falls back to
 * a synchronous Node `require` of the polyfill where available.
 *
 * @throws if the engine has no native Temporal, no synchronous loader exists,
 * and `initTemporal()` has not completed yet.
 */
export function getTemporal(): TemporalApi {
  if (cached !== null) return cached;
  cached = tryLoadSync();
  if (cached !== null) return cached;
  throw new Error(
    'Temporal is not available in this engine and initTemporal() has not completed. ' +
      'Await initTemporal() once at startup (see apps/desktop/src/main.tsx) before using the date helpers.',
  );
}

/**
 * Resolves Temporal once at startup: native if present, otherwise the
 * `temporal-polyfill` package loaded through its own dynamic import.
 * Idempotent; a failed load may be retried by calling again.
 */
export function initTemporal(): Promise<void> {
  if (cached !== null) return Promise.resolve();
  pending ??= loadPolyfill();
  return pending;
}

async function loadPolyfill(): Promise<void> {
  try {
    // The polyfill ships its own full Temporal types; assign through our minimal
    // local shim. This is the one narrow cast the isolated type surface needs.
    const mod = (await import('temporal-polyfill')) as { Temporal: TemporalApi };
    cached = mod.Temporal;
  } finally {
    pending = null;
  }
}

/**
 * Best-effort synchronous load for Node/Electron: Node 22+ can `require()` an
 * ES module, and `process.getBuiltinModule` is reachable without a static
 * `node:` import, so browser bundles are unaffected. Returns null elsewhere.
 */
function tryLoadSync(): TemporalApi | null {
  const proc = globalObject.process;
  if (proc?.versions?.node === undefined || proc.getBuiltinModule === undefined) return null;
  try {
    const nodeModule = proc.getBuiltinModule('module') as NodeModuleBuiltin;
    const requireFn = nodeModule.createRequire(import.meta.url);
    const mod = requireFn('temporal-polyfill') as { Temporal: TemporalApi };
    return mod.Temporal;
  } catch {
    return null;
  }
}
