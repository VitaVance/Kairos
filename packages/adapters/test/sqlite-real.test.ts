import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoIdGenerator } from '../src/system/CryptoIdGenerator.js';
import { migrate } from '../src/sqlite/schema.js';
import { SqliteUnitOfWork } from '../src/sqlite/SqliteUnitOfWork.js';
import type { SqlDriver } from '../src/sql-driver.js';
import type { NewList, Recurrence, Task } from '@todolist/core';

/**
 * Integration tests against a REAL SQLite engine (Node 25's `node:sqlite`).
 *
 * Why this file exists: the other SQLite tests use `RecordingSqlDriver`, which
 * only inspects generated SQL as text. That cannot catch a statement SQLite
 * itself rejects — e.g. the unquoted `order` keyword which broke the packaged
 * app with `near "order": syntax error` while every unit test stayed green.
 */
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

const NOW = '2026-09-06T02:00:00.000Z' as never;

describe('SQLite against a real engine', () => {
  let uow: SqliteUnitOfWork;
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = realDriver();
    await migrate(driver);
    uow = new SqliteUnitOfWork(driver, new CryptoIdGenerator());
  });

  it('migrate is idempotent', async () => {
    await expect(migrate(driver)).resolves.toBeUndefined();
  });

  it('creates, reads and updates a list (the `order` keyword path)', async () => {
    const created = await uow.lists.create({ name: '收集箱', color: '#dd7366' } as NewList, NOW);
    expect(created.order).toBe(0);

    const read = await uow.lists.get(created.id);
    expect(read?.name).toBe('收集箱');
    expect(read?.order).toBe(0);

    // Explicitly exercise the UPDATE ... SET "order" = ? path.
    const updated = await uow.lists.update(created.id, { order: 5 } as never, NOW);
    expect(updated.order).toBe(5);

    const all = await uow.lists.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.order).toBe(5);
  });

  it('round-trips a task including nulls and booleans', async () => {
    const list = await uow.lists.create({ name: '工作', color: '#5b8def' } as NewList, NOW);
    const task = await uow.tasks.create(
      {
        title: '写周报',
        listId: list.id,
        notes: '',
        important: true,
        urgent: false,
        dueAt: null,
        dueDate: null,
        allDay: false,
      } as never,
      NOW,
    );

    const read = await uow.tasks.get(task.id);
    expect(read?.title).toBe('写周报');
    expect(read?.important).toBe(true);
    expect(read?.urgent).toBe(false);
    expect(read?.dueAt).toBeNull();
  });

  it('filters tasks by list and status', async () => {
    const a = await uow.lists.create({ name: 'A', color: '#5b8def' } as NewList, NOW);
    const b = await uow.lists.create({ name: 'B', color: '#d99a3d' } as NewList, NOW);
    const t1 = await uow.tasks.create({ title: 't1', listId: a.id } as never, NOW);
    await uow.tasks.create({ title: 't2', listId: b.id } as never, NOW);
    await uow.tasks.update(t1.id, { status: 'done' } as never, NOW);

    expect((await uow.tasks.list({ listId: a.id })).length).toBe(1);
    expect((await uow.tasks.list({ status: 'done' })).length).toBe(1);
    expect((await uow.tasks.list({ status: 'open' })).length).toBe(1);
  });

  it('round-trips an event and filters by range', async () => {
    const event = await uow.events.create(
      {
        title: '线上会议',
        startAt: '2026-09-06T08:00:00.000Z',
        endAt: '2026-09-06T10:00:00.000Z',
      } as never,
      NOW,
    );
    const found = await uow.events.list({
      from: '2026-09-06T00:00:00.000Z' as never,
      to: '2026-09-07T00:00:00.000Z' as never,
    });
    expect(found.map((e) => e.id)).toContain(event.id);
  });

  it('restore inserts with a caller-supplied id', async () => {
    const list = await uow.lists.create({ name: 'L', color: '#5b8def' } as NewList, NOW);
    await uow.lists.restore({ ...list, id: 'fixed-id' as never });
    expect(await uow.lists.get('fixed-id' as never)).not.toBeNull();
  });

  it('removes a list that holds no tasks', async () => {
    const list = await uow.lists.create({ name: '空清单', color: '#5b8def' } as NewList, NOW);
    await uow.lists.remove(list.id);
    expect(await uow.lists.get(list.id)).toBeNull();
  });

  describe('recurrence (schema v2)', () => {
    const weekly: Recurrence = { frequency: 'weekly', interval: 2, weekdays: [0, 2], until: null };

    async function makeTask(overrides: Partial<Task> = {}): Promise<Task> {
      const list = await uow.lists.create({ name: '重复', color: '#5b8def' } as NewList, NOW);
      const task = await uow.tasks.create(
        { title: '重复任务', listId: list.id } as never,
        NOW,
      );
      if (Object.keys(overrides).length > 0) {
        return uow.tasks.update(task.id, overrides, NOW);
      }
      return task;
    }

    it('adds the column on an existing v1 database without losing rows', async () => {
      // Build a v1-only database by hand: migration 1's DDL exactly, with the
      // schema_version already recorded as 1. That is what a shipped v1 install
      // looks like on disk.
      const legacy = realDriver();
      await legacy.execute('PRAGMA foreign_keys = ON');
      await legacy.execute(
        `CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`,
      );
      await legacy.execute(
        `CREATE TABLE lists (
          id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
          "order" INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`,
      );
      await legacy.execute(
        `CREATE TABLE tasks (
          id TEXT PRIMARY KEY NOT NULL, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
          important INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
          due_at TEXT, due_date TEXT,
          all_day INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`,
      );
      await legacy.execute(`INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-01-01')`);
      await legacy.execute(
        `INSERT INTO lists (id, name, color, "order", archived, created_at, updated_at)
         VALUES ('legacy-list', '旧清单', '#123456', 0, 0, ?, ?)`,
        [NOW, NOW],
      );
      await legacy.execute(
        `INSERT INTO tasks (id, list_id, title, notes, status, important, urgent, all_day, created_at, updated_at)
         VALUES ('legacy-task', 'legacy-list', '旧任务', '', 'open', 0, 0, 0, ?, ?)`,
        [NOW, NOW],
      );

      // Apply the pending migrations.
      await migrate(legacy);

      const legacyUow = new SqliteUnitOfWork(legacy, new CryptoIdGenerator());
      const preserved = await legacyUow.tasks.get('legacy-task' as never);
      expect(preserved?.title).toBe('旧任务');
      // Every pre-existing row becomes "does not repeat".
      expect(preserved?.recurrence).toBeNull();

      // And the new column is writable.
      const updated = await legacyUow.tasks.update(
        'legacy-task' as never,
        { recurrence: weekly },
        NOW,
      );
      expect(updated.recurrence).toEqual(weekly);
    });

    it('round-trips a rule through create and read', async () => {
      const list = await uow.lists.create({ name: '重复', color: '#5b8def' } as NewList, NOW);
      const created = await uow.tasks.create(
        { title: '重复任务', listId: list.id, recurrence: weekly } as never,
        NOW,
      );
      expect(created.recurrence).toEqual(weekly);

      const read = await uow.tasks.get(created.id);
      expect(read?.recurrence).toEqual(weekly);
    });

    it('updates a rule and clears it with null', async () => {
      const task = await makeTask({ recurrence: weekly });

      const monthly = await uow.tasks.update(
        task.id,
        { recurrence: { frequency: 'monthly', interval: 1, monthDay: 15 } },
        NOW,
      );
      expect(monthly.recurrence).toEqual({
        frequency: 'monthly',
        interval: 1,
        monthDay: 15,
        // Decoded rules are canonical: `until` is always present, null = open.
        until: null,
      });

      const cleared = await uow.tasks.update(task.id, { recurrence: null }, NOW);
      expect(cleared.recurrence).toBeNull();
    });

    it('stores canonical JSON with a stable key order', async () => {
      const task = await makeTask();
      await uow.tasks.update(task.id, { recurrence: weekly }, NOW);

      const rows = await driver.query<{ recurrence: unknown }>(
        'SELECT recurrence FROM tasks WHERE id = ?',
        [task.id],
      );
      expect(rows[0]?.recurrence).toBe(
        '{"frequency":"weekly","interval":2,"weekdays":[0,2],"until":null}',
      );
    });

    it('decodes a corrupt row as "does not repeat" instead of throwing', async () => {
      const task = await makeTask();
      await driver.execute('UPDATE tasks SET recurrence = ? WHERE id = ?', ['{not json', task.id]);

      const read = await uow.tasks.get(task.id);
      expect(read).not.toBeNull();
      expect(read?.recurrence).toBeNull();
    });

    it('restore keeps a caller-supplied recurrence', async () => {
      const task = await makeTask();
      await uow.tasks.restore({ ...task, id: 'restored-task' as never, recurrence: weekly });
      expect((await uow.tasks.get('restored-task' as never))?.recurrence).toEqual(weekly);
    });
  });
});
