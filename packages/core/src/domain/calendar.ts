import type { CalendarEntry, CalendarEvent, Instant, Task, TaskList } from './types.js';
import { endOfDay } from '../shared/date.js';

/** Inclusive start, exclusive end range test on ISO instants. */
export function inRange(at: Instant, from: Instant, to: Instant): boolean {
  const t = Date.parse(at);
  return t >= Date.parse(from) && t < Date.parse(to);
}

/** Two intervals overlap when one starts before the other ends. */
export function overlaps(
  aStart: Instant,
  aEnd: Instant,
  bStart: Instant,
  bEnd: Instant,
): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

export function eventToEntry(event: CalendarEvent, color: string): CalendarEntry {
  return {
    source: 'event',
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    color,
    done: false,
    // Events are intervals, not buckets; there is no half-day to carry.
    period: null,
    // Carried so the event inspector can edit these in place. Before this they
    // were dropped here, which is why opening an event showed a blank notes
    // field and a "no list" value that would have been written back on save.
    notes: event.notes,
    listId: event.listId,
  };
}

/**
 * A task becomes a calendar entry only when it has a scheduling window.
 *
 * `day` and `period` tasks both occupy their whole local date (`allDay: true`),
 * so the calendar's existing all-day/grid split puts them in the all-day strip
 * without any view changes; only the chip's label needs `period` to say
 * 「上午」 instead of "全天". `time` tasks stay on the instant grid.
 *
 * A period task marks its half-day only in `period`; its instant window is the
 * same whole day as a day task, because the bucket is not a duration (drawing
 * 09:00–12:00 would turn it into a block the design explicitly rejects).
 */
export function taskToEntry(task: Task, color: string): CalendarEntry | null {
  if (task.dueAt === null || task.dueDate === null) return null;
  const start = task.dueAt;
  // `endOfDay` is the exclusive next midnight. The old `${date}T23:59:59.999`
  // relied on `Date.parse` reading an untimed string as local time; going
  // through Temporal makes that guarantee explicit (and it is the boundary
  // `isOverdue` uses, so the two can never disagree).
  const end = task.allDay ? endOfDay(task.dueDate) : task.dueAt;
  return {
    source: 'task',
    id: task.id,
    title: task.title,
    startAt: start,
    endAt: end,
    allDay: task.allDay,
    color,
    done: task.status === 'done',
    period: task.duePeriod,
  };
}

export function colorOfList(lists: readonly TaskList[], listId: string | null): string {
  const found = lists.find((l) => l.id === listId);
  // Entries with no list inherit their chip hue from the active palette, so a
  // list-less task never paints a baked neutral that ignores the theme.
  return found?.color ?? 'var(--tl-text-tertiary)';
}
