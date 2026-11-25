import { beforeEach, describe, expect, it } from 'vitest';
import type { Task, TaskId } from '@todolist/core';
import {
  EntityNotFoundError,
  RecordingSqlDriver,
  SqliteTaskRepository,
  SqliteUnitOfWork,
  encodeRecurrenceValue,
  migrate,
  migrations,
  taskToRow,
} from '../src/index.js';
import type { IdGenerator } from '@todolist/core';

const T0 = '2026-09-06T08:00:00.000Z';
const T1 = '2026-09-06T10:00:00.000Z';

const fixedIds: IdGenerator = {
  task: () => 'task-1' as TaskId,
  list: () => 'list-1' as never,
  event: () => 'event-1' as never,
};

/** A fully populated persisted task row, for read paths. */
function taskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    list_id: 'list-1',
    title: '制定营销策略',
    notes: '先做用户访谈',
    status: 'open',
    important: 1,
    urgent: 1,
    due_at: '2026-09-06T09:00:00.000Z',
    due_date: '2026-09-06',
    all_day: 0,
    recurrence: null,
    completed_at: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

describe('migrate', () => {
  it('emits CREATE TABLE for lists, tasks, events and schema_version', async () => {
    const driver = new RecordingSqlDriver();
    await migrate(driver);

    const creates = driver
      .sql()
      .filter((sql) => /^\s*CREATE TABLE/i.test(sql))
      .join('\n');

    expect(creates).toMatch(/CREATE TABLE IF NOT EXISTS lists/i);
    expect(creates).toMatch(/CREATE TABLE IF NOT EXISTS tasks/i);
    expect(creates).toMatch(/CREATE TABLE IF NOT EXISTS events/i);
    expect(creates).toMatch(/CREATE TABLE IF NOT EXISTS schema_version/i);
  });

  it('turns foreign_keys on', async () => {
    const driver = new RecordingSqlDriver();
    await migrate(driver);
    expect(driver.sql().some((sql) => /PRAGMA foreign_keys\s*=\s*ON/i.test(sql))).toBe(true);
  });

  it('is safe to call twice', async () => {
    const driver = new RecordingSqlDriver();
    await expect(migrate(driver)).resolves.toBeUndefined();
    await expect(migrate(driver)).resolves.toBeUndefined();
    // All DDL is IF NOT EXISTS, so re-running cannot fail on existing tables.
    for (const sql of driver.sql()) {
      if (/^\s*CREATE (TABLE|INDEX)/i.test(sql)) {
        expect(sql).toMatch(/IF NOT EXISTS/i);
      }
    }
  });

  it('does not re-apply migrations already recorded in schema_version', async () => {
    // First query in migrate() is the version lookup; report current = latest.
    const latest = migrations[migrations.length - 1]!.version;
    const driver = new RecordingSqlDriver([[{ version: latest }]]);
    await migrate(driver);
    const createTables = driver.sql().filter((sql) => /^\s*CREATE TABLE IF NOT EXISTS (lists|tasks|events)/i.test(sql));
    expect(createTables).toHaveLength(0);
    const inserts = driver.sql().filter((sql) => /INSERT INTO schema_version/i.test(sql));
    expect(inserts).toHaveLength(0);
  });

  it('upgrades a v1 database by appending only the newer migrations', async () => {
    const driver = new RecordingSqlDriver([[{ version: 1 }]]);
    await migrate(driver);

    // Only the newer migrations run; migration 1's DDL is untouched.
    const creates = driver.sql().filter((sql) => /^\s*CREATE TABLE IF NOT EXISTS (lists|tasks|events)/i.test(sql));
    expect(creates).toHaveLength(0);

    // Both pending ALTERs run, in version order, and neither edits v1/v2.
    const alters = driver.sql().filter((sql) => /ALTER TABLE tasks ADD COLUMN/i.test(sql));
    expect(alters).toHaveLength(2);
    expect(alters[0]).toMatch(/ALTER TABLE tasks ADD COLUMN recurrence TEXT/i);
    expect(alters[1]).toMatch(/ALTER TABLE tasks ADD COLUMN due_period TEXT/i);
    expect(alters[1]).toMatch(/CHECK \(due_period IS NULL OR due_period IN \('morning', 'afternoon', 'evening'\)\)/i);
    // No DEFAULT and no index: a nullable ADD COLUMN is a metadata-only change.
    expect(alters[1]).not.toMatch(/DEFAULT/i);

    const inserts = driver.find('INSERT INTO schema_version');
    expect(inserts.map((s) => s.params)).toEqual([[2], [3], [4]]);
  });
});

