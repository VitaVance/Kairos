import type {
  CalendarEvent,
  Clock,
  EventId,
  Instant,
  ListId,
  NewEvent,
  NewList,
  NewTask,
  Task,
  TaskId,
  TaskList,
  TaskPatch,
  UnitOfWork,
} from '@todolist/core';
import { EntityNotFoundError, InvalidEntityError } from '../errors.js';
import {
  EVENT_PATCH_FIELDS,
  LIST_PATCH_FIELDS,
  TASK_PATCH_FIELDS,
} from '../fields.js';
import type { IdGenerator } from '@todolist/core';

/**
 * Full in-memory `UnitOfWork` for development and tests.
 *
 * Semantics intentionally mirror `SqliteUnitOfWork`:
 * - ids and timestamps come from injected `IdGenerator` / caller's `now`;
 * - `get` misses return `null`; `update` misses throw `EntityNotFoundError`;
 * - `update` skips `undefined` keys, an empty patch changes nothing (not even
 *   `updatedAt`), and the returned object is a fresh value;
 * - `remove` of a missing row is a no-op;
 * - `list` does no sorting — the core services own ordering.
 *
 * It is usable with no arguments (`new MemoryUnitOfWork()`), which is what the
 * desktop composition root does. Pass an `IdGenerator` for deterministic ids
 * in tests; the default is a timestamp + counter generator that is unique but
 * not stable across runs.
 */
export class MemoryUnitOfWork implements UnitOfWork {
  private readonly listRows: TaskList[] = [];
  private readonly taskRows: Task[] = [];
  private readonly eventRows: CalendarEvent[] = [];
  private readonly settingRows = new Map<string, string>();
  private readonly ids: IdGenerator;

  readonly tasks = {
    list: async (filter?: { listId?: ListId; status?: Task['status'] }): Promise<readonly Task[]> =>
      this.taskRows.filter(
        (task) =>
          (filter?.listId === undefined || task.listId === filter.listId) &&
          (filter?.status === undefined || task.status === filter.status),
      ),

    get: async (id: TaskId): Promise<Task | null> =>
      this.taskRows.find((task) => task.id === id) ?? null,

    create: async (input: NewTask, now: Instant): Promise<Task> => {
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
      this.taskRows.push(task);
      return task;
    },

    restore: async (task: Task): Promise<Task> => {
      this.taskRows.push(task);
      return task;
    },

    update: async (id: TaskId, patch: TaskPatch, now: Instant): Promise<Task> => {
      const index = this.taskRows.findIndex((task) => task.id === id);
      if (index < 0) throw new EntityNotFoundError('task', id, 'update');
      const current = this.taskRows[index]!;
      const next = applyPatch(current, patch, TASK_PATCH_FIELDS, now);
      this.taskRows[index] = next;
      return next;
    },

    remove: async (id: TaskId): Promise<void> => {
      const index = this.taskRows.findIndex((task) => task.id === id);
      if (index >= 0) this.taskRows.splice(index, 1);
    },
  };

