/**
 * The smallest persistence port this package needs.
 *
 * These interfaces deliberately belong to the adapters layer, not to core:
 * the domain has no opinion about SQL. The repositories in `sqlite/` speak
 * only this port.
 *
 * Host wiring (one thin wrapper each, living in the host app):
 *
 * - Tauri desktop: wrap `@tauri-apps/plugin-sql`'s `Database.load(...)`.
 *   `db.execute(sql, params)` → `execute`, `db.select(sql, params)` → `query`.
 * - React Native mobile: wrap `op-sqlite`'s `open({ name })`. `db.execute`
 *   and `db.executeRaw` map to `execute`/`query` depending on the driver
 *   version.
 *
 * Because neither platform type leaks through this port, `sqlite/` compiles
 * and its tests run in plain Node without a native SQLite dependency.
 */

export interface SqlDriver {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Optional companion port for hosts whose driver supports transactions.
 * Repositories do not require it; multi-repository use cases can accept it
 * alongside a `UnitOfWork` when atomicity matters.
 */
export interface SqlTransactionRunner {
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}