describe('SqliteTaskRepository — write SQL shape', () => {
  let driver: RecordingSqlDriver;
  let repo: SqliteTaskRepository;

  beforeEach(() => {
    driver = new RecordingSqlDriver();
    repo = new SqliteTaskRepository(driver, fixedIds);
  });

  it('create issues one INSERT with a ? placeholder per column and no values in SQL', async () => {
    const created = await repo.create(
      {
        title: '制定营销策略',
        listId: 'list-1' as never,
        notes: '先做用户访谈',
        important: true,
        urgent: true,
        dueAt: '2026-09-06T09:00:00.000Z' as never,
        dueDate: '2026-09-06' as never,
      },
      T0 as never,
    );

    expect(created.createdAt).toBe(T0);
    expect(created.updatedAt).toBe(T0);

    const insert = driver.find('INSERT INTO tasks');
    expect(insert).toHaveLength(1);
    const statement = insert[0]!;
    expect(statement.sql).toMatch(/^\s*INSERT INTO tasks \(/);

    // One placeholder per persisted column.
    const columnCount = statement.sql.slice(statement.sql.indexOf('(') + 1, statement.sql.indexOf(')')).split(',').length;
    const placeholders = statement.sql.slice(statement.sql.indexOf('VALUES')).match(/\?/g) ?? [];
    expect(placeholders).toHaveLength(columnCount);
    expect(statement.params).toHaveLength(columnCount);

    // No interpolated values: user data appears only in params, never in SQL.
    expect(statement.sql).not.toContain('制定营销策略');
    expect(statement.sql).not.toContain('先做用户访谈');
    expect(statement.sql).not.toContain('list-1');
    expect(statement.sql).not.toContain('2026-09-06');
    expect(statement.params).toContain('制定营销策略');
    expect(statement.params).toContain('先做用户访谈');
  });

  it('create encodes booleans as 0/1 params', async () => {
    await repo.create(
      { title: '任务', listId: 'list-1' as never, important: true, urgent: false },
      T0 as never,
    );
    const insert = driver.find('INSERT INTO tasks')[0]!;
    const row = taskToRow({
      id: 'x',
      listId: 'list-1',
      title: '任务',
      notes: '',
      status: 'open',
      important: true,
      urgent: false,
      dueAt: null,
      dueDate: null,
      allDay: false,
      recurrence: null,
      completedAt: null,
      createdAt: T0,
      updatedAt: T0,
    } as Task);
    expect(row.important).toBe(1);
    expect(row.urgent).toBe(0);
    expect(insert.params).toContain(1);
    expect(insert.params).toContain(0);
  });

  it('update({title}) sets only title + updated_at and re-reads the row', async () => {
    // queue the re-read that follows the UPDATE
    driver.queueRows([taskRow({ title: '改名后', updated_at: T1 })]);

    const updated = await repo.update('task-1' as TaskId, { title: '改名后' }, T1 as never);

    const update = driver.find('UPDATE tasks');
    expect(update).toHaveLength(1);
    const sql = update[0]!.sql;
    expect(sql).toMatch(/SET title = \?, updated_at = \? WHERE id = \?/);
    // Nothing else may be in the SET clause.
    expect(sql).not.toMatch(/\bnotes\s*=/);
    expect(sql).not.toMatch(/\bstatus\s*=/);
    expect(sql).not.toMatch(/\bimportant\s*=/);
    expect(update[0]!.params).toEqual(['改名后', T1, 'task-1']);

    // Re-read happened after the write.
    const selects = driver.find('SELECT * FROM tasks WHERE id');
    expect(selects).toHaveLength(1);
    expect(updated.title).toBe('改名后');
  });

  it('update with a multi-field patch sets exactly those columns', async () => {
    driver.queueRows([taskRow()]);
    await repo.update(
      'task-1' as TaskId,
      { status: 'done', completedAt: '2026-09-06T10:00:00.000Z' as never, important: false },
      T1 as never,
    );
    const sql = driver.find('UPDATE tasks')[0]!.sql;
    expect(sql).toMatch(/SET /);
    expect(sql).toContain('status = ?');
    expect(sql).toContain('completed_at = ?');
    expect(sql).toContain('important = ?');
    expect(sql).toContain('updated_at = ?');
    expect(sql).not.toContain('notes = ?');
    expect(sql).not.toContain('title = ?');
  });

  it('ignores unknown patch keys (allowlist)', async () => {
    driver.queueRows([taskRow()]);
    await repo.update('task-1' as TaskId, { title: 'ok', id: 'hacked', createdAt: 'x' } as never, T1 as never);
    const sql = driver.find('UPDATE tasks')[0]!.sql;
    const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    expect(setClause).toContain('title = ?');
    // `id`/`created_at` may only appear in the WHERE/identity position, never SET.
    expect(setClause).not.toMatch(/\bid\s*=/);
    expect(setClause).not.toMatch(/created_at\s*=/);
  });

  it('serializes a recurrence patch as canonical JSON in the parameter', async () => {
    driver.queueRows([taskRow()]);
    const rule = { frequency: 'weekly', interval: 1, weekdays: [4, 0], until: null } as const;
    await repo.update('task-1' as TaskId, { recurrence: rule }, T1 as never);

    const update = driver.find('UPDATE tasks')[0]!;
    expect(update.sql).toMatch(/recurrence = \?/);
    // Sorted weekdays, fixed key order, no values interpolated into SQL.
    expect(update.params).toEqual([
      '{"frequency":"weekly","interval":1,"weekdays":[0,4],"until":null}',
      T1,
      'task-1',
    ]);
    expect(update.sql).not.toContain('weekly');
  });

  it('encodes a null recurrence as a NULL parameter', async () => {
    driver.queueRows([taskRow()]);
    await repo.update('task-1' as TaskId, { recurrence: null }, T1 as never);
    expect(driver.find('UPDATE tasks')[0]!.params[0]).toBeNull();
  });

  it('includes recurrence in the created row', async () => {
    const created = await repo.create(
      { title: '重复', listId: 'list-1' as never, recurrence: { frequency: 'daily', interval: 1 } },
      T0 as never,
    );
    expect(created.recurrence).toEqual({ frequency: 'daily', interval: 1 });
    const insert = driver.find('INSERT INTO tasks')[0]!;
    expect(insert.sql).toContain('recurrence');
    expect(insert.params).toContain('{"frequency":"daily","interval":1,"until":null}');
  });

  it('re-encodes a decoded row back to the same canonical JSON', () => {
    const rule = { frequency: 'monthly', interval: 1, monthDay: 15 } as const;
    const row = taskToRow({
      id: 'task-1',
      listId: 'list-1',
      title: '每月',
      notes: '',
      status: 'open',
      important: false,
      urgent: false,
      dueAt: null,
      dueDate: null,
      allDay: false,
      recurrence: { ...rule, until: null },
      completedAt: null,
      createdAt: T0,
      updatedAt: T0,
    } as Task);
    expect(row.recurrence).toBe('{"frequency":"monthly","interval":1,"monthDay":15,"until":null}');
    expect(encodeRecurrenceValue(rule)).toBe(row.recurrence);
  });

  it('update with an empty patch is a no-op (no UPDATE issued)', async () => {
    driver.queueRows([taskRow()]);
    const result = await repo.update('task-1' as TaskId, {}, T1 as never);

    expect(driver.find('UPDATE')).toHaveLength(0);
    expect(result.id).toBe('task-1');
    // Only the existence read happened.
    expect(driver.statements.every((s) => s.kind === 'query')).toBe(true);
  });

  it('update throws EntityNotFoundError when the row is missing', async () => {
    // existence check (empty patch) path
    await expect(repo.update('missing' as TaskId, {}, T1 as never)).rejects.toBeInstanceOf(
      EntityNotFoundError,
    );

    // non-empty patch: UPDATE matches nothing and re-read returns no row
    const driver2 = new RecordingSqlDriver();
    const repo2 = new SqliteTaskRepository(driver2, fixedIds);
    await expect(
      repo2.update('missing' as TaskId, { title: 'x' }, T1 as never),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('get returns null on a miss', async () => {
    await expect(repo.get('missing' as TaskId)).resolves.toBeNull();
  });

  it('list applies listId/status as parameters through WHERE', async () => {
    await repo.list({ listId: 'list-1' as never, status: 'open' });
    const [statement] = driver.find('SELECT * FROM tasks');
    expect(statement!.sql).toMatch(/WHERE list_id = \? AND status = \?/);
    expect(statement!.params).toEqual(['list-1', 'open']);
  });

  it('remove deletes by parameter', async () => {
    await repo.remove('task-1' as TaskId);
    const del = driver.find('DELETE FROM tasks')[0]!;
    expect(del.sql).toMatch(/DELETE FROM tasks WHERE id = \?/);
    expect(del.params).toEqual(['task-1']);
  });

  it('maps a decoded row back to the domain shape', async () => {
    driver.queueRows([taskRow()]);
    const task = await repo.get('task-1' as TaskId);
    expect(task).toEqual({
      id: 'task-1',
      listId: 'list-1',
      title: '制定营销策略',
      notes: '先做用户访谈',
      status: 'open',
      important: true,
      urgent: true,
      dueAt: '2026-09-06T09:00:00.000Z',
      dueDate: '2026-09-06',
      allDay: false,
      duePeriod: null,
      recurrence: null,
      completedAt: null,
      createdAt: T0,
      updatedAt: T0,
    });
  });
});

describe('SqliteUnitOfWork', () => {
  it('exposes all three repositories over one driver', () => {
    const driver = new RecordingSqlDriver();
    const uow = new SqliteUnitOfWork(driver, fixedIds);
    expect(uow.tasks).toBeDefined();
    expect(uow.lists).toBeDefined();
    expect(uow.events).toBeDefined();
  });

  it('list create SQL uses ? placeholders and no interpolated values', async () => {
    const driver = new RecordingSqlDriver([
      [], // nextOrder lookup
    ]);
    const uow = new SqliteUnitOfWork(driver, fixedIds);
    await uow.lists.create({ name: '工作', color: '#5b8def' }, T0 as never);

    const insert = driver.find('INSERT INTO lists')[0]!;
    expect(insert.sql).not.toContain('工作');
    expect(insert.sql).not.toContain('#5b8def');
    expect(insert.params).toContain('工作');
    expect(insert.params).toContain('#5b8def');
    // archived defaults to false and encodes as 0.
    expect(insert.params).toContain(0);
  });

  it('event create issues parameterised INSERT', async () => {
    const driver = new RecordingSqlDriver();
    const uow = new SqliteUnitOfWork(driver, fixedIds);
    await uow.events.create(
      {
        title: '产品评审',
        startAt: '2026-09-06T13:00:00.000Z' as never,
        endAt: '2026-09-06T16:00:00.000Z' as never,
      },
      T0 as never,
    );
    const insert = driver.find('INSERT INTO events')[0]!;
    expect(insert.sql).not.toContain('产品评审');
    expect((insert.sql.match(/\?/g) ?? []).length).toBe(insert.params.length);
  });

  it('event update with empty patch is a no-op', async () => {
    const driver = new RecordingSqlDriver([[{ id: 'event-1', list_id: null, title: 'x', notes: '', start_at: T0, end_at: T1, all_day: 0, created_at: T0, updated_at: T0 }]]);
    const uow = new SqliteUnitOfWork(driver, fixedIds);
    const result = await uow.events.update('event-1' as never, {}, T1 as never);
    expect(driver.find('UPDATE')).toHaveLength(0);
    expect(result.title).toBe('x');
  });
});
