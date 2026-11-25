import type { LocalDate, Task } from '@todolist/core';
import { formatFriendlyDate } from '../pickers/picker-math';

/**
 * Pure due-date label shared by every task surface.
 * Wording (今天 / 明天 / 后天 / 昨天 / M月D日, plus the 上午/下午/晚上 suffix)
 * lives in `formatFriendlyDate`, which the date picker trigger uses too, so
 * the panel, the list rows and the picker can never drift apart.
 * Returns an empty string when the task has no due date.
 */
export function formatDue(task: Pick<Task, 'dueDate' | 'duePeriod'>, today: LocalDate): string {
  if (task.dueDate === null) return '';
  return formatFriendlyDate(task.dueDate, today, task.duePeriod);
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
