import type { CalendarEvent, DuePeriod, Instant, LocalDate, Task } from '@todolist/core';
import { duePrecisionOf, endOfDay, instantAtLocal } from '@todolist/core';

/**
 * Reminder scheduling — pure, framework-free, and clock-free.
 *
 * There are deliberately NO timers here. The host drives time: it calls
 * `tick(now)` on an interval (and on window focus), and this module answers
 * "what just became due that I have not announced yet?". That keeps the logic
 * deterministic and unit-testable, and lets the same code run under React,
 * React Native or a worker.
 *
 * ## A reminder is not always `task.dueAt`
 * Day and half-day tasks store local midnight in `dueAt` — a placeholder that
 * keeps them on the calendar, not an instant anyone wants to be woken at.
 * Announcing the stored value is how a "today" task ended up reminding at
 * 00:00 and then never again. The instant that should actually announce is
 * derived per tick by `reminderAnchorOf()`. The anchor is never written back to
 * storage: the task keeps meaning "some day" (or "some morning") and the anchor
 * is recomputed from current data every tick.
 */

export type ReminderKind = 'task' | 'event';

/** How precise a task's date is. Only tasks have a non-`time` granularity. */
export type ReminderGranularity = 'day' | 'period' | 'time';

/**
 * When a task should be announced, derived from its precision.
 *
 * `date` is the local day that bounds a late announcement. It is non-null for
 * `day` / `period` (which may announce any time on their own day) and null for
 * `time`, whose instant is its own deadline.
 */
export interface ReminderAnchor {
  readonly anchor: Instant;
  readonly granularity: ReminderGranularity;
  readonly date: LocalDate | null;
  /** Half-day bucket when `granularity` is `'period'`; null otherwise. */
  readonly period: DuePeriod | null;
}

/**
 * The wall-clock hour each half-day bucket announces at.
 *
 * These follow Todoist's public natural-language mapping (`in the morning` →
 * 9 AM, `in the afternoon` → noon, `in the evening` → 7 PM) rather than an
 * invented rule, so there is nothing new for the user to learn. Fixed
 * constants on purpose — no setting, no per-user boundaries (design doc §5.7).
 */
const PERIOD_ANCHOR: Record<DuePeriod, string> = {
  morning: '09:00',
  afternoon: '12:00',
  evening: '19:00',
};

/** A whole-day task announces with the morning bucket: early, but not at 00:00. */
const DAY_ANCHOR = '09:00';

/**
 * Derive the instant a task should be announced, or null when it has no date.
 *
 * This is the single place that turns precision into an announcement time.
 * It uses `duePrecisionOf()` rather than reading `allDay` directly, because
 * `allDay` is true for both day and period tasks and cannot tell them apart.
 *
 *   - `time`   — `dueAt` itself.
 *   - `period` — the bucket's fixed local hour on `dueDate` (`period` set).
 *   - `day`    — 09:00 local on `dueDate`.
 *
 * Rows that predate the "dueAt and dueDate are set together" invariant can have
 * `dueAt` but no `dueDate`; `duePrecisionOf` calls those `none`. Rather than
 * silently dropping a reminder the user used to get, fall back to the stored
 * instant (the same defensive choice `isOverdue()` makes in core).
 *
 * Malformed dates return null instead of throwing: this runs inside the host's
 * 30-second tick, and one corrupt row must not stop every other reminder.
 */
export function reminderAnchorOf(
  task: Pick<Task, 'dueDate' | 'dueAt' | 'allDay' | 'duePeriod'>,
): ReminderAnchor | null {
  switch (duePrecisionOf(task)) {
    case 'time':
      return task.dueAt === null
        ? null
        : { anchor: task.dueAt, granularity: 'time', date: null, period: null };

    case 'day': {
      if (task.dueDate === null) return null;
      const anchor = anchorAt(task.dueDate, DAY_ANCHOR);
      return anchor === null
        ? null
        : { anchor, granularity: 'day', date: task.dueDate, period: null };
    }

    case 'period': {
      if (task.dueDate === null || task.duePeriod === null) return null;
      const anchor = anchorAt(task.dueDate, PERIOD_ANCHOR[task.duePeriod]);
      return anchor === null
        ? null
        : { anchor, granularity: 'period', date: task.dueDate, period: task.duePeriod };
    }

    case 'none':
      return task.dueAt === null || Number.isNaN(Date.parse(task.dueAt))
        ? null
        : { anchor: task.dueAt, granularity: 'time', date: null, period: null };
  }
}

