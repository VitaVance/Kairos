import type { LocalDate, Recurrence, Weekday } from '@todolist/core';
import { dayOfWeek } from '@todolist/core';
import { currentLanguage, i18n } from '@todolist/ui';

/**
 * Presentation helpers for the repeat picker. Pure and framework-free so the
 * wording and default-rule choices can be unit-tested without React.
 *
 * Every label is locale-aware: weekday names come from `Intl.DateTimeFormat`
 * (not a hardcoded 一…日 table) and the sentence shapes use i18next plural
 * keys, because English word order and pluralisation differ from Chinese.
 */

export type RecurrenceFrequencyChoice = 'none' | 'daily' | 'weekly' | 'monthly';

/** 2024-01-01 is a Monday; formatting Jan 1–7 gives a Monday-first week. */
const WEEK_START_UTC = Date.UTC(2024, 0, 1);

/**
 * Weekday labels in the same Monday-first order as `weekdays` (0 = Monday),
 * derived from the active locale: 周一/一 ↔ Mon/M.
 */
export function weekdayLabels(lng: string = currentLanguage()): string[] {
  const formatter = new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(WEEK_START_UTC + index * 86_400_000)),
  );
}

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

const UNIT_KEYS = {
  daily: 'repeat.unit.daily',
  weekly: 'repeat.unit.weekly',
  monthly: 'repeat.unit.monthly',
} as const;

/** The unit word that follows the interval number (Every 2 `weeks`). */
export function intervalUnit(
  frequency: Recurrence['frequency'],
  lng: string = currentLanguage(),
  count = 1,
): string {
  return i18n.getFixedT(lng, 'task')(UNIT_KEYS[frequency], { count });
}

function formatUntil(until: LocalDate, lng: string): string {
  const date = new Date(
    Number(until.slice(0, 4)),
    Number(until.slice(5, 7)) - 1,
    Number(until.slice(8, 10)),
  );
  return new Intl.DateTimeFormat(lng, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/**
 * One-line summary used in the picker's hint (每天 / 每周 周一、周三 /
 * 每月 15 日 ↔ Every day / Every week on Mon, Wed / Every month on day 15).
 * The sentence shapes are plural keys so English reads naturally while Chinese
 * keeps its word order.
 */
export function describeRecurrence(
  rule: Recurrence,
  lng: string = currentLanguage(),
): string {
  const t = i18n.getFixedT(lng, 'task');
  const separator = t('repeat.daySeparator');

  let core: string;
  switch (rule.frequency) {
    case 'daily':
      core =
        rule.interval === 1
          ? t('repeat.every.day')
          : t('repeat.every.everyNDays', { count: rule.interval });
      break;
    case 'weekly': {
      const days = [...new Set(rule.weekdays)]
        .sort((a, b) => a - b)
        .map((weekday) => weekdayLabels(lng)[weekday] ?? '')
        .join(separator);
      core =
        rule.interval === 1
          ? t('repeat.every.week', { days })
          : t('repeat.every.everyNWeeks', { count: rule.interval, days });
      break;
    }
    case 'monthly':
      core =
        rule.interval === 1
          ? t('repeat.every.month', { day: rule.monthDay })
          : t('repeat.every.everyNMonths', { count: rule.interval, day: rule.monthDay });
      break;
  }

  return rule.until ? t('repeat.until', { rule: core, date: formatUntil(rule.until, lng) }) : core;
}
