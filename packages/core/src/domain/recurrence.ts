/**
 * Recurrence — a small, explicit schedule model (no RRULE parser).
 *
 * Supports exactly the three shapes the product needs:
 *   - every N days
 *   - every N weeks on chosen weekdays
 *   - every N months on a chosen day of the month
 *
 * Weekdays use the app-wide convention from `shared/date.ts`: Monday = 0 …
 * Sunday = 6 (`dayOfWeek()` returns the same numbering), so callers never have
 * to translate between two conventions.
 *
 * Everything here is pure calendar-day arithmetic (Temporal via `date.ts`):
 * no instants, no time zone, no clock, no storage. `nextOccurrence` is bounded:
 * an invalid rule (hand-edited database, bad import) yields `null` instead of
 * looping, and `until` stops the series.
 */
import type { LocalDate, Recurrence } from './types.js';
import { addDays, addMonths, startOfMonth, startOfWeek } from '../shared/date.js';

/**
 * Re-exported so `domain/recurrence.ts` remains the single entry point for
 * recurrence concerns; the value types themselves live in `domain/types.ts`
 * (no import cycle: this module depends on types, never the reverse).
 */
export type {
  DailyRecurrence,
  MonthlyRecurrence,
  Recurrence,
  RecurrenceFrequency,
  Weekday,
  WeeklyRecurrence,
} from './types.js';

/** Upper bound on `interval` — keeps absurd rules from overflowing Temporal. */
export const MAX_RECURRENCE_INTERVAL = 999;

/** How many months a monthly search may inspect before giving up. */
const MAX_MONTHS_TRIED = 120;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real `"YYYY-MM-DD"` calendar date. Rejects both wrong shapes and
 * impossible dates such as `2026-02-31`. Uses only the built-in `Date`, so it
 * does not require Temporal to be initialised (validation may run during boot).
 */
export function isLocalDateString(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_RECURRENCE_INTERVAL
  );
}

/**
 * Structural validation for a persisted / imported recurrence value.
 *
 * This is the single gate both adapters and the backup parser use, so a rule
 * that reaches `nextOccurrence` is always shaped correctly (it may still be
 * logically exhausted, e.g. `until` in the past).
 */
export function isValidRecurrence(value: unknown): value is Recurrence {
  if (!isRecord(value)) return false;
  if (!validInterval(value['interval'])) return false;

  const until = value['until'];
  if (until !== undefined && until !== null && !isLocalDateString(until)) return false;

  switch (value['frequency']) {
    case 'daily':
      return true;
    case 'weekly': {
      const weekdays = value['weekdays'];
      if (!Array.isArray(weekdays) || weekdays.length === 0) return false;
      const seen = new Set<number>();
      for (const weekday of weekdays) {
        if (
          typeof weekday !== 'number' ||
          !Number.isInteger(weekday) ||
          weekday < 0 ||
          weekday > 6 ||
          seen.has(weekday)
        ) {
          return false;
        }
        seen.add(weekday);
      }
      return true;
    }
    case 'monthly': {
      const monthDay = value['monthDay'];
      return (
        typeof monthDay === 'number' &&
        Number.isInteger(monthDay) &&
        monthDay >= 1 &&
        monthDay <= 31
      );
    }
    default:
      return false;
  }
}

/**
 * The occurrence strictly after `from`, or `null` when the series is exhausted
 * (`until` passed) or the rule is malformed.
 *
 * `from` is the local date of the occurrence just completed / currently
 * scheduled. For weekly rules the week containing `from` always counts, and
 * subsequent occurrences land every `interval` weeks after that week.
 */
export function nextOccurrence(
  rule: Recurrence | null | undefined,
  from: LocalDate,
): LocalDate | null {
  // `nextOccurrence` never returns `from` itself; a rule that starts today is
  // "the next one after today". Callers that need "is this very day an
  // occurrence" must compare against the stored date themselves.
  if (!isValidRecurrence(rule)) return null;
  if (!isLocalDateString(from)) return null;

  const until = rule.until ?? null;

  switch (rule.frequency) {
    case 'daily': {
      const candidate = addDays(from, rule.interval);
      return until !== null && candidate > until ? null : candidate;
    }
    case 'weekly': {
      // Monday-first week of the current occurrence.
      const anchorWeek = startOfWeek(from);
      const weekdays = [...new Set(rule.weekdays)].sort((a, b) => a - b);

      // Remaining selected days later in the same week.
      for (const weekday of weekdays) {
        const candidate = addDays(anchorWeek, weekday);
        if (candidate <= from) continue;
        return until !== null && candidate > until ? null : candidate;
      }

      // Otherwise jump a whole number of weeks to the next qualifying week.
      const nextWeek = addDays(anchorWeek, 7 * rule.interval);
      const candidate = addDays(nextWeek, weekdays[0]!);
      return until !== null && candidate > until ? null : candidate;
    }
    case 'monthly': {
      const monthStart = startOfMonth(from);
      for (let step = 0; step <= MAX_MONTHS_TRIED; step++) {
        const base = addMonths(monthStart, step * rule.interval);
        const candidate = addDays(base, rule.monthDay - 1);
        // `addDays` rolls over when the month is shorter (e.g. 31 Feb).
        if (candidate.slice(0, 7) !== base.slice(0, 7)) continue;
        if (candidate <= from) continue;
        return until !== null && candidate > until ? null : candidate;
      }
      return null;
    }
  }
}

/**
 * The occurrence strictly before `from`, or `null` when none can be built.
 *
 * The mirror of `nextOccurrence`, and the reason it exists: repairing the old
 * click-to-roll corruption means walking a known-bad future date *backwards*
 * until it reaches today. Walking forward cannot do that.
 *
 * Grid semantics match `nextOccurrence` exactly, so the two can be alternated
 * without changing which dates a rule treats as occurrences.
 */
export function previousOccurrence(
  rule: Recurrence | null | undefined,
  from: LocalDate,
): LocalDate | null {
  if (!isValidRecurrence(rule)) return null;
  if (!isLocalDateString(from)) return null;

  switch (rule.frequency) {
    case 'daily':
      return addDays(from, -rule.interval);
    case 'weekly': {
      const anchorWeek = startOfWeek(from);
      const weekdays = [...new Set(rule.weekdays)].sort((a, b) => a - b);
      // Remaining selected days earlier in the same week, latest first.
      for (let index = weekdays.length - 1; index >= 0; index--) {
        const candidate = addDays(anchorWeek, weekdays[index]!);
        if (candidate < from) return candidate;
      }
      const previousWeek = addDays(anchorWeek, -7 * rule.interval);
      return addDays(previousWeek, weekdays[weekdays.length - 1]!);
    }
    case 'monthly': {
      const monthStart = startOfMonth(from);
      for (let step = 1; step <= MAX_MONTHS_TRIED; step++) {
        const base = addMonths(monthStart, -step * rule.interval);
        const candidate = addDays(base, rule.monthDay - 1);
        // `addDays` rolls over when the month is shorter (e.g. 31 Feb).
        if (candidate.slice(0, 7) !== base.slice(0, 7)) continue;
        if (candidate >= from) continue;
        return candidate;
      }
      return null;
    }
  }
}

