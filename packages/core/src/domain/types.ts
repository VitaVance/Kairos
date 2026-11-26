/**
 * Domain model — framework-agnostic, zero dependencies.
 *
 * Everything here is plain data + pure functions. No React, no storage,
 * no Tauri. This is the innermost layer of the onion: if you deleted every
 * other package, this one would still compile and its tests would still pass.
 *
 * Recurrence value types live here too (they are plain data and `Task` embeds
 * one); the pure scheduling functions that operate on them live in
 * `recurrence.ts`, which imports *from* this module — never the reverse.
 */

/** Branded id to stop accidental cross-assignment of ids. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TaskId = Brand<string, 'TaskId'>;
export type ListId = Brand<string, 'ListId'>;
export type EventId = Brand<string, 'EventId'>;

/** ISO-8601 instant, e.g. "2026-09-06T08:00:00.000Z". */
export type Instant = Brand<string, 'Instant'>;

/** Local calendar day, "YYYY-MM-DD". Timezone-free by design. */
export type LocalDate = Brand<string, 'LocalDate'>;

// ---------------------------------------------------------------------------
// Recurrence — see `recurrence.ts` for `nextOccurrence` and validation.
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

/** Monday = 0 … Sunday = 6, matching `dayOfWeek()` in `shared/date.ts`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface RecurrenceBase {
  /** Every N days / weeks / months. Integer, 1..MAX_RECURRENCE_INTERVAL. */
  readonly interval: number;
  /**
   * Inclusive last local date the series may land on. Absent/null means "no
   * end". Stored as a plain `"YYYY-MM-DD"` string, like every other LocalDate.
   */
  readonly until?: LocalDate | null;
}

export interface DailyRecurrence extends RecurrenceBase {
  readonly frequency: 'daily';
}

export interface WeeklyRecurrence extends RecurrenceBase {
  readonly frequency: 'weekly';
  /** Non-empty, duplicate-free set of chosen weekdays (Monday = 0). */
  readonly weekdays: readonly Weekday[];
}

export interface MonthlyRecurrence extends RecurrenceBase {
  readonly frequency: 'monthly';
  /** Day of the month, 1..31. Months lacking that day are skipped. */
  readonly monthDay: number;
}

export type Recurrence = DailyRecurrence | WeeklyRecurrence | MonthlyRecurrence;


/** Eisenhower quadrant, derived from importance × urgency. */
export type Quadrant = 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'unimportant';

/**
 * Half-day bucket. Deliberately has no clock time: that is the line between it
 * and `dueAt`. The fixed boundaries (morning ends 12:00, afternoon 19:00,
 * evening 24:00) live in `task.ts`, not here, so this stays plain data.
 */
export type DuePeriod = 'morning' | 'afternoon' | 'evening';

export type TaskStatus = 'open' | 'done';

export interface TaskList {
  readonly id: ListId;
  readonly name: string;
  /** Hex color used for chips, dots and left rules. */
  readonly color: string;
  readonly order: number;
  readonly archived: boolean;
  /**
   * Stable identity for a list the app itself owns, or null/absent for a list
   * the user created. Today the only key is `'inbox'` (see `SYSTEM_INBOX_KEY`).
   *
   * Identity, not a name: presentation resolves a system list's display name
   * from the active catalog, so switching language renames the inbox without
   * touching user lists — and this flag is what tells them apart. Absent means
   * "ordinary list", which is also what every pre-flag database row means.
   *
   * Deliberately optional so every existing `TaskList` literal (fixtures,
   * backups written before this field existed) keeps compiling and reads as a
   * user list — the honest meaning of "no flag".
   */
  readonly systemKey?: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** The one system-list identity the app ships today. */
export const SYSTEM_INBOX_KEY = 'inbox';

/** True when this list is the app-owned inbox, regardless of its stored name. */
export function isSystemInbox(list: Pick<TaskList, 'systemKey'>): boolean {
  return list.systemKey === SYSTEM_INBOX_KEY;
}

/**
 * The name to *show* for a list. User lists show their stored name; the system
 * inbox shows the label the caller resolved from the active catalog, so
 * switching language renames it in place without touching the row. The label
 * is passed in because the domain does not know about i18n.
 */
export function listDisplayName(
  list: Pick<TaskList, 'name' | 'systemKey'>,
  systemLabel: string,
): string {
  return isSystemInbox(list) ? systemLabel : list.name;
}

export interface Task {
  readonly id: TaskId;
  readonly listId: ListId;
  readonly title: string;
  readonly notes: string;
  readonly status: TaskStatus;

  /** Eisenhower axes — the source of truth, quadrant is derived. */
  readonly important: boolean;
  readonly urgent: boolean;

  /** Optional scheduling window. A task with no dueAt is "inbox". */
  readonly dueAt: Instant | null;
  readonly dueDate: LocalDate | null;
  readonly allDay: boolean;

  /**
   * Which half of its day the task belongs to. Only meaningful when `allDay`
   * is true — an exact-time task lives at `dueAt`, a day task fills the whole
   * day, and a period task fills a bucket inside it. `null` therefore means
   * two different things depending on `allDay` ("whole day" vs "no bucket"),
   * which is exactly why callers should read `duePrecisionOf()` instead of
   * inferring precision from fields themselves.
   */
  readonly duePeriod: DuePeriod | null;

  /**
   * How the task repeats after completion. `null` for the overwhelming
   * majority of tasks. See `domain/recurrence.ts` for the scheduling rules.
   */
  readonly recurrence: Recurrence | null;

  readonly completedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CalendarEvent {
  readonly id: EventId;
  readonly listId: ListId | null;
  readonly title: string;
  readonly notes: string;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly allDay: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/**
 * What a calendar grid renders. Tasks with a due date and standalone events
 * both project into this single shape, so the calendar never needs to know
 * which source an entry came from.
 */
export interface CalendarEntry {
  readonly source: 'task' | 'event';
  readonly id: string;
  readonly title: string;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly allDay: boolean;
  readonly color: string;
  readonly done: boolean;
  /**
   * Half-day bucket, present only on half-day task entries; absent/null for
   * events and for day- and time-precision tasks. Optional (not required) so
   * every existing producer of a `CalendarEntry` keeps compiling — but the
   * one producer in core, `taskToEntry()`, always sets it.
   */
  readonly period?: DuePeriod | null;
  /**
   * Editable event fields, carried through so an inspector can patch them
   * without a second fetch. `EventService` has no `get()`, and these were
   * dropped by `eventToEntry()` — which is why editing an event showed a blank
   * notes field and a "no list" value that would have been persisted on save.
   * Optional because task entries have no notes/list of their own (a task's
   * `listId` is already the row's list, not a field to edit here).
   */
  readonly notes?: string;
  readonly listId?: string | null;
}

/** Input shapes for creating/updating — the domain owns what may change. */
export type NewTask = Pick<Task, 'title'> &
  Partial<Omit<Task, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'status' | 'completedAt'>>;

export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>;

export type NewEvent = Pick<CalendarEvent, 'title' | 'startAt' | 'endAt'> &
  Partial<Omit<CalendarEvent, 'id' | 'title' | 'startAt' | 'endAt' | 'createdAt' | 'updatedAt'>>;

/**
 * `systemKey` is creation-time only: identity is minted once (the seeder does
 * it) and is not part of any update patch. See `LIST_PATCH_FIELDS`.
 */
export type NewList = Pick<TaskList, 'name' | 'color'> &
  Partial<Pick<TaskList, 'order' | 'systemKey'>>;
