import type { CalendarEvent, Instant, Task } from '@todolist/core';

/**
 * Reminder scheduling — pure, framework-free, and clock-free.
 *
 * There are deliberately NO timers here. The host drives time: it calls
 * `tick(now)` on an interval (and on window focus), and this module answers
 * "what just became due that I have not announced yet?". That keeps the logic
 * deterministic and unit-testable, and lets the same code run under React,
 * React Native or a worker.
 */

export type ReminderKind = 'task' | 'event';

export interface ReminderItem {
  readonly kind: ReminderKind;
  readonly id: string;
  readonly title: string;
  readonly dueAt: Instant;
  /** Whole minutes until the due instant; 0 when due now, negative if late. */
  readonly minutesUntil: number;
  readonly allDay: boolean;
}

const MINUTE_MS = 60_000;

/** Stable identity for an item, used by the fired-id ledger. */
export function reminderKey(item: Pick<ReminderItem, 'kind' | 'id' | 'dueAt'>): string {
  return `${item.kind}:${item.id}:${item.dueAt}`;
}

function toItem(
  kind: ReminderKind,
  id: string,
  title: string,
  dueAt: Instant,
  allDay: boolean,
  nowMs: number,
): ReminderItem {
  return {
    kind,
    id,
    title,
    dueAt,
    minutesUntil: Math.round((Date.parse(dueAt) - nowMs) / MINUTE_MS),
    allDay,
  };
}

/**
 * Items whose due instant falls inside `[now, now + windowMinutes]`, inclusive
 * on both ends, sorted by due time (ties broken by kind then id).
 *
 * Tasks without a `dueAt` and completed tasks never remind. Events remind at
 * their start instant.
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
    if (task.status === 'done' || task.dueAt === null) continue;
    const dueMs = Date.parse(task.dueAt);
    if (Number.isNaN(dueMs)) continue;
    if (dueMs < nowMs || dueMs > horizonMs) continue;
    items.push(toItem('task', task.id, task.title, task.dueAt, task.allDay, nowMs));
  }

  for (const event of events) {
    const dueMs = Date.parse(event.startAt);
    if (Number.isNaN(dueMs)) continue;
    if (dueMs < nowMs || dueMs > horizonMs) continue;
    items.push(toItem('event', event.id, event.title, event.startAt, event.allDay, nowMs));
  }

  return items.sort((a, b) => {
    const diff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** False once the item has been announced in this process. */
export function shouldFire(item: ReminderItem, firedIds: ReadonlySet<string>): boolean {
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

  hasFired(item: Pick<ReminderItem, 'kind' | 'id' | 'dueAt'>): boolean {
    return this.fired.has(reminderKey(item));
  }

  /** Mark an item as announced without returning it (e.g. after a manual show). */
  markFired(item: Pick<ReminderItem, 'kind' | 'id' | 'dueAt'>): void {
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