function anchorAt(date: LocalDate, time: string): Instant | null {
  try {
    return instantAtLocal(date, time);
  } catch {
    // Unreachable for data written through TaskService; kept so a hand-edited
    // or corrupted row cannot take the whole reminder loop down.
    return null;
  }
}

export interface ReminderItem {
  readonly kind: ReminderKind;
  readonly id: string;
  readonly title: string;
  /**
   * The reminder's anchor: `task.dueAt` for exact-time tasks and events, the
   * derived day/period anchor otherwise. Never the fabricated midnight.
   */
  readonly dueAt: Instant;
  /** Whole minutes until the anchor; 0 when due now, negative if late. */
  readonly minutesUntil: number;
  readonly allDay: boolean;
  /** Half-day bucket for a `period` task; null for day, time and events. */
  readonly period: DuePeriod | null;
  /**
   * The local day a day/period reminder belongs to, which is also its dedupe
   * date. Null for exact-time items and events, whose keys stay instant-based.
   */
  readonly reminderDate: LocalDate | null;
}

const MINUTE_MS = 60_000;

/**
 * The fields that identify a reminder. `reminderDate` is optional so callers
 * (and tests) can still describe a plain instant-keyed reminder with just
 * `{ kind, id, dueAt }`.
 */
export type ReminderKeyFields = Pick<ReminderItem, 'kind' | 'id' | 'dueAt'> & {
  readonly reminderDate?: LocalDate | null;
};

/**
 * Stable identity for an item, used by the fired-id ledger.
 *
 * Day and period reminders key on the local date, not the instant: they are
 * allowed to announce at any point during their day, so an instant-based key
 * would change with the anchor and re-fire on every tick. The date key keeps
 * them at "once per day" and rolls over naturally at midnight. Exact-time
 * reminders keep their instant key, because moving the time is a new reminder.
 */
export function reminderKey(item: ReminderKeyFields): string {
  if (item.reminderDate !== undefined && item.reminderDate !== null) {
    return `${item.kind}:${item.id}:${item.reminderDate}`;
  }
  return `${item.kind}:${item.id}:${item.dueAt}`;
}

function toItem(
  kind: ReminderKind,
  id: string,
  title: string,
  found: ReminderAnchor,
  allDay: boolean,
  nowMs: number,
): ReminderItem {
  return {
    kind,
    id,
    title,
    dueAt: found.anchor,
    minutesUntil: Math.round((Date.parse(found.anchor) - nowMs) / MINUTE_MS),
    allDay,
    period: found.period,
    reminderDate: found.date,
  };
}

/**
 * Items that should be announced at `now`, sorted by anchor (ties broken by
 * kind then id).
 *
 * There are two windows, because "due" means different things at different
 * precisions:
 *
 *   - `time` — `now <= anchor <= now + windowMinutes`, inclusive on both ends.
 *     The instant is a social contract (a meeting, a train); announcing a
 *     missed one is noise, so there is no catch-up.
 *   - `day` / `period` — `anchor <= now + windowMinutes` and `now` still inside
 *     the anchor's own local day. The anchor marks when the task became
 *     actionable, not a deadline, so a "today" task first seen at 15:00 is
 *     announced then (with a negative `minutesUntil`) rather than never.
 *
 * `endOfDay` is the cut-off for the catch-up window, deliberately not
 * `endOfPeriod`: the latter is the overdue boundary, and an afternoon task is
 * still worth surfacing at 17:00 even though it is already late.
 *
 * The date-based key from `reminderKey()` is what stops the catch-up rule from
 * re-announcing the same task on every 30-second tick.
 */
