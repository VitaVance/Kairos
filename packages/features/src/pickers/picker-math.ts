/**
 * Pure helpers behind the custom date/time pickers — no DOM, no React.
 *
 * Dates are core `LocalDate` strings ("YYYY-MM-DD") and are moved ONLY with
 * core's Temporal-backed helpers (`addDays`, `addMonths`, `startOfWeek`,
 * `dayOfWeek`, `daysFromToday`). Nothing here hand-rolls `Date` arithmetic.
 * Month/year keys are parsed with `slice()` because they are not instants.
 */
import type { DuePeriod, LocalDate } from '@todolist/core';
import { addDays, addMonths, dayOfWeek, daysFromToday, startOfWeek } from '@todolist/core';

/** The half-day suffix used by both `formatDue` and the picker trigger. */
export const PERIOD_LABEL: Record<DuePeriod, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

export interface MonthKey {
  year: number;
  /** 1–12. */
  month: number;
}

/** Monday-first weekday labels, index = `dayOfWeek(date)` (Monday = 0). */
export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;
export const WEEKDAY_LONG = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

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

/** `2026年11月` — the popover's month heading. */
export function formatMonthHeading(key: MonthKey): string {
  return `${key.year}年${key.month}月`;
}

/** `2026年11月24日 周二` — accessible name for one day cell. */
export function formatDayLabel(date: LocalDate): string {
  const weekday = WEEKDAY_LONG[dayOfWeek(date)] ?? '';
  return `${yearOf(date)}年${monthOf(date)}月${dayOf(date)}日 ${weekday}`;
}

/**
 * Friendly date label, and the single source of the wording every task
 * surface uses (`formatDue` delegates here):
 *   今天 / 明天 / 后天 / 昨天 / 11月24日 / 2027年3月5日
 * A half-day task appends ` · 上午` / ` · 下午` / ` · 晚上`.
 */
export function formatFriendlyDate(
  date: LocalDate,
  today: LocalDate,
  period: DuePeriod | null = null,
): string {
  const diff = daysFromToday(date, today);
  const base =
    diff === 0
      ? '今天'
      : diff === 1
        ? '明天'
        : diff === 2
          ? '后天'
          : diff === -1
            ? '昨天'
            : yearOf(date) === yearOf(today)
              ? `${monthOf(date)}月${dayOf(date)}日`
              : `${yearOf(date)}年${monthOf(date)}月${dayOf(date)}日`;
  return period === null ? base : `${base} · ${PERIOD_LABEL[period]}`;
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
