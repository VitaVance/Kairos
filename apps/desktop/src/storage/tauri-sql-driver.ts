import type Database from '@tauri-apps/plugin-sql';
import type { SqlDriver } from '@todolist/adapters';

/**
 * Tauri host wrapper for the adapters-internal `SqlDriver` port.
 *
 * The plugin is loaded lazily with `import()` rather than a static import so
 * the browser dev build (`pnpm dev`, no Tauri) never pulls the native bridge
 * into the initial bundle. A static import also resolves cleanly under Vite,
 * but dynamic loading keeps the browser path honest: only `isTauri()` hosts
 * ever evaluate `@tauri-apps/plugin-sql`.
 *
 * Bind values: the adapters layer already encodes booleans as 0/1
 * (`fields.encodeSqlValue`, and every `xToRow` mapping does `b ? 1 : 0`), so
 * params arrive as numbers/strings/null and need no conversion here — only a
 * copy from the readonly port type to the mutable `unknown[]` the plugin wants.
 */

const DATABASE_URL = 'sqlite:todolist.db';

let databasePromise: Promise<Database> | null = null;

/** Load (once) and reuse the plugin's connection for this process. */
function loadDatabase(): Promise<Database> {
  if (databasePromise === null) {
    databasePromise = import('@tauri-apps/plugin-sql')
      .then(({ default: DatabaseImpl }) => DatabaseImpl.load(DATABASE_URL))
      .catch((error: unknown) => {
        // Let a later retry (or reload) start from a clean slate.
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

function bindValues(params?: readonly unknown[]): unknown[] {
  return params === undefined ? [] : [...params];
}

export interface TauriSqlDriverHandle {
  readonly driver: SqlDriver;
  /** Release the plugin's connection pool (Tauri keeps one per database path). */
  readonly close: () => Promise<void>;
}

export async function createTauriSqlDriver(): Promise<TauriSqlDriverHandle> {
  const db = await loadDatabase();

  return {
    driver: {
      execute: async (sql, params) => {
        await db.execute(sql, bindValues(params));
      },
      query: async <T>(sql: string, params?: readonly unknown[]) =>
        db.select<T[]>(sql, bindValues(params)),
    },
    close: async () => {
      await db.close();
      databasePromise = null;
    },
  };
}

/** Re-exported so existing callers (`./index`) keep one import path. */
export { isTauri } from '../host';