  readonly lists = {
    // A copy, not the live array: callers iterate this while deleting, and
    // handing out internal mutable state makes that skip rows.
    list: async (): Promise<readonly TaskList[]> => [...this.listRows],

    get: async (id: ListId): Promise<TaskList | null> =>
      this.listRows.find((list) => list.id === id) ?? null,

    create: async (input: NewList, now: Instant): Promise<TaskList> => {
      const list: TaskList = {
        id: this.ids.list(),
        name: input.name,
        color: input.color,
        order: input.order ?? this.nextListOrder(),
        archived: false,
        systemKey: input.systemKey ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.listRows.push(list);
      return list;
    },

    restore: async (list: TaskList): Promise<TaskList> => {
      this.listRows.push(list);
      return list;
    },

    update: async (
      id: ListId,
      patch: Partial<Omit<TaskList, 'id' | 'createdAt'>>,
      now: Instant,
    ): Promise<TaskList> => {
      const index = this.listRows.findIndex((list) => list.id === id);
      if (index < 0) throw new EntityNotFoundError('list', id, 'update');
      const current = this.listRows[index]!;
      const next = applyPatch(current, patch, LIST_PATCH_FIELDS, now);
      this.listRows[index] = next;
      return next;
    },

    remove: async (id: ListId): Promise<void> => {
      const index = this.listRows.findIndex((list) => list.id === id);
      if (index >= 0) this.listRows.splice(index, 1);
    },
  };

  readonly events = {
    list: async (filter?: { from?: Instant; to?: Instant }): Promise<readonly CalendarEvent[]> =>
      this.eventRows.filter(
        (event) =>
          (filter?.from === undefined || Date.parse(event.endAt) > Date.parse(filter.from)) &&
          (filter?.to === undefined || Date.parse(event.startAt) < Date.parse(filter.to)),
      ),

    get: async (id: EventId): Promise<CalendarEvent | null> =>
      this.eventRows.find((event) => event.id === id) ?? null,

    create: async (input: NewEvent, now: Instant): Promise<CalendarEvent> => {
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
      this.eventRows.push(event);
      return event;
    },

    restore: async (event: CalendarEvent): Promise<CalendarEvent> => {
      this.eventRows.push(event);
      return event;
    },

    update: async (
      id: EventId,
      patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>,
      now: Instant,
    ): Promise<CalendarEvent> => {
      const index = this.eventRows.findIndex((event) => event.id === id);
      if (index < 0) throw new EntityNotFoundError('event', id, 'update');
      const current = this.eventRows[index]!;
      const next = applyPatch(current, patch, EVENT_PATCH_FIELDS, now);
      this.eventRows[index] = next;
      return next;
    },

    remove: async (id: EventId): Promise<void> => {
      const index = this.eventRows.findIndex((event) => event.id === id);
      if (index >= 0) this.eventRows.splice(index, 1);
    },
  };

  /**
   * App-level key/value store, mirroring the SQLite `settings` table. Not part
   * of `UnitOfWork`; `seedDemoData` / `resetAllData` narrow for it. In-memory
   * mode keeps it for the session, which is all that mode promises.
   */
  readonly settings = {
    get: async (key: string): Promise<string | null> => this.settingRows.get(key) ?? null,
    set: async (key: string, value: string): Promise<void> => {
      this.settingRows.set(key, value);
    },
  };

  constructor(ids?: IdGenerator, clock?: Clock) {
    this.ids = ids ?? new FallbackIdGenerator(clock);
  }

  private nextListOrder(): number {
    return this.listRows.reduce((max, list) => Math.max(max, list.order), -1) + 1;
  }
}

/**
 * Apply only provided + allowlisted keys. `undefined` means "absent", so an
 * empty patch returns the identical object and leaves `updatedAt` untouched.
 */
function applyPatch<T extends object>(
  current: T,
  patch: Readonly<Record<string, unknown>>,
  allowlist: readonly string[],
  now: Instant,
): T {
  const changes: Record<string, unknown> = {};
  let changed = false;
  for (const field of allowlist) {
    const value = patch[field];
    if (value === undefined) continue;
    changes[field] = value;
    changed = true;
  }
  if (!changed) return current;
  return { ...current, ...changes, updatedAt: now };
}

/**
 * Internal default so `new MemoryUnitOfWork()` works without wiring. Kept
 * dependency-free (no `crypto`) so it also runs in older runtimes.
 *
 * The counter is module-scoped, not per-instance, so two units of work created
 * in the same millisecond cannot mint the same id.
 */
let fallbackCounter = 0;

class FallbackIdGenerator implements IdGenerator {
  constructor(private readonly clock?: Clock) {}

  private next(prefix: string): string {
    fallbackCounter += 1;
    const stamp = this.clock?.now() ?? new Date().toISOString();
    return `${prefix}_${stamp.replace(/[^0-9]/g, '')}_${fallbackCounter.toString(36)}`;
  }

  task(): TaskId {
    return this.next('t') as TaskId;
  }
  list(): ListId {
    return this.next('l') as ListId;
  }
  event(): EventId {
    return this.next('e') as EventId;
  }
}
