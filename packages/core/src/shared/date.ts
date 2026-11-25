/**
 * Date/time helpers — Temporal-backed.
 *
 * Boundaries stay plain strings so persistence and JSON remain trivial:
 *   - `LocalDate` is "YYYY-MM-DD" (timezone-free calendar day).
 *   - `Instant`   is an ISO-8601 UTC string (sortable in SQLite).
 * Each function converts to `Temporal.PlainDate` / `Temporal.Instant` at the top
 * and formats back to the boundary string at the bottom. No `Date.parse`, no
 * hand-built ISO strings, no string arithmetic.
 *
 * ## Time zone
 * This is a local-first, single-machine app, so "local" is the machine's zone.
 * `APP_TIME_ZONE` is resolved once at module load. All wall-clock conversions
 * (local midnight, "today", instant → local date) use it, and Temporal resolves
 * DST transitions for us.
 *
 * ## Temporal availability
 * Native Temporal is Chrome 144+ / Firefox 139+ only (not Safari). The helpers
 * here are synchronous, so on engines without native Temporal the app shell MUST
 * `await initTemporal()` once — before the first render, and before calling any
 * helper in this module. See `temporal-runtime.ts`.
 */
/// <reference path="../types/temporal.d.ts" />
import type { Instant, LocalDate } from '../domain/types.js';
import { getTemporal } from './temporal-runtime.js';

export { hasNativeTemporal, initTemporal } from './temporal-runtime.js';

/**
 * IANA name of the machine's time zone, resolved once at module load
 * (e.g. "Asia/Shanghai"). "local-first on one machine" means this is the
 * app-wide wall clock.
 */
export const APP_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Format an Instant as a UTC ISO-8601 string with millisecond precision. */
function formatInstant(value: Temporal.Instant): Instant {
  return value.toString({ fractionalSecondDigits: 3 }) as Instant;
}

/**
 * The local calendar day containing `instant`, in the app time zone.
 * An optional `timeZone` overrides the app zone (useful for tests).
 */
export function localDateOf(instant: Instant, timeZone: string = APP_TIME_ZONE): LocalDate {
  const T = getTemporal();
  return T.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString() as LocalDate;
}

/** Local midnight for a date as an instant. Correct across DST transitions. */
export function startOfDay(date: LocalDate): Instant {
  const T = getTemporal();
  const zoned = T.PlainDate.from(date).toZonedDateTime({
    timeZone: APP_TIME_ZONE,
    plainTime: '00:00',
  });
  return formatInstant(zoned.toInstant());
}

/** Exclusive end of a local date: midnight starting the next day. */
export function endOfDay(date: LocalDate): Instant {
  return startOfDay(addDays(date, 1));
}

/**
 * A wall-clock time on a local date, bound to the app time zone.
 *
 * This is the one supported way to turn "2026-09-06" + "14:30" into an
 * `Instant`. Hand-building `${date}T${time}` and parsing it (what the UI used
 * to do) relies on the engine using the local zone, which is not guaranteed
 * and breaks on DST boundaries; Temporal resolves both for us.
 *
 * `time` is "HH:MM" (24-hour). An invalid value throws — better a loud failure
 * at the service boundary than a silently wrong instant in storage.
 */
export function instantAtLocal(date: LocalDate, time: string): Instant {
  const T = getTemporal();
  const zoned = T.PlainDate.from(date).toZonedDateTime({
    timeZone: APP_TIME_ZONE,
    plainTime: time,
  });
  return formatInstant(zoned.toInstant());
}

/** Today's local date. The one place that reads the wall clock for display. */
export function todayLocal(): LocalDate {
  const T = getTemporal();
  return T.Now.plainDateISO(APP_TIME_ZONE).toString() as LocalDate;
}

/** Pure calendar-day arithmetic (no time zone, no DST surprises). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const T = getTemporal();
  return T.PlainDate.from(date).add({ days }).toString() as LocalDate;
}

/**
 * Pure calendar-month arithmetic. Temporal clamps the day to the target
 * month's length (e.g. Jan 31 + 1 month = Feb 28/29), which is the behavior
 * monthly recurrence walks around explicitly by checking the resulting month.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const T = getTemporal();
  return T.PlainDate.from(date).add({ months }).toString() as LocalDate;
}

/** First day of the calendar month containing `date`. */
export function startOfMonth(date: LocalDate): LocalDate {
  const T = getTemporal();
  const pd = T.PlainDate.from(date);
  return pd.add({ days: -(pd.day - 1) }).toString() as LocalDate;
}

/** Monday-first start of the ISO week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  const T = getTemporal();
  const pd = T.PlainDate.from(date);
  return pd.add({ days: -(pd.dayOfWeek - 1) }).toString() as LocalDate;
}

/** Every local date from `from` to `to`, inclusive on both ends. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const T = getTemporal();
  const end = T.PlainDate.from(to);
  const out: LocalDate[] = [];
  let cur = T.PlainDate.from(from);
  while (T.PlainDate.compare(cur, end) <= 0) {
    out.push(cur.toString() as LocalDate);
    cur = cur.add({ days: 1 });
  }
  return out;
}

/** Day index within a Monday-first week: Monday = 0 … Sunday = 6. */
export function dayOfWeek(date: LocalDate): number {
  const T = getTemporal();
  return T.PlainDate.from(date).dayOfWeek - 1;
}
