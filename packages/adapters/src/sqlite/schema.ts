import type { SqlDriver } from '../sql-driver.js';

/**
 * Ordered, append-only migrations.
 *
 * Rules for future changes:
 * - Never edit a shipped migration; append a new `{ version: n + 1 }` entry.
 * - Every statement must be safe to run against a database whose schema is
 *   already current from an earlier process (IF NOT EXISTS for DDL).
 * - Values are never interpolated into DDL here; DDL is static by nature.
 *
 * Conventions:
 * - ids/instants are TEXT (ISO-8601 sorts lexicographically, so range filters
 *   are plain `>` / `<` comparisons).
 * - booleans are INTEGER 0/1 with CHECK constraints.
 * - foreign keys are declared; `migrate` turns enforcement on per connection.
 */
export interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS lists (
        id          TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL,
        "order"     INTEGER NOT NULL,
        archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id            TEXT PRIMARY KEY NOT NULL,
        list_id       TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        notes         TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
        important     INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
        urgent        INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
        due_at        TEXT,
        due_date      TEXT,
        all_day       INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
        completed_at  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY NOT NULL,
        list_id     TEXT REFERENCES lists(id) ON DELETE SET NULL,
        title       TEXT NOT NULL,
        notes       TEXT NOT NULL DEFAULT '',
        start_at    TEXT NOT NULL,
        end_at      TEXT NOT NULL,
        all_day     INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at)`,
      `CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at)`,
      `CREATE INDEX IF NOT EXISTS idx_events_end_at ON events(end_at)`,
    ],
  },
  {
    version: 2,
    statements: [
      // Recurring tasks. NULL means "does not repeat", which is the state of
      // every row that existed before this migration — no backfill needed.
      // The COLUMN stores canonical JSON (see adapters/src/recurrence-codec.ts).
      `ALTER TABLE tasks ADD COLUMN recurrence TEXT`,
    ],
  },
  {
    version: 3,
    statements: [
      // Half-day precision. NULL means "no period", which is exactly the
      // meaning of every existing row — so there is no DEFAULT and no
      // backfill: a nullable ADD COLUMN is an O(1) metadata change in SQLite,
      // not a table rewrite.
      //
      // A non-null value implies allDay = 1 and dueDate IS NOT NULL. That
      // coupling is enforced in TaskService rather than here because a
      // cross-column CHECK cannot be added by ADD COLUMN (SQLite rejects it),
      // and re-creating the table to get one would rewrite every row.
      //
      // No index: nothing filters by period; range queries still use
      // due_at/due_date. The CHECK only references its own column, which is
      // what makes it legal on this path on every bundled SQLite version.
      `ALTER TABLE tasks ADD COLUMN due_period TEXT
        CHECK (due_period IS NULL OR due_period IN ('morning', 'afternoon', 'evening'))`,
    ],
  },
  {
    version: 4,
    statements: [
      // Small key/value store for app-level decisions that must live with the
      // data (today: "onboarding dismissed", so a cleared demo never re-seeds).
      // A row per key, not a column on an existing table: nothing here is a
      // property of a task or a list. `IF NOT EXISTS` keeps it replay-safe.
      `CREATE TABLE IF NOT EXISTS settings (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,
    ],
  },
];

/**
 * Apply every migration newer than the recorded schema version.
 *
 * Safe to call on every app start: the version table guards real migrations,
 * and the DDL itself is `IF NOT EXISTS`, so a driver that cannot report the
 * version (e.g. a recording test fake) still ends up in a valid state.
 *
 * There is no clock parameter on purpose — adapters never call `Date.now()`.
 * The applied timestamp comes from SQLite's own `CURRENT_TIMESTAMP`.
 */
export async function migrate(driver: SqlDriver): Promise<void> {
  // Must be set per connection; foreign keys are opt-in in SQLite.
  await driver.execute('PRAGMA foreign_keys = ON');

  await driver.execute(
    `CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY NOT NULL,
      applied_at  TEXT NOT NULL
    )`,
  );

  const rows = await driver.query<{ version: unknown }>(
    'SELECT MAX(version) AS version FROM schema_version',
  );
  const current = toVersion(rows[0]?.version);

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    for (const statement of migration.statements) {
      await driver.execute(statement);
    }
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)',
      [migration.version],
    );
  }
}

function toVersion(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}
