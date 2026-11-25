import type { LocalDate, Recurrence, Weekday } from '@todolist/core';
import { dayOfWeek } from '@todolist/core';

/**
 * Presentation helpers for the repeat picker. Pure and framework-free so the
 * wording and default-rule choices can be unit-tested without React.
 */

/** Weekday labels in the same Monday-first order as `weekdays` (0 = 周一). */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export type RecurrenceFrequencyChoice = 'none' | 'daily' | 'weekly' | 'monthly';

/**
 * A sensible starting rule when the user switches the picker to `frequency`:
 * interval 1, no end date, and — for weekly/monthly — anchored on the task's
 * due date (or today when it has none) so the first roll lands on a familiar
 * day.
 */
export function defaultRecurrence(
  frequency: Exclude<RecurrenceFrequencyChoice, 'none'>,
  anchor: LocalDate,
): Recurrence {
  switch (frequency) {
    case 'daily':
      return { frequency: 'daily', interval: 1, until: null };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: [dayOfWeek(anchor) as Weekday],
        until: null,
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: 1,
        monthDay: Number(anchor.slice(8, 10)),
        until: null,
      };
  }
}

/** The unit word that follows "每 N …" for a frequency. */
export function intervalUnit(frequency: Recurrence['frequency']): string {
  switch (frequency) {
    case 'daily':
      return '天';
    case 'weekly':
      return '周';
    case 'monthly':
      return '个月';
  }
}

/**
 * One-line summary used in the picker's hint (`每天` / `每周 一、三` /
 * `每月 15 日`). Exported for tests and reuse by list surfaces.
 */
export function describeRecurrence(rule: Recurrence): string {
  const every = rule.interval === 1 ? '每' : `每 ${rule.interval} `;

  let core: string;
  switch (rule.frequency) {
    case 'daily':
      core = rule.interval === 1 ? '每天' : `每 ${rule.interval} 天`;
      break;
    case 'weekly': {
      const days = [...new Set(rule.weekdays)]
        .sort((a, b) => a - b)
        .map((weekday) => WEEKDAY_LABELS[weekday] ?? '')
        .join('、');
      core = `${every}周 ${days}`;
      break;
    }
    case 'monthly':
      core = rule.interval === 1 ? `每月 ${rule.monthDay} 日` : `每 ${rule.interval} 个月的 ${rule.monthDay} 日`;
      break;
  }

  return rule.until ? `${core}，直到 ${rule.until}` : core;
}
