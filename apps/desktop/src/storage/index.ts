import { MemoryUnitOfWork, SqliteUnitOfWork, migrate } from '@todolist/adapters';
import type { IdGenerator, UnitOfWork } from '@todolist/core';
import { createTauriSqlDriver, isTauri } from './tauri-sql-driver';

/**
 * How this process stores data.
 *
 * - `sqlite` — a real file in the Tauri app-data dir (`todolist.db`).
 * - `memory` — the in-memory adapter, for `pnpm dev` in a plain browser.
 */
export type StorageMode = 'sqlite' | 'memory';

export interface StorageHandle {
  readonly uow: UnitOfWork;
  readonly mode: StorageMode;
  /** Release native resources; a no-op for the in-memory adapter. */
  readonly close: () => Promise<void>;
}

/**
 * Pick the storage backend for the current host.
 *
 * In the Tauri webview this opens `sqlite:todolist.db`, applies the adapter
 * migrations (idempotent, safe on every start) and returns a SQLite-backed
 * `UnitOfWork`. Anywhere else — `pnpm dev` opened in Chrome — it falls back to
 * memory so the UI still runs, and says so once in the console.
 */
export async function createStorage(deps: { readonly ids: IdGenerator }): Promise<StorageHandle> {
  if (isTauri()) {
    const { driver, close } = await createTauriSqlDriver();
    await migrate(driver);
    return { uow: new SqliteUnitOfWork(driver, deps.ids), mode: 'sqlite', close };
  }

  console.info(
    '[storage] 浏览器开发模式：数据仅保存在内存中，刷新即丢失。' +
      '持久化（SQLite）仅在打包后的 Tauri 应用中生效。',
  );
  return {
    uow: new MemoryUnitOfWork(),
    mode: 'memory',
    close: async () => {},
  };
}
