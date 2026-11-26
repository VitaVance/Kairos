import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CryptoIdGenerator } from '../src/system/CryptoIdGenerator.js';
import { migrate } from '../src/sqlite/schema.js';
import { SqliteUnitOfWork } from '../src/sqlite/SqliteUnitOfWork.js';
import { MemoryUnitOfWork } from '../src/memory/MemoryUnitOfWork.js';
import { TASK_FIELD_COLUMNS, TASK_PATCH_FIELDS } from '../src/fields.js';
import type { SqlDriver } from '../src/sql-driver.js';
import type {
  DuePeriod,
  Instant,
  LocalDate,
  ListId,
  Task,
  UnitOfWork,
} from '@todolist/core';
import { duePrecisionOf, instantAtLocal, startOfDay } from '@todolist/core';

/**
 * Storage half of half-day precision (schema v3), exercised against a real
 * SQLite engine plus the in-memory adapter.
 *
 * `node:sqlite` matters here for the same reason as sqlite-real.test.ts: the
 * generated SQL can be perfect text and still be rejected by SQLite (a CHECK
 * expression in `ADD COLUMN`, for one). And the migration assertions are
 * about actual stored values, which a recording driver cannot show.
 */

const DATE = '2026-09-06' as LocalDate;
const NOW = '2026-09-06T02:00:00.000Z' as Instant;
const LIST = 'list-1' as ListId;

function realDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    async execute(sql: string, params: readonly unknown[] = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
  };
}

/** A v2-shaped database: migrations 1 and 2 applied by hand, version recorded. */
async function v2Driver(): Promise<SqlDriver> {
  const d = realDriver();
  await d.execute('PRAGMA foreign_keys = ON');
  await d.execute(
    `CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`,
  );
  await d.execute(
    `CREATE TABLE lists (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      "order" INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  );
  // Exactly migration 1 + 2's tasks table, including the v2 recurrence column.
  await d.execute(
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      important INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
      due_at TEXT, due_date TEXT,
      all_day INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      recurrence TEXT
    )`,
  );
  await d.execute('INSERT INTO schema_version (version, applied_at) VALUES (1, \'2026-01-01\')');
  await d.execute('INSERT INTO schema_version (version, applied_at) VALUES (2, \'2026-02-01\')');
  await d.execute(
    `INSERT INTO lists (id, name, color, "order", archived, created_at, updated_at)
     VALUES ('list-1', '旧清单', '#123456', 0, 0, ?, ?)`,
    [NOW, NOW],
  );
  return d;
}

