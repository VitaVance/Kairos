import { compareTasks, quadrantOf } from '../domain/task.js';
import type { Recurrence } from '../domain/recurrence.js';
import { isValidRecurrence, nextOccurrence } from '../domain/recurrence.js';
import type {
  DuePeriod,
  Instant,
  ListId,
  LocalDate,
  NewTask,
  Quadrant,
  Task,
  TaskId,
  TaskPatch,
} from '../domain/types.js';
import type { Clock, IdGenerator, UnitOfWork } from '../ports/repository.js';
import { endOfDay, instantAtLocal, localDateOf, startOfDay } from '../shared/date.js';

/**
 * The four mutually exclusive ways a task can be scheduled.
 *
 * This replaced `schedule(id, dueAt, dueDate, allDay)`, which forced every
 * caller to invent a midnight instant for a day-precision task and left
 * `(allDay, duePeriod)` as two parameters nothing stopped from contradicting
 * each other. As a union, "a period with an exact time" is not a state the
 * type system will let anyone express.
 *
 * `time` carries "HH:MM" rather than an `Instant`: the service already needs
 * the local `date` to write `dueDate`, and accepting an instant would let a
 * caller pass one on a different day, silently producing an entry whose
 * `dueDate` and `dueAt` disagree. One conversion, in one place, from the two
 * fields that actually define it.
 */
export type TaskSchedule =
  | { readonly kind: 'none' }
  | { readonly kind: 'day'; readonly date: LocalDate }
  | { readonly kind: 'period'; readonly date: LocalDate; readonly period: DuePeriod }
  | { readonly kind: 'time'; readonly date: LocalDate; readonly time: string };

export interface TaskServiceDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Use cases for tasks. One reason to change: task-related business rules.
 * Storage lives behind `uow`; time behind `clock`; identity behind `ids`.
 */
