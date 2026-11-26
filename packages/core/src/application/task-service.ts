import { compareTasks, daysFromToday, quadrantOf } from '../domain/task.js';
import type { Recurrence } from '../domain/recurrence.js';
import { isValidRecurrence, nextOccurrence, previousOccurrence } from '../domain/recurrence.js';
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
 * What one completion did.
 *
 * `task` is the row the caller toggled. `next` is the freshly created
 * occurrence when a recurring task was completed, and `null` for every other
 * case. The UI needs the spawned row's id to make undo exact: reversing a
 * recurring completion is "delete the next occurrence and reopen this one",
 * which is not `toggleDone` again.
 */
export interface ToggleDoneResult {
  readonly task: Task;
  readonly next: Task | null;
}

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

  /**
   * Complete or reopen a task.
   *
   * A recurring task is detached, not rolled: completing the current occurrence
   * marks *this row* done and creates a new open row for the next occurrence,
   * one period later. The old shape — advance `dueDate` on the same row and
   * leave it open — meant the completion control could never produce a tick, so
   * a click was indistinguishable from a no-op and repeated clicks walked the
   * date into the next decade. See `.handoff/recurring-completion.md`.
   *
   * The second row is the cost, and it is the honest one: the list history shows
   * "last Friday: done" and "next Friday: open" as two facts, which is exactly
   * what happened. In-place completion (done *and* future-dated on one row) was
   * rejected because a done row is read as history everywhere in the UI.
   *
   * Reopening closes the loop: a done recurring row reopens in place. The next
   * occurrence, if it exists, is a separate row and is left alone — undoing a
   * completion is the UI's job (`useTasks` deletes the row it created).
   */
  async toggleDone(id: TaskId): Promise<ToggleDoneResult> {
    const task = await this.require(id);
    const now = this.deps.clock.now();
    if (task.status === 'open') {
      // An undated task has no occurrence to advance from; it simply completes.
      if (
        task.dueDate !== null &&
        task.recurrence !== null &&
        isValidRecurrence(task.recurrence)
      ) {
        const nextDate = nextOccurrenceDate(task, now);
        if (nextDate !== null) {
          // Dedupe first: re-completing after an untick must not spawn a second
          // copy of the same occurrence. The row created the first time is still
          // open and is the series' next instance. Returning `next: null` also
          // keeps undo honest — it must not delete a row this completion did not
          // make. Checked before the status write so a no-op completion costs one
          // read instead of a needless update.
          if (await this.hasOpenOccurrence(task, nextDate)) {
            const done = await this.deps.uow.tasks.update(
              id,
              { status: 'done', completedAt: now },
              now,
            );
            return { task: done, next: null };
          }
          const done = await this.deps.uow.tasks.update(
            id,
            { status: 'done', completedAt: now },
            now,
          );
          const next = await this.deps.uow.tasks.create(seedNextOccurrence(task, nextDate), now);
          return { task: done, next };
        }
      }
      const done = await this.deps.uow.tasks.update(id, { status: 'done', completedAt: now }, now);
      return { task: done, next: null };
    }
    const reopened = await this.deps.uow.tasks.update(
      id,
      { status: 'open', completedAt: null },
      now,
    );
    return { task: reopened, next: null };
  }

  /**
   * One-time correction for the old click-to-roll bug.
   *
   * Before this fix, every completion of a recurring task advanced its due date
   * a period and left it open. A user who clicked repeatedly drove the date
   * arbitrarily far into the future (the reported row sat at 2027-05-14). Such a
   * date is corruption, not intent, so it is clamped to the nearest occurrence
   * of the task's own rule on or after today. Time of day is preserved.
   *
   * Safety rail: only a date at least `REPAIR_MIN_DRIFT_DAYS` past the rule's
   * next honest occurrence is touched, so a task the user deliberately pushed
   * out by a few weeks keeps its date. Idempotent — a repaired row no longer
   * drifts, and an overdue row (drift negative) is never repaired.
   *
   * Returns the rows that were rewritten, so the boot path can log/report them.
   */
  async repairRunawayRecurrences(today?: LocalDate): Promise<readonly Task[]> {
    const now = this.deps.clock.now();
    const floor = today ?? localDateOf(now);
    const repaired: Task[] = [];

    for (const task of await this.deps.uow.tasks.list()) {
      if (task.status !== 'open') continue;
      const rule = task.recurrence;
      if (rule === null || !isValidRecurrence(rule)) continue;
      if (task.dueDate === null) continue;
      // Only a future date can be runaway corruption: an overdue task is
      // ordinary lateness and its date is what the user last saw.
      if (task.dueDate <= floor) continue;

      // Walk the rule's own grid backwards from the stored date until it
      // crosses today. The last value still on/after today is the earliest
      // honest occurrence — this step ignores the corrupt value's distance,
      // so no amount of runaway clicks can survive it.
      const expected = walkBackToFloor(rule, task.dueDate, floor);
      if (expected === null) continue;
      if (rule.until != null && expected > rule.until) continue;
      if (daysBetween(expected, task.dueDate) < REPAIR_MIN_DRIFT_DAYS) continue;

      const shifted = shiftToDate(task, task.dueDate, expected);
      repaired.push(await this.deps.uow.tasks.update(task.id, shifted, now));
    }

    return repaired;
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

  /**
   * True when an open row already represents `date` in this task's series.
   *
   * Identity is (list, title, rule, due date): the fields the spawned row
   * copies verbatim. Two unrelated tasks that happen to match on all four are
   * indistinguishable as occurrences anyway, so treating one as the other is
   * harmless — and it is the only series identity available without a schema
   * change.
   */
  private async hasOpenOccurrence(task: Task, date: LocalDate): Promise<boolean> {
    return (await this.deps.uow.tasks.list()).some(
      (other) =>
        other.id !== task.id &&
        other.status === 'open' &&
        other.listId === task.listId &&
        other.title === task.title &&
        other.dueDate === date &&
        sameRecurrence(other.recurrence, task.recurrence),
    );
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

/**
 * How far past the rule's own next occurrence a stored date must sit before
 * the repair pass treats it as corruption. A user may deliberately push a
 * repeating task a few weeks out; nobody deliberately schedules a weekly
 * reminder two months ahead. Anything beyond this is the old bug's signature.
 */
const REPAIR_MIN_DRIFT_DAYS = 60;

/**
 * The local date the *next* occurrence belongs on.
 *
 * The stored date is an occurrence, so the next one is simply the following
 * step of the rule. But a series that is late (a week missed, a month of no
 * clicks) must catch up in ONE completion, or completing an overdue daily task
 * leaves it overdue again. So step until the result is on/after today.
 *
 * A future-dated task is never pulled backwards: the floor is the stored date
 * when it is later than today.
 */
function nextOccurrenceDate(task: Task, now: Instant): LocalDate | null {
  const today = localDateOf(now);
  const floor = task.dueDate !== null && task.dueDate > today ? task.dueDate : today;
  return stepOccurrence(task.recurrence!, task.dueDate!, floor);
}

/**
 * The new-row input for the occurrence after `task`. Everything the user said
 * about the task (list, notes, quadrant, precision, the rule itself) carries
 * over; only the date moves. `undefined` is not used here: the input is built
 * as a whole so a field can never be silently dropped.
 */
function seedNextOccurrence(task: Task, date: LocalDate): NewTask {
  const shifted = shiftToDate(task, task.dueDate ?? date, date);
  return {
    title: task.title,
    listId: task.listId,
    notes: task.notes,
    important: task.important,
    urgent: task.urgent,
    allDay: task.allDay,
    duePeriod: task.duePeriod,
    recurrence: task.recurrence,
    dueDate: shifted.dueDate ?? null,
    dueAt: shifted.dueAt ?? null,
  };
}

/**
 * Move a task's scheduling to `to`, preserving its precision.
 *
 * Returns only the scheduling keys, so it serves both the spawned row and the
 * repair pass. All-day tasks are pinned to local midnight; a timed task keeps
 * its wall-clock offset from local midnight (computed with `startOfDay` on both
 * sides, so a DST transition between the two days does not shift the time).
 */
function shiftToDate(
  task: Task,
  from: LocalDate,
  to: LocalDate,
): Pick<TaskPatch, 'dueDate' | 'dueAt'> {
  if (task.dueAt === null) return { dueDate: to, dueAt: null };
  if (task.allDay) return { dueDate: to, dueAt: startOfDay(to) };
  const offsetMs = Date.parse(task.dueAt) - Date.parse(startOfDay(from));
  const dayEnd = endOfDay(to);
  const shifted = Date.parse(startOfDay(to)) + offsetMs;
  // Clamp into the target day (e.g. 09:00 stays 09:00; an impossible offset
  // such as one born from a DST gap cannot land on the following day).
  const end = Date.parse(dayEnd);
  return {
    dueDate: to,
    dueAt: new Date(shifted >= end ? end - 1 : shifted).toISOString() as Instant,
  };
}

/** Structural equality for two rules, tolerant of key order and optional fields. */
function sameRecurrence(a: Recurrence | null, b: Recurrence | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.frequency !== b.frequency || a.interval !== b.interval) return false;
  if ((a.until ?? null) !== (b.until ?? null)) return false;
  switch (a.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return (
        b.frequency === 'weekly' &&
        a.weekdays.length === b.weekdays.length &&
        [...a.weekdays].sort().every((day, index) => day === [...b.weekdays].sort()[index])
      );
    case 'monthly':
      return b.frequency === 'monthly' && a.monthDay === b.monthDay;
  }
}

/** Whole days from `a` to `b` (positive when `b` is later). */
function daysBetween(a: LocalDate, b: LocalDate): number {
  return daysFromToday(b, a);
}

/** Safety valve: how many occurrences a single walk may step over. */
const MAX_ROLL_STEPS = 1000;

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
 * The earliest occurrence of `rule` at or after `floor`, given the task's
 * stored `stored` date is (believed to be) one of its occurrences.
 *
 * Walks backwards on the rule's own grid. When `stored` is not itself an
 * occurrence (a hand-edited row), the first backward step still lands on one,
 * so the result is always a real occurrence.
 */
function walkBackToFloor(rule: Recurrence, stored: LocalDate, floor: LocalDate): LocalDate | null {
  let cursor = stored;
  let previous = previousOccurrence(rule, cursor);
  for (let steps = 0; previous !== null && steps < MAX_ROLL_STEPS; steps++) {
    if (previous < floor) return cursor;
    cursor = previous;
    previous = previousOccurrence(rule, cursor);
  }
  return cursor >= floor ? cursor : null;
}

export class TaskNotFoundError extends Error {
  constructor(readonly id: TaskId) {
    super(`任务不存在: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}
