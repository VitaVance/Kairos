import type { Recurrence } from '@todolist/core';
import { isValidRecurrence } from '@todolist/core';

/**
 * Recurrence ⇄ SQLite TEXT codec.
 *
 * The column stores canonical JSON (or NULL). A fixed key order means two
 * rules that mean the same thing serialize to the same string, which keeps
 * rows and backups byte-stable; weekdays are sorted so `[4, 0]` and `[0, 4]`
 * collapse to one form.
 *
 * Encoding a malformed rule yields `null` rather than persisting garbage;
 * decoding anything unparseable/invalid also yields `null`, so a corrupt row
 * can never crash a list read.
 */

export function encodeRecurrenceValue(value: Recurrence | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isValidRecurrence(value)) return null;
  return JSON.stringify(canonicalRecurrence(value));
}

export function decodeRecurrenceValue(raw: unknown): Recurrence | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidRecurrence(parsed) ? canonicalRecurrence(parsed) : null;
}

/** Normalised copy of a valid rule: sorted weekdays, no `undefined` keys. */
function canonicalRecurrence(rule: Recurrence): Recurrence {
  const until = rule.until ?? null;

  switch (rule.frequency) {
    case 'daily':
      return { frequency: 'daily', interval: rule.interval, until };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: rule.interval,
        weekdays: [...new Set(rule.weekdays)].sort((a, b) => a - b),
        until,
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: rule.interval,
        monthDay: rule.monthDay,
        until,
      };
  }
}
