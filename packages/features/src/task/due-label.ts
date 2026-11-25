import type { DuePeriod, LocalDate, Task } from '@todolist/core';
import { daysFromToday } from '@todolist/core';
import { currentLanguage, i18n } from '@todolist/ui';

/**
 * Pure due-date label shared by every task surface.
 *
 * Wording is locale-aware and comes from `Intl`, never a concatenation of
 * translated fragments:
 *   - relative days (`-1 … +2`) via `Intl.RelativeTimeFormat` — 今天/明天/后天/
 *     昨天 ↔ Today/Tomorrow/in 2 days/Yesterday;
 *   - any other date via `Intl.DateTimeFormat` — 11月24日 ↔ Nov 24 (the year is
 *     added only when it differs from `today`).
 * A half-day task appends the bucket through the `due.withPeriod` message.
 *
 * `daysFromToday` still does the arithmetic; only presentation moved to Intl.
 * Returns an empty string when the task has no due date.
 */
export function formatDue(
  task: Pick<Task, 'dueDate' | 'duePeriod'>,
  today: LocalDate,
  lng: string = currentLanguage(),
): string {
  if (task.dueDate === null) return '';
  const base = formatDueDate(task.dueDate, today, lng);
  if (task.duePeriod === null) return base;
  const t = i18n.getFixedT(lng, 'task');
  return t('due.withPeriod', { date: base, period: periodLabel(task.duePeriod, lng) });
}

const PERIOD_KEYS: Record<DuePeriod, 'period.morning' | 'period.afternoon' | 'period.evening'> = {
  morning: 'period.morning',
  afternoon: 'period.afternoon',
  evening: 'period.evening',
};

/** The localized half-day bucket label (上午/下午/晚上 ↔ Morning/Afternoon/Evening). */
export function periodLabel(period: DuePeriod, lng: string = currentLanguage()): string {
  return i18n.getFixedT(lng, 'task')(PERIOD_KEYS[period]);
}

function parseLocalDate(date: LocalDate): Date {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/**
 * The date part of `formatDue` without the half-day suffix. Exported so the
 * detail panel's grey echo can compose the same wording as the rows.
 */
export function formatDueDate(
  date: LocalDate,
  today: LocalDate,
  lng: string = currentLanguage(),
): string {
  const diff = daysFromToday(date, today);
  if (diff >= -1 && diff <= 2) {
    const relative = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' }).format(diff, 'day');
    // Intl returns lowercase 'today'/'tomorrow'/'yesterday'; a label that starts
    // a row should be capitalised. Multi-word forms ("in 2 days") stay as-is.
    return relative.includes(' ') ? relative : relative.charAt(0).toUpperCase() + relative.slice(1);
  }
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat(lng, options).format(parseLocalDate(date));
}

export interface QuickAddResult {
  /** Input with `/重要`, `/紧急` and a trailing valid `@HH:MM` removed. */
  readonly title: string;
  readonly important: boolean;
  readonly urgent: boolean;
  /** Set to `today` only when a valid trailing time token was parsed. */
  readonly dueDate: LocalDate | null;
  /** 24-hour `HH:MM`, or null when absent/invalid. */
  readonly dueTime: string | null;
}

const TRAILING_TIME = /@(\d{1,2}):(\d{2})\s*$/;

/**
 * Parses the compact syntax used by `QuickAdd`:
 *   - `/重要` sets important
 *   - `/紧急` sets urgent
 *   - trailing `@14:00` sets a due time today
 *
 * The token syntax is intentionally language-agnostic (the parser is not being
 * made multilingual in this pass); only the surrounding placeholder/help text
 * is localized.
 *
 * Pure and synchronous. A malformed time token (e.g. `@99:99`) is ignored:
 * it yields no due date/time and stays in the title rather than being
 * silently deleted.
 */
export function parseQuickAdd(input: string, today: LocalDate): QuickAddResult {
  const important = input.includes('/重要');
  const urgent = input.includes('/紧急');

  let rest = input.replace(/\/重要/g, ' ').replace(/\/紧急/g, ' ');

  let dueDate: LocalDate | null = null;
  let dueTime: string | null = null;

  const match = TRAILING_TIME.exec(rest);
  if (match) {
    const hoursText = match[1];
    const minutesText = match[2];
    if (hoursText !== undefined && minutesText !== undefined) {
      const hours = Number(hoursText);
      const minutes = Number(minutesText);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        dueTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        dueDate = today;
        rest = rest.slice(0, match.index);
      }
    }
  }

  return {
    title: rest.replace(/\s+/g, ' ').trim(),
    important,
    urgent,
    dueDate,
    dueTime,
  };
}