export function computeUpcoming(
  tasks: readonly Task[],
  events: readonly CalendarEvent[],
  now: Instant,
  windowMinutes: number,
): ReminderItem[] {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs) || Number.isNaN(windowMinutes) || windowMinutes < 0) return [];

  const horizonMs = nowMs + windowMinutes * MINUTE_MS;
  const items: ReminderItem[] = [];

  for (const task of tasks) {
    if (task.status === 'done') continue;
    const found = reminderAnchorOf(task);
    if (found === null) continue;
    const anchorMs = Date.parse(found.anchor);
    if (Number.isNaN(anchorMs) || anchorMs > horizonMs) continue;

    if (found.date === null) {
      // Exact time: never announce after the moment has passed.
      if (anchorMs < nowMs) continue;
    } else {
      // Day / period: announce any time on (and only on) their own local day.
      const dayEndMs = Date.parse(endOfDay(found.date));
      if (Number.isNaN(dayEndMs) || nowMs >= dayEndMs) continue;
    }

    items.push(toItem('task', task.id, task.title, found, task.allDay, nowMs));
  }

  for (const event of events) {
    const dueMs = Date.parse(event.startAt);
    if (Number.isNaN(dueMs)) continue;
    if (dueMs < nowMs || dueMs > horizonMs) continue;
    items.push(
      toItem(
        'event',
        event.id,
        event.title,
        { anchor: event.startAt, granularity: 'time', date: null, period: null },
        event.allDay,
        nowMs,
      ),
    );
  }

  return items.sort((a, b) => {
    const diff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** False once the item has been announced in this process. */
export function shouldFire(item: ReminderKeyFields, firedIds: ReadonlySet<string>): boolean {
  return !firedIds.has(reminderKey(item));
}

/** Default cap on remembered ids, so a long session cannot grow unbounded. */
export const DEFAULT_FIRED_CAPACITY = 200;

export interface ReminderStateOptions {
  readonly tasks?: readonly Task[];
  readonly events?: readonly CalendarEvent[];
  readonly windowMinutes?: number;
  /** Remembered-id cap; clamped to 1..200. */
  readonly capacity?: number;
}

/**
 * Tracks which reminders have already fired, so `tick` only returns the newly
 * due ones. Insertion order is used as the eviction order once the cap is hit.
 */
export class ReminderState {
  private tasks: readonly Task[];
  private events: readonly CalendarEvent[];
  private windowMinutes: number;
  private readonly capacity: number;
  private readonly fired = new Set<string>();

  constructor(options: ReminderStateOptions = {}) {
    this.tasks = options.tasks ?? [];
    this.events = options.events ?? [];
    this.windowMinutes = options.windowMinutes ?? 10;
    this.capacity = Math.max(1, Math.min(options.capacity ?? DEFAULT_FIRED_CAPACITY, DEFAULT_FIRED_CAPACITY));
  }

  /** Refresh the data the next `tick` reads from. */
  setSources(tasks: readonly Task[], events: readonly CalendarEvent[]): void {
    this.tasks = tasks;
    this.events = events;
  }

  setWindowMinutes(minutes: number): void {
    this.windowMinutes = minutes;
  }

  hasFired(item: ReminderKeyFields): boolean {
    return this.fired.has(reminderKey(item));
  }

  /** Mark an item as announced without returning it (e.g. after a manual show). */
  markFired(item: ReminderKeyFields): void {
    this.remember(reminderKey(item));
  }

  /**
   * Returns items that are due now (inside the current window) and were not
   * returned before. Each returned item is remembered, so the next tick with
   * the same data is empty.
   */
  tick(now: Instant): ReminderItem[] {
    const due = computeUpcoming(this.tasks, this.events, now, this.windowMinutes);
    const fresh = due.filter((item) => !this.fired.has(reminderKey(item)));
    for (const item of fresh) this.remember(reminderKey(item));
    return fresh;
  }

  /** Forget everything — e.g. after an import or a deliberate reset. */
  clear(): void {
    this.fired.clear();
  }

  /** Snapshot of remembered keys, oldest first (useful for debugging/tests). */
  get firedIds(): readonly string[] {
    return [...this.fired];
  }

  private remember(key: string): void {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    while (this.fired.size > this.capacity) {
      const oldest = this.fired.values().next();
      if (oldest.done) break;
      this.fired.delete(oldest.value);
    }
  }
}
