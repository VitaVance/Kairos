/**
 * @todolist/adapters — concrete implementations of the core ports.
 *
 * Nothing here imports React, Tauri or React Native. The SQLite layer talks to
 * an abstract `SqlDriver`; hosts wrap their own driver into that port.
 */

export type { SqlDriver, SqlTransactionRunner } from './sql-driver.js';

export {
  EntityNotFoundError,
  InvalidEntityError,
  RowDecodeError,
} from './errors.js';
export type { EntityKind } from './errors.js';

export { MemoryUnitOfWork } from './memory/MemoryUnitOfWork.js';

export { SqliteUnitOfWork } from './sqlite/SqliteUnitOfWork.js';
export {
  SqliteEventRepository,
  SqliteListRepository,
  SqliteTaskRepository,
} from './sqlite/repositories.js';
export { migrate, migrations } from './sqlite/schema.js';
export type { Migration } from './sqlite/schema.js';
export {
  eventToRow,
  listToRow,
  rowToEvent,
  rowToList,
  rowToTask,
  taskToRow,
} from './sqlite/mapping.js';
export type { EventRow, ListRow, TaskRow } from './sqlite/mapping.js';

export {
  EVENT_FIELD_COLUMNS,
  EVENT_PATCH_FIELDS,
  LIST_FIELD_COLUMNS,
  LIST_PATCH_FIELDS,
  TASK_FIELD_COLUMNS,
  TASK_PATCH_FIELDS,
  buildAssignments,
  encodeTaskFieldValue,
} from './fields.js';

export { decodeRecurrenceValue, encodeRecurrenceValue } from './recurrence-codec.js';

export { SystemClock } from './system/SystemClock.js';
export { CryptoIdGenerator } from './system/CryptoIdGenerator.js';

export { RecordingSqlDriver } from './testing/sql-test-driver.js';
export type { RecordedStatement } from './testing/sql-test-driver.js';
export { seedDemoData } from './testing/seed-demo.js';
export type { SeedDeps } from './testing/seed-demo.js';