export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  async listAll(): Promise<readonly Task[]> {
    return [...(await this.deps.uow.tasks.list())].sort(compareTasks);
  }

  async listByQuadrant(quadrant: Quadrant): Promise<readonly Task[]> {
    return (await this.listAll()).filter((t) => quadrantOf(t) === quadrant);
  }

  async createInbox(title: string, listId: ListId): Promise<Task> {
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new TaskValidationError('任务标题不能为空');
    const input: NewTask = {
      title: trimmed,
      listId,
      notes: '',
      important: false,
      urgent: false,
      dueAt: null,
      dueDate: null,
      allDay: false,
      duePeriod: null,
      recurrence: null,
    };
    const task = await this.deps.uow.tasks.create(input, this.deps.clock.now());
    await this.ensureListExists(listId);
    return task;
  }

  async toggleDone(id: TaskId): Promise<Task> {
    const task = await this.require(id);
    const now = this.deps.clock.now();
    if (task.status === 'open') {
      // Recurring tasks roll forward instead of being marked done: completing
      // the occurrence advances dueDate/dueAt to the next one. A rule that is
      // exhausted or malformed falls back to a normal completion.
      if (task.recurrence !== null && isValidRecurrence(task.recurrence)) {
        const rolled = rollForward(task, now);
        if (rolled !== null) return this.deps.uow.tasks.update(id, rolled, now);
      }
      return this.deps.uow.tasks.update(id, { status: 'done', completedAt: now }, now);
    }
    return this.deps.uow.tasks.update(id, { status: 'open', completedAt: null }, now);
  }

  /** Moving a task between quadrants flips its two boolean axes. */
  async moveToQuadrant(id: TaskId, quadrant: Quadrant): Promise<Task> {
    await this.require(id);
    const now = this.deps.clock.now();
    const patch: TaskPatch = {
      important: quadrant === 'urgent-important' || quadrant === 'not-urgent-important',
      urgent: quadrant === 'urgent-important' || quadrant === 'urgent-not-important',
    };
    return this.deps.uow.tasks.update(id, patch, now);
  }

  /**
   * Set a task's scheduling to one of the four precisions.
   *
   * The patch shape encodes the cross-column invariants that SQLite's
   * `ADD COLUMN` could not enforce against existing rows (design doc §3.1):
   *   - `period` ⇒ `allDay: true` and a non-null `dueDate`
   *   - `day`    ⇒ `allDay: true`, `dueAt = startOfDay(date)`, no period
   *   - `time`   ⇒ `allDay: false`, no period
   * Every branch below is constructed as a whole, so a patch can never carry
   * half of one precision and half of another.
   */
  async schedule(id: TaskId, schedule: TaskSchedule): Promise<Task> {
    await this.require(id);
    return this.deps.uow.tasks.update(id, patchForSchedule(schedule), this.deps.clock.now());
  }

  async rename(id: TaskId, title: string): Promise<Task> {
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new TaskValidationError('任务标题不能为空');
    await this.require(id);
    return this.deps.uow.tasks.update(id, { title: trimmed }, this.deps.clock.now());
  }

  /** Free-form notes shown in the task detail panel. */
  async updateNotes(id: TaskId, notes: string): Promise<Task> {
    await this.require(id);
    return this.deps.uow.tasks.update(id, { notes }, this.deps.clock.now());
  }

  /** Move a task to a different list, keeping its other fields. */
  async moveToList(id: TaskId, listId: ListId): Promise<Task> {
    await this.require(id);
    await this.ensureListExists(listId);
    return this.deps.uow.tasks.update(id, { listId }, this.deps.clock.now());
  }

  /** Clear a task's scheduling, returning it to the inbox. */
  async unschedule(id: TaskId): Promise<Task> {
    await this.require(id);
    return this.deps.uow.tasks.update(
      id,
      { dueAt: null, dueDate: null, allDay: false, duePeriod: null },
      this.deps.clock.now(),
    );
  }

  /**
   * Set or clear how a task repeats. Rejects a structurally invalid rule so a
   * typo cannot reach storage; `null` turns repetition off.
   */
  async setRecurrence(id: TaskId, recurrence: Recurrence | null): Promise<Task> {
    if (recurrence !== null && !isValidRecurrence(recurrence)) {
      throw new TaskValidationError('重复规则无效');
    }
    await this.require(id);
    return this.deps.uow.tasks.update(id, { recurrence }, this.deps.clock.now());
  }

  async remove(id: TaskId): Promise<void> {
    await this.require(id);
    await this.deps.uow.tasks.remove(id);
  }

  private async require(id: TaskId): Promise<Task> {
    const task = await this.deps.uow.tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

  private async ensureListExists(listId: ListId): Promise<void> {
    const list = await this.deps.uow.lists.get(listId);
    if (!list) throw new TaskValidationError(`清单不存在: ${listId}`);
  }
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

/**
 * Translate the union into a storage patch. Kept out of the class so the
 * mapping is testable as a pure function and has exactly one definition.
 *
 * `instantAtLocal` throws on a malformed "HH:MM"; that surfaces as a rejected
 * promise from `schedule()`, which is the behaviour a bad UI value should get.
 */
function patchForSchedule(schedule: TaskSchedule): TaskPatch {
  switch (schedule.kind) {
    case 'none':
      return { dueAt: null, dueDate: null, allDay: false, duePeriod: null };
    case 'day':
      return {
        dueAt: startOfDay(schedule.date),
        dueDate: schedule.date,
        allDay: true,
        duePeriod: null,
      };
    case 'period':
      // A half-day is not an instant: `dueAt` is still local midnight, the
      // same value a day task stores. Nothing reads it as the deadline —
      // `isOverdue`/the calendar use `duePeriod` and the day boundary.
      return {
        dueAt: startOfDay(schedule.date),
        dueDate: schedule.date,
        allDay: true,
        duePeriod: schedule.period,
      };
    case 'time':
      return {
        dueAt: instantAtLocal(schedule.date, schedule.time),
        dueDate: schedule.date,
        allDay: false,
        duePeriod: null,
      };
  }
}

/** Safety valve: how many occurrences a single completion may skip over. */
const MAX_ROLL_STEPS = 1000;

/**
 * Build the patch that advances a recurring task past the occurrence being
 * completed. Returns `null` when the series has ended (or the rule produced
 * nothing usable), in which case the caller completes the task normally.
 *
 * A task is late by months, so "next occurrence" keeps stepping until the
 * result is at or after today — without that, completing an overdue daily
 * task would leave it immediately overdue again. The step count is bounded so
 * a pathological rule can never spin.
 *
 * `dueDate` moves to the new local day; `dueAt` keeps its wall-clock time.
 * The offset is computed with `startOfDay` on both sides, so a DST transition
 * between the two days does not shift the time.
 */
function rollForward(task: Task, now: Instant): TaskPatch | null {
  const current =
    task.dueDate ?? (task.dueAt !== null ? localDateOf(task.dueAt) : localDateOf(now));

  // Anchor on today so a missed series catches up in one completion.
  const next = stepOccurrence(task.recurrence!, current, localDateOf(now));
  if (next === null) return null;

  return { dueDate: next, dueAt: shiftInstantToDate(task, current, next) };
}

/**
 * Walk the rule from `from` until the candidate is on/after `floor`.
 * `nextOccurrence` is already monotonic; the loop only exists to skip
 * occurrences that are now in the past.
 */
function stepOccurrence(
  rule: Recurrence,
  from: LocalDate,
  floor: LocalDate,
): LocalDate | null {
  let cursor = from;
  let candidate = nextOccurrence(rule, cursor);
  for (let steps = 0; candidate !== null && steps < MAX_ROLL_STEPS; steps++) {
    if (candidate >= floor) return candidate;
    cursor = candidate;
    candidate = nextOccurrence(rule, cursor);
  }
  return null;
}

/**
 * Move an instant to the same local wall-clock time on `to`, given it started
 * on `from`. All-day tasks are pinned to local midnight.
 */
function shiftInstantToDate(task: Task, from: LocalDate, to: LocalDate): Instant | null {
  if (task.dueAt === null) return null;
  if (task.allDay) return startOfDay(to);
  const offsetMs = Date.parse(task.dueAt) - Date.parse(startOfDay(from));
  const dayEnd = endOfDay(to);
  const shifted = Date.parse(startOfDay(to)) + offsetMs;
  // Clamp into the target day (e.g. 09:00 stays 09:00; an impossible offset
  // such as one born from a DST gap cannot land on the following day).
  const end = Date.parse(dayEnd);
  return new Date(shifted >= end ? end - 1 : shifted).toISOString() as Instant;
}

export class TaskNotFoundError extends Error {
  constructor(readonly id: TaskId) {
    super(`任务不存在: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}
