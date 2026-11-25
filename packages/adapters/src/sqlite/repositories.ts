import type {
  CalendarEvent,
  EventId,
  EventRepository,
  Instant,
  ListId,
  ListRepository,
  NewEvent,
  NewList,
  NewTask,
  Task,
  TaskId,
  TaskList,
  TaskPatch,
  TaskRepository,
} from '@todolist/core';
import type { IdGenerator } from '@todolist/core';
import { EntityNotFoundError, InvalidEntityError } from '../errors.js';
import {
  EVENT_FIELD_COLUMNS,
  EVENT_PATCH_FIELDS,
  LIST_FIELD_COLUMNS,
  LIST_PATCH_FIELDS,
  TASK_FIELD_COLUMNS,
  TASK_PATCH_FIELDS,
  buildAssignments,
  encodeTaskFieldValue,
} from '../fields.js';
import type { SqlDriver } from '../sql-driver.js';
import {
  eventToRow,
  listToRow,
  rowToEvent,
  rowToList,
  rowToTask,
  taskToRow,
} from './mapping.js';
import type { EventRow, ListRow, TaskRow } from './mapping.js';

/**
 * SQLite-backed repositories over the platform-neutral `SqlDriver`.
 *
 * Conventions enforced here:
 * - Every value is a `?` parameter; only allowlisted column names reach the
 *   SQL string.
 * - `createdAt`/`updatedAt` come from the caller-supplied `now`, never from
 *   the adapter's wall clock.
 * - `get` returns `null` on a miss; `update` throws `EntityNotFoundError`.
 * - `remove` is idempotent (SQL DELETE of a missing row is a no-op), matching
 *   the in-memory adapter and the core reference harness.
 * - `update` re-reads after writing, so the returned object reflects exactly
 *   what is stored.
 */

function insertSql(table: string, row: Readonly<Record<string, unknown>>): string {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}

