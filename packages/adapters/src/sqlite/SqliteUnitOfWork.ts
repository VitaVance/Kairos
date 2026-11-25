import type { UnitOfWork } from '@todolist/core';
import type { IdGenerator } from '@todolist/core';
import type { SqlDriver } from '../sql-driver.js';
import { SqliteEventRepository, SqliteListRepository, SqliteTaskRepository } from './repositories.js';

/**
 * The whole persistence surface of the app, backed by SQLite through a
 * platform-neutral `SqlDriver`.
 *
 * The caller owns the driver lifecycle and must run `migrate(driver)` once
 * before use (see `schema.ts`). This class never calls `migrate` itself so a
 * composition root can decide when/where schema work happens.
 *
 * ```ts
 * const driver = wrapTauriSql(await Database.load('sqlite:todolist.db'));
 * await migrate(driver);
 * const uow = new SqliteUnitOfWork(driver, ids);
 * ```
 */
export class SqliteUnitOfWork implements UnitOfWork {
  readonly tasks: SqliteTaskRepository;
  readonly lists: SqliteListRepository;
  readonly events: SqliteEventRepository;

  constructor(driver: SqlDriver, ids: IdGenerator) {
    this.tasks = new SqliteTaskRepository(driver, ids);
    this.lists = new SqliteListRepository(driver, ids);
    this.events = new SqliteEventRepository(driver, ids);
  }
}