describe('migration v2 → v3', () => {
  it('preserves every old row byte-identically and reads duePeriod as null', async () => {
    const legacy = await v2Driver();

    // Seed rows that exercise each old precision the v2 era could store:
    // dateless, day (midnight + all_day), exact time, and with a recurrence.
    await legacy.execute(
      `INSERT INTO tasks (id, list_id, title, notes, status, important, urgent, due_at, due_date, all_day, completed_at, created_at, updated_at, recurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        't-none', LIST, '无日期', '', 'open', 0, 0, null, null, 0, null, NOW, NOW, null,
      ],
    );
    await legacy.execute(
      `INSERT INTO tasks (id, list_id, title, notes, status, important, urgent, due_at, due_date, all_day, completed_at, created_at, updated_at, recurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        't-day', LIST, '全天', '备注', 'open', 1, 0,
        // Deliberately not local midnight: the migration must not "fix" data,
        // it must leave every stored value exactly as it was.
        '2026-08-01T05:06:07.000Z', '2026-08-01', 1, null, NOW, NOW, null,
      ],
    );
    await legacy.execute(
      `INSERT INTO tasks (id, list_id, title, notes, status, important, urgent, due_at, due_date, all_day, completed_at, created_at, updated_at, recurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        't-time', LIST, '精确时刻', '', 'done', 0, 1,
        '2026-08-02T09:30:00.000Z', '2026-08-02', 0, '2026-08-02T10:00:00.000Z', NOW, NOW,
        '{"frequency":"daily","interval":1,"until":null}',
      ],
    );

    const columnsBefore = await legacy.query<{ name: string }>('PRAGMA table_info(tasks)');
    expect(columnsBefore.map((c) => c.name)).not.toContain('due_period');

    const before = await legacy.query<Record<string, unknown>>(
      'SELECT id, title, notes, status, important, urgent, due_at, due_date, all_day, completed_at, recurrence, created_at, updated_at FROM tasks ORDER BY id',
    );

    await migrate(legacy);

    const after = await legacy.query<Record<string, unknown>>(
      'SELECT id, title, notes, status, important, urgent, due_at, due_date, all_day, completed_at, recurrence, created_at, updated_at FROM tasks ORDER BY id',
    );
    expect(after).toEqual(before);

    // The new column exists and is NULL for every pre-existing row.
    const periods = await legacy.query<{ id: string; due_period: unknown }>(
      'SELECT id, due_period FROM tasks ORDER BY id',
    );
    expect(periods.map((r) => r.due_period)).toEqual([null, null, null]);

    // And the domain view agrees: null period == the old meaning (day / time /
    // none), which is what duePrecisionOf is for.
    const uow = new SqliteUnitOfWork(legacy, new CryptoIdGenerator());
    const day = await uow.tasks.get('t-day' as never);
    expect(day?.duePeriod).toBeNull();
    expect(day && duePrecisionOf(day)).toBe('day');
    const timed = await uow.tasks.get('t-time' as never);
    expect(timed?.duePeriod).toBeNull();
    expect(timed && duePrecisionOf(timed)).toBe('time');
    expect(timed?.recurrence).toEqual({ frequency: 'daily', interval: 1, until: null });
  });

  it('records every applied version and is idempotent', async () => {
    const driver = await v2Driver();
    await migrate(driver);
    await expect(migrate(driver)).resolves.toBeUndefined();

    const versions = await driver.query<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version',
    );
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);

    const columns = await driver.query<{ name: string }>('PRAGMA table_info(tasks)');
    expect(columns.filter((c) => c.name === 'due_period')).toHaveLength(1);
  });

  it('enforces the period vocabulary, but not the cross-column coupling', async () => {
    const driver = realDriver();
    await migrate(driver);

    // The CHECK rejects anything outside the enum.
    await expect(
      driver.execute(
        `INSERT INTO lists (id, name, color, "order", created_at, updated_at)
         VALUES ('list-1', 'L', '#000000', 0, ?, ?)`,
        [NOW, NOW],
      ),
    ).resolves.toBeUndefined();
    await expect(
      driver.execute(
        `INSERT INTO tasks (id, list_id, title, due_period, created_at, updated_at)
         VALUES ('bad', 'list-1', 'x', 'night', ?, ?)`,
        [NOW, NOW],
      ),
    ).rejects.toThrow();
  });
});

describe('write path — the TASK_PATCH_FIELDS allowlist', () => {
  it('includes duePeriod and maps it to due_period', () => {
    // This is the easy-to-miss half of the change: a domain field missing from
    // the allowlist is dropped from every UPDATE with no error at all.
    expect(TASK_PATCH_FIELDS).toContain('duePeriod');
    expect(TASK_FIELD_COLUMNS.duePeriod).toBe('due_period');
  });

  it('round-trips duePeriod through update() on the memory adapter', async () => {
    const uow = new MemoryUnitOfWork();
    const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
    const task = await uow.tasks.create({ title: '写周报', listId: list.id }, NOW);
    expect(task.duePeriod).toBeNull();

    const updated = await uow.tasks.update(task.id, { duePeriod: 'morning' }, NOW);
    expect(updated.duePeriod).toBe('morning');
    expect((await uow.tasks.get(task.id))?.duePeriod).toBe('morning');

    const cleared = await uow.tasks.update(task.id, { duePeriod: null }, NOW);
    expect(cleared.duePeriod).toBeNull();
  });

  it('round-trips duePeriod through update() on SQLite', async () => {
    const driver = realDriver();
    await migrate(driver);
    const uow = new SqliteUnitOfWork(driver, new CryptoIdGenerator());
    const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
    const task = await uow.tasks.create({ title: '写周报', listId: list.id }, NOW);

    const updated = await uow.tasks.update(task.id, { duePeriod: 'afternoon' }, NOW);
    expect(updated.duePeriod).toBe('afternoon');

    const rows = await driver.query<{ due_period: unknown }>(
      'SELECT due_period FROM tasks WHERE id = ?',
      [task.id],
    );
    expect(rows[0]?.due_period).toBe('afternoon');

    const cleared = await uow.tasks.update(task.id, { duePeriod: null }, NOW);
    expect(cleared.duePeriod).toBeNull();
  });

  it('carries duePeriod through create() for both adapters', async () => {
    const driver = realDriver();
    await migrate(driver);
    const uows: UnitOfWork[] = [new MemoryUnitOfWork(), new SqliteUnitOfWork(driver, new CryptoIdGenerator())];

    for (const uow of uows) {
      const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
      const task = await uow.tasks.create(
        {
          title: '上午开会',
          listId: list.id,
          dueDate: DATE,
          dueAt: startOfDay(DATE),
          allDay: true,
          duePeriod: 'morning',
        },
        NOW,
      );
      expect(task.duePeriod).toBe('morning');
      expect((await uow.tasks.get(task.id))?.duePeriod).toBe('morning');
    }
  });

  it('reads a row written before the column existed as null', async () => {
    const driver = await v2Driver();
    await migrate(driver);
    await driver.execute(
      `INSERT INTO tasks (id, list_id, title, created_at, updated_at)
       VALUES ('old', 'list-1', '旧任务', ?, ?)`,
      [NOW, NOW],
    );
    const uow = new SqliteUnitOfWork(driver, new CryptoIdGenerator());
    expect((await uow.tasks.get('old' as never))?.duePeriod).toBeNull();
  });
});

/**
 * The same four `schedule()` variants against both adapters, with one shared
 * assertion set — the port contract ADR 0003 asks for, so a backend cannot
 * drift from the service's invariants unnoticed.
 */
describe('schedule() contract — memory and SQLite', () => {
  const adapters: [string, () => Promise<UnitOfWork>][] = [
    ['memory', async () => new MemoryUnitOfWork()],
    [
      'sqlite',
      async () => {
        const driver = realDriver();
        await migrate(driver);
        return new SqliteUnitOfWork(driver, new CryptoIdGenerator());
      },
    ],
  ];

  for (const [name, make] of adapters) {
    describe(name, () => {
      // Imported lazily inside the test so this file stays about storage; the
      // service is the thing under contract.
      it('writes the four precisions with the documented invariants', async () => {
        const { TaskService } = await import('@todolist/core');
        const uow = await make();
        const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
        const service = new TaskService({
          uow,
          clock: { now: () => NOW },
          ids: new CryptoIdGenerator(),
        });
        const created = await service.createInbox('写周报', list.id);

        const day = await service.schedule(created.id, { kind: 'day', date: DATE });
        expect(day).toMatchObject({
          dueAt: startOfDay(DATE),
          dueDate: DATE,
          allDay: true,
          duePeriod: null,
        });

        const period = await service.schedule(created.id, {
          kind: 'period',
          date: DATE,
          period: 'morning',
        });
        expect(period).toMatchObject({
          dueAt: startOfDay(DATE),
          dueDate: DATE,
          allDay: true,
          duePeriod: 'morning',
        });

        const timed = await service.schedule(created.id, {
          kind: 'time',
          date: DATE,
          time: '14:30',
        });
        expect(timed.dueAt).toBe(instantAtLocal(DATE, '14:30'));
        expect(timed.dueDate).toBe(DATE);
        expect(timed.allDay).toBe(false);
        expect(timed.duePeriod).toBeNull();

        // A half-day must not survive into an exact-time task, and vice versa.
        const backToPeriod = await service.schedule(created.id, {
          kind: 'period',
          date: DATE,
          period: 'evening',
        });
        expect(backToPeriod.allDay).toBe(true);
        expect(backToPeriod.duePeriod).toBe('evening');

        const none = await service.schedule(created.id, { kind: 'none' });
        expect(none).toMatchObject({
          dueAt: null,
          dueDate: null,
          allDay: false,
          duePeriod: null,
        });

        // Everything asserted above also holds on a fresh read, not just in
        // the object the service returned.
        const reread = await uow.tasks.get(created.id);
        expect(reread).toMatchObject({ dueAt: null, dueDate: null, allDay: false, duePeriod: null });
      });

      it('persists every period value', async () => {
        const { TaskService } = await import('@todolist/core');
        const uow = await make();
        const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
        const service = new TaskService({
          uow,
          clock: { now: () => NOW },
          ids: new CryptoIdGenerator(),
        });
        const created = await service.createInbox('写周报', list.id);

        for (const period of ['morning', 'afternoon', 'evening'] satisfies DuePeriod[]) {
          await service.schedule(created.id, { kind: 'period', date: DATE, period });
          expect((await uow.tasks.get(created.id))?.duePeriod).toBe(period);
        }
      });

      it('the spawned next occurrence keeps the period', async () => {
        // Completing detaches the next occurrence as a new row; only the date
        // moves, so the bucket rides along — "every Monday morning" stays a
        // morning when completed.
        const { TaskService } = await import('@todolist/core');
        const uow = await make();
        const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, NOW);
        const service = new TaskService({
          uow,
          clock: { now: () => NOW },
          ids: new CryptoIdGenerator(),
        });
        const created = await service.createInbox('每周一晨会', list.id);
        await service.schedule(created.id, { kind: 'period', date: NOW.slice(0, 10) as LocalDate, period: 'morning' });
        await service.setRecurrence(created.id, { frequency: 'daily', interval: 1 });

        const { task: completed, next } = await service.toggleDone(created.id);
        expect(completed.status).toBe('done');
        expect(completed.duePeriod).toBe('morning');
        expect(completed.allDay).toBe(true);
        expect(next).not.toBeNull();
        expect(dateOf(next!)).not.toBe(NOW.slice(0, 10));
        expect(next!.duePeriod).toBe('morning');
        expect(next!.allDay).toBe(true);
      });
    });
  }
});

/** The task's dueDate, which the detach must have moved on the spawned row. */
function dateOf(task: Task): string | null {
  return task.dueDate;
}