function insertValues(row: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Object.keys(row).map((column) => row[column]);
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(
    private readonly driver: SqlDriver,
    private readonly ids: IdGenerator,
  ) {}

  async list(filter?: { listId?: ListId; status?: Task['status'] }): Promise<readonly Task[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.listId !== undefined) {
      where.push('list_id = ?');
      params.push(filter.listId);
    }
    if (filter?.status !== undefined) {
      where.push('status = ?');
      params.push(filter.status);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = await this.driver.query<TaskRow>(
      `SELECT * FROM tasks${clause} ORDER BY created_at ASC`,
      params,
    );
    return rows.map(rowToTask);
  }

  async get(id: TaskId): Promise<Task | null> {
    const rows = await this.driver.query<TaskRow>(
      'SELECT * FROM tasks WHERE id = ? LIMIT 1',
      [id],
    );
    const row = rows[0];
    return row ? rowToTask(row) : null;
  }

  async create(input: NewTask, now: Instant): Promise<Task> {
    if (input.listId === undefined) {
      throw new InvalidEntityError('task', 'listId is required');
    }
    const task: Task = {
      id: this.ids.task(),
      listId: input.listId,
      title: input.title,
      notes: input.notes ?? '',
      status: 'open',
      important: input.important ?? false,
      urgent: input.urgent ?? false,
      dueAt: input.dueAt ?? null,
      dueDate: input.dueDate ?? null,
      allDay: input.allDay ?? false,
      duePeriod: input.duePeriod ?? null,
      recurrence: input.recurrence ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const row = taskToRow(task);
    await this.driver.execute(insertSql('tasks', row), insertValues(row));
    return task;
  }

  async restore(task: Task): Promise<Task> {
    const row = taskToRow(task);
    await this.driver.execute(insertSql('tasks', row), insertValues(row));
    return task;
  }

  async update(id: TaskId, patch: TaskPatch, now: Instant): Promise<Task> {
    const { set, values } = buildAssignments(
      TASK_PATCH_FIELDS,
      TASK_FIELD_COLUMNS,
      patch as Readonly<Record<string, unknown>>,
      encodeTaskFieldValue,
    );

    // An empty patch is a deliberate no-op: no UPDATE, no updatedAt bump.
    if (set.length === 0) {
      const current = await this.get(id);
      if (!current) throw new EntityNotFoundError('task', id, 'update');
      return current;
    }

    await this.driver.execute(
      `UPDATE tasks SET ${set.join(', ')}, updated_at = ? WHERE id = ?`,
      [...values, now, id],
    );

    const updated = await this.get(id);
    if (!updated) throw new EntityNotFoundError('task', id, 'update');
    return updated;
  }

  async remove(id: TaskId): Promise<void> {
    await this.driver.execute('DELETE FROM tasks WHERE id = ?', [id]);
  }
}

export class SqliteListRepository implements ListRepository {
  constructor(
    private readonly driver: SqlDriver,
    private readonly ids: IdGenerator,
  ) {}

  async list(): Promise<readonly TaskList[]> {
    const rows = await this.driver.query<ListRow>(
      'SELECT * FROM lists ORDER BY "order" ASC, created_at ASC',
    );
    return rows.map(rowToList);
  }

  async get(id: ListId): Promise<TaskList | null> {
    const rows = await this.driver.query<ListRow>(
      'SELECT * FROM lists WHERE id = ? LIMIT 1',
      [id],
    );
    const row = rows[0];
    return row ? rowToList(row) : null;
  }

  async create(input: NewList, now: Instant): Promise<TaskList> {
    const list: TaskList = {
      id: this.ids.list(),
      name: input.name,
      color: input.color,
      order: input.order ?? (await this.nextOrder()),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const row = listToRow(list);
    await this.driver.execute(insertSql('lists', row), insertValues(row));
    return list;
  }

  async restore(list: TaskList): Promise<TaskList> {
    const row = listToRow(list);
    await this.driver.execute(insertSql('lists', row), insertValues(row));
    return list;
  }

  async update(
    id: ListId,
    patch: Partial<Omit<TaskList, 'id' | 'createdAt'>>,
    now: Instant,
  ): Promise<TaskList> {
    const { set, values } = buildAssignments(
      LIST_PATCH_FIELDS,
      LIST_FIELD_COLUMNS,
      patch as Readonly<Record<string, unknown>>,
    );

    if (set.length === 0) {
      const current = await this.get(id);
      if (!current) throw new EntityNotFoundError('list', id, 'update');
      return current;
    }

    await this.driver.execute(
      `UPDATE lists SET ${set.join(', ')}, updated_at = ? WHERE id = ?`,
      [...values, now, id],
    );

    const updated = await this.get(id);
    if (!updated) throw new EntityNotFoundError('list', id, 'update');
    return updated;
  }

  async remove(id: ListId): Promise<void> {
    await this.driver.execute('DELETE FROM lists WHERE id = ?', [id]);
  }

  private async nextOrder(): Promise<number> {
    const rows = await this.driver.query<{ next: unknown }>(
      'SELECT COALESCE(MAX("order"), -1) + 1 AS next FROM lists',
    );
    const next = rows[0]?.next;
    return typeof next === 'number' && Number.isFinite(next) ? next : 0;
  }
}

export class SqliteEventRepository implements EventRepository {
  constructor(
    private readonly driver: SqlDriver,
    private readonly ids: IdGenerator,
  ) {}

  async list(filter?: { from?: Instant; to?: Instant }): Promise<readonly CalendarEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    // Half-open overlap window: [from, to).
    if (filter?.from !== undefined) {
      where.push('end_at > ?');
      params.push(filter.from);
    }
    if (filter?.to !== undefined) {
      where.push('start_at < ?');
      params.push(filter.to);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = await this.driver.query<EventRow>(
      `SELECT * FROM events${clause} ORDER BY start_at ASC`,
      params,
    );
    return rows.map(rowToEvent);
  }

  async get(id: EventId): Promise<CalendarEvent | null> {
    const rows = await this.driver.query<EventRow>(
      'SELECT * FROM events WHERE id = ? LIMIT 1',
      [id],
    );
    const row = rows[0];
    return row ? rowToEvent(row) : null;
  }

  async create(input: NewEvent, now: Instant): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: this.ids.event(),
      listId: input.listId ?? null,
      title: input.title,
      notes: input.notes ?? '',
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const row = eventToRow(event);
    await this.driver.execute(insertSql('events', row), insertValues(row));
    return event;
  }

  async restore(event: CalendarEvent): Promise<CalendarEvent> {
    const row = eventToRow(event);
    await this.driver.execute(insertSql('events', row), insertValues(row));
    return event;
  }

  async update(
    id: EventId,
    patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>,
    now: Instant,
  ): Promise<CalendarEvent> {
    const { set, values } = buildAssignments(
      EVENT_PATCH_FIELDS,
      EVENT_FIELD_COLUMNS,
      patch as Readonly<Record<string, unknown>>,
    );

    if (set.length === 0) {
      const current = await this.get(id);
      if (!current) throw new EntityNotFoundError('event', id, 'update');
      return current;
    }

    await this.driver.execute(
      `UPDATE events SET ${set.join(', ')}, updated_at = ? WHERE id = ?`,
      [...values, now, id],
    );

    const updated = await this.get(id);
    if (!updated) throw new EntityNotFoundError('event', id, 'update');
    return updated;
  }

  async remove(id: EventId): Promise<void> {
    await this.driver.execute('DELETE FROM events WHERE id = ?', [id]);
  }
}
