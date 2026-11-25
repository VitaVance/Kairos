import type { Recurrence, TaskPatch } from '@todolist/core';
import { encodeRecurrenceValue } from './recurrence-codec.js';

/**
 * The single source of truth for *which* domain fields may be written.
 *
 * Both the SQLite and the in-memory adapters import these lists, so "what is
 * patchable" can never drift between backends. Ids, `createdAt` and
 * `updatedAt` are intentionally absent: they are owned by the repository.
 */
export const TASK_PATCH_FIELDS = [
  'listId',
  'title',
  'notes',
  'status',
  'important',
  'urgent',
  'dueAt',
  'dueDate',
  'allDay',
  // Easy to miss: this list is the allowlist `buildAssignments()` iterates,
  // so a domain field absent here is silently dropped from every UPDATE.
  'duePeriod',
  'recurrence',
  'completedAt',
] as const;

export const LIST_PATCH_FIELDS = ['name', 'color', 'order', 'archived'] as const;

export const EVENT_PATCH_FIELDS = [
  'listId',
  'title',
  'notes',
  'startAt',
  'endAt',
  'allDay',
] as const;

export type TaskPatchField = (typeof TASK_PATCH_FIELDS)[number];
export type ListPatchField = (typeof LIST_PATCH_FIELDS)[number];
export type EventPatchField = (typeof EVENT_PATCH_FIELDS)[number];

/**
 * Domain field → SQL column. SQLite builds SET clauses from this allowlist,
 * never from caller-supplied strings, so values always go through `?`.
 */
export const TASK_FIELD_COLUMNS: Record<TaskPatchField, string> = {
  listId: 'list_id',
  title: 'title',
  notes: 'notes',
  status: 'status',
  important: 'important',
  urgent: 'urgent',
  dueAt: 'due_at',
  dueDate: 'due_date',
  allDay: 'all_day',
  duePeriod: 'due_period',
  recurrence: 'recurrence',
  completedAt: 'completed_at',
};

export const LIST_FIELD_COLUMNS: Record<ListPatchField, string> = {
  name: 'name',
  color: 'color',
  // `order` is a SQL keyword: it must stay quoted everywhere it is emitted,
  // or SQLite rejects the statement with `near "order": syntax error`.
  order: '"order"',
  archived: 'archived',
};

export const EVENT_FIELD_COLUMNS: Record<EventPatchField, string> = {
  listId: 'list_id',
  title: 'title',
  notes: 'notes',
  startAt: 'start_at',
  endAt: 'end_at',
  allDay: 'all_day',
};

/** SQLite has no boolean type; encode booleans as 0/1 at the boundary. */
export function encodeSqlValue(value: unknown): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * Task field → SQL parameter value.
 *
 * `recurrence` is a structured value; the column stores its canonical JSON
 * (or NULL). This is the ONE place that conversion happens for updates, and
 * `taskToRow`/`rowToTask` do the same for full-row reads/writes, so the two
 * paths can never disagree' about the stored representation.
 */
export function encodeTaskFieldValue(field: string, value: unknown): unknown {
  if (field === 'recurrence') {
    return encodeRecurrenceValue(value as Recurrence | null | undefined);
  }
  return encodeSqlValue(value);
}

/**
 * Collect the caller-provided keys of a patch that are on the allowlist.
 * `undefined` means "not provided" and is skipped, which makes `{}` and
 * `{ title: undefined }` no-ops instead of writing NULL.
 *
 * `encode` defaults to the boolean-only encoder; the SQLite task repository
 * passes `encodeTaskFieldValue` so structured fields are serialized.
 */
export function buildAssignments(
  fields: readonly string[],
  columns: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, unknown>>,
  encode: (field: string, value: unknown) => unknown = (_field, value) => encodeSqlValue(value),
): { readonly set: readonly string[]; readonly values: readonly unknown[] } {
  const set: string[] = [];
  const values: unknown[] = [];
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined) continue;
    set.push(`${columns[field]!} = ?`);
    values.push(encode(field, value));
  }
  return { set, values };
}

/** Narrow a task patch for the generic assignment builder. */
export function taskPatchRecord(patch: TaskPatch): Record<string, unknown> {
  return patch as Record<string, unknown>;
}
