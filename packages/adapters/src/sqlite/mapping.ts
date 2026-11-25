import type {
  CalendarEvent,
  DuePeriod,
  EventId,
  Instant,
  ListId,
  LocalDate,
  Task,
  TaskId,
  TaskList,
  TaskStatus,
} from '@todolist/core';
import { RowDecodeError } from '../errors.js';
import { decodeRecurrenceValue, encodeRecurrenceValue } from '../recurrence-codec.js';

/**
 * Row ↔ domain mapping, exactly one pair of functions per table.
 *
 * If a column is renamed, only the function below for that table changes.
 * Drivers are not required to return native types (Tauri's plugin-sql and
 * op-sqlite differ on booleans), so decoding is defensive.
 */

export interface ListRow {
  readonly id: unknown;
  readonly name: unknown;
  readonly color: unknown;
  readonly order: unknown;
  readonly archived: unknown;
  /**
   * Added in schema v5. Optional so a row read from a pre-migration shape (or a
   * hand-built fixture) decodes as "ordinary list", which is exactly what a
   * list without a system identity is.
   */
  readonly system_key?: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export interface TaskRow {
  readonly id: unknown;
  readonly list_id: unknown;
  readonly title: unknown;
  readonly notes: unknown;
  readonly status: unknown;
  readonly important: unknown;
  readonly urgent: unknown;
  readonly due_at: unknown;
  readonly due_date: unknown;
  readonly all_day: unknown;
  readonly completed_at: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  /**
   * Added in schema v2. Optional so a row decoded from a pre-migration shape
   * (or a hand-built test fixture) simply reads as "does not repeat".
   */
  readonly recurrence?: unknown;
  /**
   * Added in schema v3. Optional for the same reason as `recurrence`: a v2 row
   * (or a fixture that predates this column) reads as "no period", which is
   * precisely its meaning.
   */
  readonly due_period?: unknown;
}

export interface EventRow {
  readonly id: unknown;
  readonly list_id: unknown;
  readonly title: unknown;
  readonly notes: unknown;
  readonly start_at: unknown;
  readonly end_at: unknown;
  readonly all_day: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

// ---------------------------------------------------------------------------
// lists
// ---------------------------------------------------------------------------

export function rowToList(row: ListRow): TaskList {
  return {
    id: requireString(row.id, 'lists', 'id') as ListId,
    name: requireString(row.name, 'lists', 'name'),
    color: requireString(row.color, 'lists', 'color'),
    order: requireNumber(row.order, 'lists', 'order'),
    archived: decodeBoolean(row.archived, 'lists', 'archived'),
    systemKey: nullableString(row.system_key),
    createdAt: requireString(row.created_at, 'lists', 'created_at') as Instant,
    updatedAt: requireString(row.updated_at, 'lists', 'updated_at') as Instant,
  };
}

export function listToRow(list: TaskList): Record<string, unknown> {
  return {
    id: list.id,
    name: list.name,
    color: list.color,
    // Quoted: `order` is a SQL keyword and `insertSql` uses these keys as
    // column names verbatim.
    '"order"': list.order,
    archived: list.archived ? 1 : 0,
    system_key: list.systemKey ?? null,
    created_at: list.createdAt,
    updated_at: list.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

export function rowToTask(row: TaskRow): Task {
  return {
    id: requireString(row.id, 'tasks', 'id') as TaskId,
    listId: requireString(row.list_id, 'tasks', 'list_id') as ListId,
    title: requireString(row.title, 'tasks', 'title'),
    notes: requireString(row.notes, 'tasks', 'notes'),
    status: decodeStatus(row.status),
    important: decodeBoolean(row.important, 'tasks', 'important'),
    urgent: decodeBoolean(row.urgent, 'tasks', 'urgent'),
    dueAt: nullableString(row.due_at) as Instant | null,
    dueDate: nullableString(row.due_date) as LocalDate | null,
    allDay: decodeBoolean(row.all_day, 'tasks', 'all_day'),
    duePeriod: decodeDuePeriod(row.due_period),
    recurrence: decodeRecurrenceValue(row.recurrence),
    completedAt: nullableString(row.completed_at) as Instant | null,
    createdAt: requireString(row.created_at, 'tasks', 'created_at') as Instant,
    updatedAt: requireString(row.updated_at, 'tasks', 'updated_at') as Instant,
  };
}

export function taskToRow(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    list_id: task.listId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    important: task.important ? 1 : 0,
    urgent: task.urgent ? 1 : 0,
    due_at: task.dueAt,
    due_date: task.dueDate,
    all_day: task.allDay ? 1 : 0,
    due_period: task.duePeriod,
    recurrence: encodeRecurrenceValue(task.recurrence),
    completed_at: task.completedAt,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: requireString(row.id, 'events', 'id') as EventId,
    listId: nullableString(row.list_id) as ListId | null,
    title: requireString(row.title, 'events', 'title'),
    notes: requireString(row.notes, 'events', 'notes'),
    startAt: requireString(row.start_at, 'events', 'start_at') as Instant,
    endAt: requireString(row.end_at, 'events', 'end_at') as Instant,
    allDay: decodeBoolean(row.all_day, 'events', 'all_day'),
    createdAt: requireString(row.created_at, 'events', 'created_at') as Instant,
    updatedAt: requireString(row.updated_at, 'events', 'updated_at') as Instant,
  };
}

export function eventToRow(event: CalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    list_id: event.listId,
    title: event.title,
    notes: event.notes,
    start_at: event.startAt,
    end_at: event.endAt,
    all_day: event.allDay ? 1 : 0,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// decoding helpers
// ---------------------------------------------------------------------------

function requireString(value: unknown, table: string, column: string): string {
  if (typeof value === 'string') return value;
  throw new RowDecodeError(table, `expected text in "${column}", got ${describe(value)}`);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  // Some drivers stringify every column; coerce rather than fail a read.
  return String(value);
}

function requireNumber(value: unknown, table: string, column: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new RowDecodeError(table, `expected number in "${column}", got ${describe(value)}`);
}

function decodeBoolean(value: unknown, table: string, column: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  throw new RowDecodeError(table, `expected 0/1 in "${column}", got ${describe(value)}`);
}

function decodeStatus(value: unknown): TaskStatus {
  if (value === 'open' || value === 'done') return value;
  throw new RowDecodeError('tasks', `expected status "open" | "done", got ${describe(value)}`);
}

/**
 * Unknown values decode to `null` rather than throwing. A hand-edited row with
 * a typo'd period is better treated as "whole day" (the pre-v3 meaning of the
 * column) than turned into an unreadable task — the same tolerance
 * `decodeRecurrenceValue` applies to a corrupt recurrence.
 */
function decodeDuePeriod(value: unknown): DuePeriod | null {
  return value === 'morning' || value === 'afternoon' || value === 'evening' ? value : null;
}

function describe(value: unknown): string {
  return value === null ? 'null' : `${typeof value}(${String(value)})`;
}
