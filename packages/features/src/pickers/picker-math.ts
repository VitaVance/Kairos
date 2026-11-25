/**
 * Pure helpers behind the custom date/time pickers — no DOM, no React.
 *
 * Dates are core `LocalDate` strings ("YYYY-MM-DD") and are moved ONLY with
 * core's Temporal-backed helpers (`addDays`, `addMonths`, `startOfWeek`,
 * `dayOfWeek`, `daysFromToday`). Nothing here hand-rolls `Date` arithmetic.
 * Month/year keys are parsed with `slice()` because they are not instants.
 *
 * Wording is locale-aware and comes from `Intl`, never a concatenation of
 * translated fragments. The friendly date deliberately mirrors
 * `formatDueDate` in `task/due-label.ts`:
 *   - relative days (`-1 … +2`) via `Intl.RelativeTimeFormat` — 今天/明天/后天/
 *     昨天 ↔ Today/Tomorrow/in 2 days/Yesterday;
 *   - any other date via `Intl.DateTimeFormat` — 11月24日 ↔ Nov 24 (the year is
 *     added only when it differs from `today`).
 * A half-day label appends the bucket through the `task` namespace's
 * `due.withPeriod` message, exactly as `formatDue` does.
 */
import type { DuePeriod, LocalDate } from '@todolist/core';
import { addDays, addMonths, daysFromToday, startOfWeek } from '@todolist/core';
import { currentLanguage, i18n } from '@todolist/ui';
import { formatMonthName, formatMonthYear, weekdayLabels } from '../calendar/time-math';
import { periodLabel } from '../task/due-label';

export interface MonthKey {
  year: number;
  /** 1–12. */
  month: number;
}

/**
 * Monday-first weekday labels for the active locale, index = `dayOfWeek(date)`
 * (Monday = 0). Shares the calendar's single weekday generator so the picker
 * grid and the calendar surfaces never disagree.
 */
export function weekdayShort(lng: string = currentLanguage()): string[] {
  return weekdayLabels('short', lng);
}

/**
 * Full weekday names for the column headers' accessible label. Built from the
 * same Monday anchor as `weekdayLabels` so the order cannot drift.
 */
export function weekdayLong(lng: string = currentLanguage()): string[] {
  const fmt = new Intl.DateTimeFormat(lng, { weekday: 'long', timeZone: 'UTC' });
  const monday = Date.UTC(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(monday + i * 86_400_000)));
}

/** 1–12 → the compact month button label: "Jan" (en) / "1月" (zh-CN). */
export function monthNames(lng: string = currentLanguage()): string[] {
  return Array.from({ length: 12 }, (_, index) => formatMonthName(index + 1, lng));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Build a `LocalDate` from numeric parts. */
export function ymd(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` as LocalDate;
}

export function yearOf(date: LocalDate): number {
  return Number(date.slice(0, 4));
}

export function monthOf(date: LocalDate): number {
  return Number(date.slice(5, 7));
}

export function dayOf(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

/** Calendar month containing `date`. */
export function monthKeyOf(date: LocalDate): MonthKey {
  return { year: yearOf(date), month: monthOf(date) };
}

/** First day of a month key. */
export function firstOfMonth(key: MonthKey): LocalDate {
  return ymd(key.year, key.month, 1);
}

/** Move a month key by `delta` months (Temporal does the carry). */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  return monthKeyOf(addMonths(firstOfMonth(key), delta));
}

function daysInMonth(key: MonthKey): number {
  const nextFirst = addMonths(firstOfMonth(key), 1);
  return dayOf(addDays(nextFirst, -1));
}

/** Clamp a preferred day number into the month key. */
export function dayInMonth(key: MonthKey, preferredDay: number): LocalDate {
  const max = daysInMonth(key);
  return ymd(key.year, key.month, Math.min(Math.max(1, preferredDay), max));
}

/** `November 2026` (en) / `2026年11月` (zh-CN) — the popover's month heading. */
export function formatMonthHeading(key: MonthKey, lng: string = currentLanguage()): string {
  return formatMonthYear(key.year, key.month, lng);
}

/** `2026` (en) / `2026年` (zh-CN) — the year shown in the jump panel. */
export function formatYearHeading(year: number, lng: string = currentLanguage()): string {
  return new Intl.DateTimeFormat(lng, { year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, 0, 1)),
  );
}

function parseLocalDate(date: LocalDate): Date {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** `Tuesday, November 24, 2026` (en) / `2026年11月24日星期二` — a day cell's name. */
export function formatDayLabel(date: LocalDate, lng: string = currentLanguage()): string {
  return new Intl.DateTimeFormat(lng, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parseLocalDate(date));
}

/**
 * Friendly date label, and the single source of the wording the picker trigger
 * uses: 今天 / 明天 / 后天 / 昨天 / 11月24日 / 2027年3月5日 ↔ Today / Tomorrow /
 * in 2 days / Yesterday / Nov 24 / Mar 5, 2027.
 * A half-day value appends ` · 上午` via the same message `formatDue` uses.
 */
export function formatFriendlyDate(
  date: LocalDate,
  today: LocalDate,
  period: DuePeriod | null = null,
  lng: string = currentLanguage(),
): string {
  const diff = daysFromToday(date, today);
  const base =
    diff >= -1 && diff <= 2
      ? capitalize(new Intl.RelativeTimeFormat(lng, { numeric: 'auto' }).format(diff, 'day'))
      : new Intl.DateTimeFormat(
          lng,
          date.slice(0, 4) === today.slice(0, 4)
            ? { month: 'short', day: 'numeric' }
            : { year: 'numeric', month: 'short', day: 'numeric' },
        ).format(parseLocalDate(date));
  if (period === null) return base;
  return i18n.getFixedT(lng, 'task')('due.withPeriod', {
    date: base,
    period: periodLabel(period, lng),
  });
}

/**
 * Intl returns lowercase 'today'/'tomorrow'/'yesterday'; a label that starts a
 * row should be capitalised. Multi-word forms ("in 2 days") stay as-is. Kept
 * identical to `task/due-label.ts` so the two never drift apart.
 */
function capitalize(value: string): string {
  return value.includes(' ') ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Next Monday strictly after this week — 下周一. */
export function nextMonday(today: LocalDate): LocalDate {
  return addDays(startOfWeek(today), 7);
}

const TIME_INPUT = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/;
const DIGITS = /^\d{1,4}$/;

/**
 * Parse a typed clock value into canonical `HH:MM`.
 *
 * Accepts `9:05`, `09:05`, `9：05`, `9`, `930`, `0930`. Returns null when the
 * hours or minutes are out of range or the text is not a time.
 */
export function parseTimeInput(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  let hours: number;
  let minutes: number;

  const colon = TIME_INPUT.exec(text);
  if (colon) {
    hours = Number(colon[1]);
    minutes = Number(colon[2]);
  } else if (DIGITS.test(text)) {
    if (text.length <= 2) {
      hours = Number(text);
      minutes = 0;
    } else if (text.length === 3) {
      hours = Number(text.slice(0, 1));
      minutes = Number(text.slice(1));
    } else {
      hours = Number(text.slice(0, 2));
      minutes = Number(text.slice(2));
    }
  } else {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return formatClock(hours, minutes);
}

/** `9, 5` → `09:05`. */
export function formatClock(hours: number, minutes: number): string {
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** Split `HH:MM` into numeric parts; malformed input falls back to 09:00. */
export function splitClock(value: string | null): { hours: number; minutes: number } {
  if (value === null) return { hours: 9, minutes: 0 };
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { hours: 9, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { hours: 9, minutes: 0 };
  return { hours, minutes };
}
