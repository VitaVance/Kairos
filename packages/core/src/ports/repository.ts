import type {
  CalendarEvent,
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
} from '../domain/types.js';

/**
 * Ports (interfaces) the domain needs from the outside world.
 *
 * The core layer declares these; adapters (SQLite, Tauri, in-memory, a remote
 * API later) implement them. Nothing in core may import an adapter — that is
 * the whole point: swap storage without touching business rules.
 */

export interface TaskRepository {
  list(filter?: { listId?: ListId; status?: Task['status'] }): Promise<readonly Task[]>;
  get(id: TaskId): Promise<Task | null>;
  create(input: NewTask, now: Instant): Promise<Task>;
  /**
   * Inserts a task verbatim, id included. Restore/import only — the id is
   * supplied by the caller, which is why it cannot reuse `create`.
   */
  restore(task: Task): Promise<Task>;
  update(id: TaskId, patch: TaskPatch, now: Instant): Promise<Task>;
  remove(id: TaskId): Promise<void>;
}

export interface ListRepository {
  list(): Promise<readonly TaskList[]>;
  get(id: ListId): Promise<TaskList | null>;
  create(input: NewList, now: Instant): Promise<TaskList>;
  restore(list: TaskList): Promise<TaskList>;
  update(id: ListId, patch: Partial<Omit<TaskList, 'id' | 'createdAt'>>, now: Instant): Promise<TaskList>;
  remove(id: ListId): Promise<void>;
}

export interface EventRepository {
  list(filter?: { from?: Instant; to?: Instant }): Promise<readonly CalendarEvent[]>;
  get(id: EventId): Promise<CalendarEvent | null>;
  create(input: NewEvent, now: Instant): Promise<CalendarEvent>;
  restore(event: CalendarEvent): Promise<CalendarEvent>;
  update(id: EventId, patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>, now: Instant): Promise<CalendarEvent>;
  remove(id: EventId): Promise<void>;
}

/** All persistence the app needs, grouped so a single adapter can satisfy it. */
export interface UnitOfWork {
  readonly tasks: TaskRepository;
  readonly lists: ListRepository;
  readonly events: EventRepository;
}

/** Injected clock — makes time-dependent rules testable. */
export interface Clock {
  now(): Instant;
}

/** Injected id source — keeps ids deterministic in tests. */
export interface IdGenerator {
  task(): TaskId;
  list(): ListId;
  event(): EventId;
}
