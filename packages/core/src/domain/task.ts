import type { DuePeriod, Instant, LocalDate, Quadrant, Task } from './types.js';
import { endOfDay, instantAtLocal } from '../shared/date.js';

const DAY_MS = 86_400_000;

export function quadrantOf(task: Pick<Task, 'important' | 'urgent'>): Quadrant {
  if (task.important && task.urgent) return 'urgent-important';
  if (task.important) return 'not-urgent-important';
  if (task.urgent) return 'urgent-not-important';
  return 'unimportant';
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  'urgent-important': '重要且紧急',
  'not-urgent-important': '重要不紧急',
  'urgent-not-important': '不重要但紧急',
  unimportant: '不重要不紧急',
};

/**
 * How precisely a task is scheduled.
 *
 * This is derived, never stored: the three scheduling fields already determine
 * it, and persisting a second answer to the same question is how the two get
 * out of sync (the same reasoning that keeps the quadrant out of the database;
 * see docs/adr/0003-local-first-persistence.md). Any code that needs to tell
 * "a whole day" from "a half-day bucket" must ask this function instead of
 * reading `allDay` — `allDay` is true for both.
 */
export type DuePrecision = 'none' | 'day' | 'period' | 'time';

export function duePrecisionOf(
  task: Pick<Task, 'dueDate' | 'dueAt' | 'allDay' | 'duePeriod'>,
): DuePrecision {
  if (task.dueDate === null) return 'none';
  if (!task.allDay) return 'time';
  return task.duePeriod === null ? 'day' : 'period';
}

/**
 * Exclusive end of a half-day bucket on `date`.
 *
 * Boundaries are the start of the next bucket, matching the Todoist wording
 * the product borrowed ("in the morning" = before noon): morning ends at
 * 12:00, afternoon at 19:00, evening at the start of the next day. Fixed
 * constants on purpose — there is no user setting for these; see the design
 * doc §5.7.
 */
export function endOfPeriod(date: LocalDate, period: DuePeriod): Instant {
  switch (period) {
    case 'morning':
      return instantAtLocal(date, '12:00');
    case 'afternoon':
      return instantAtLocal(date, '19:00');
    case 'evening':
      return endOfDay(date);
  }
}

/**
 * True when a task is past due and still open.
 *
 * The comparison is per precision because `dueAt` is not the task's deadline
 * for day and period tasks — it is the (fabricated) local midnight that keeps
 * them on the calendar. Comparing `now` to it would mark a "today" task overdue
 * at 00:00:01 of its own day, and a "this morning" task overdue before the
 * morning ends.
 *
 *   - `time`   — strictly after `dueAt`. At the exact instant it is due the
 *                task is not yet late, which is also the pre-existing rule.
 *   - `day`    — at or after the next local midnight (`endOfDay` is exclusive).
 *   - `period` — at or after `endOfPeriod()`.
 */
export function isOverdue(task: Task, now: Instant): boolean {
  if (task.status === 'done' || task.dueAt === null) return false;

  const nowMs = Date.parse(now);
  switch (duePrecisionOf(task)) {
    case 'time':
      return Date.parse(task.dueAt) < nowMs;
    case 'day':
      // A row with no dueDate but a dueAt predates the scheduling invariants;
      // fall back to instant comparison rather than calling it never-overdue.
      return Date.parse(task.dueDate === null ? task.dueAt : endOfDay(task.dueDate)) <= nowMs;
    case 'period':
      return (
        Date.parse(
          task.dueDate === null || task.duePeriod === null
            ? task.dueAt
            : endOfPeriod(task.dueDate, task.duePeriod),
        ) <= nowMs
      );
    case 'none':
      return false;
  }
}

/** Days between a local date and "today" (negative = in the past). */
export function daysFromToday(date: LocalDate, today: LocalDate): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/**
 * Display order for the half-day buckets. `null` (a whole day, or a task with
 * an exact time) sorts last, so an unspecified bucket never jumps ahead of a
 * chosen one that falls on the same day.
 */
const PERIOD_RANK: Record<DuePeriod, number> = { morning: 0, afternoon: 1, evening: 2 };
const NO_PERIOD_RANK = 3;

/**
 * Stable ordering used by every list surface: open before done, then by
 * due date, then by half-day bucket, then by creation. Pure so views can rely
 * on one definition.
 *
 * The period tiebreak only applies when the instants are equal — which is the
 * normal case for all-day and period tasks, since both store local midnight.
 * Time-precision tasks have distinct instants and keep their wall-clock order.
 * `duePeriod` is `null` for time tasks, so they rank last within a tie, which
 * is harmless: only an identical instant can tie with them.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  const aDue = a.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.dueAt);
  const bDue = b.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;
  const aPeriod = a.duePeriod === null ? NO_PERIOD_RANK : PERIOD_RANK[a.duePeriod];
  const bPeriod = b.duePeriod === null ? NO_PERIOD_RANK : PERIOD_RANK[b.duePeriod];
  if (aPeriod !== bPeriod) return aPeriod - bPeriod;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}
