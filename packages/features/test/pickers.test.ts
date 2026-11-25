import { beforeAll, describe, expect, it } from 'vitest';
import type { LocalDate } from '@todolist/core';
import { initTemporal } from '@todolist/core';
import { initI18n } from '@todolist/ui';
import en from '../../ui/src/i18n/locales/en/pickers.json';
import zh from '../../ui/src/i18n/locales/zh-CN/pickers.json';
import {
  dayInMonth,
  formatClock,
  formatDayLabel,
  formatFriendlyDate,
  formatMonthHeading,
  formatYearHeading,
  monthKeyOf,
  monthNames,
  nextMonday,
  parseTimeInput,
  shiftMonth,
  splitClock,
  weekdayShort,
} from '../src/pickers/picker-math.js';

type Catalog = { readonly [key: string]: string | Catalog };

function leafPaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : leafPaths(value, path);
  });
}

const sorted = (list: string[]) => [...list].sort();

beforeAll(async () => {
  initI18n('en');
  await initTemporal();
});

const d = (value: string) => value as LocalDate;

describe('pickers namespace', () => {
  it('en and zh-CN have identical key paths', () => {
    expect(sorted(leafPaths(zh))).toEqual(sorted(leafPaths(en)));
  });

  it('zh-CN still reads the original wording', () => {
    const today = d('2026-11-24');
    expect(formatFriendlyDate(today, today, null, 'zh-CN')).toBe('今天');
    expect(formatFriendlyDate(d('2026-03-05'), today, 'evening', 'zh-CN')).toBe('3月5日 · 晚上');
    expect(formatMonthHeading({ year: 2026, month: 11 }, 'zh-CN')).toBe('2026年11月');
    expect(monthNames('zh-CN')).toEqual([
      '1月', '2月', '3月', '4月', '5月', '6月',
      '7月', '8月', '9月', '10月', '11月', '12月',
    ]);
  });
});

describe('friendly date labels', () => {
  // English is the source language for these assertions; zh-CN coverage lives
  // in the namespace block above so the catalog cannot silently lose a key.
  const today = d('2026-11-24');

  it('names adjacent days the way every other task surface does', () => {
    expect(formatFriendlyDate(today, today, null, 'en')).toBe('Today');
    expect(formatFriendlyDate(d('2026-11-25'), today, null, 'en')).toBe('Tomorrow');
    expect(formatFriendlyDate(d('2026-11-26'), today, null, 'en')).toBe('in 2 days');
    expect(formatFriendlyDate(d('2026-11-23'), today, null, 'en')).toBe('Yesterday');
  });

  it('shows M D inside the current year and the full year otherwise', () => {
    expect(formatFriendlyDate(d('2026-03-05'), today, null, 'en')).toBe('Mar 5');
    expect(formatFriendlyDate(d('2027-03-05'), today, null, 'en')).toBe('Mar 5, 2027');
  });

  it('appends the half-day bucket the same way formatDue does', () => {
    expect(formatFriendlyDate(today, today, 'morning', 'en')).toBe('Today · Morning');
    expect(formatFriendlyDate(d('2026-03-05'), today, 'evening', 'en')).toBe('Mar 5 · Evening');
    expect(formatFriendlyDate(today, today, null, 'en')).toBe('Today');
  });

  it('marks the weekday of a day cell (Monday-first)', () => {
    expect(formatDayLabel(d('2026-11-24'), 'en')).toBe('Tuesday, November 24, 2026');
    expect(formatDayLabel(d('2026-11-23'), 'en')).toBe('Monday, November 23, 2026');
    expect(formatDayLabel(d('2026-11-29'), 'en')).toBe('Sunday, November 29, 2026');
  });
});

describe('month navigation', () => {
  it('parses and formats a month key', () => {
    expect(monthKeyOf(d('2026-11-24'))).toEqual({ year: 2026, month: 11 });
    expect(formatMonthHeading({ year: 2026, month: 1 }, 'en')).toBe('January 2026');
    expect(formatYearHeading(2026, 'en')).toBe('2026');
  });

  it('shifts across a year boundary', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('clamps a carried day into the target month', () => {
    // Jan 31 → February has no 31st; clamp to the real last day.
    expect(dayInMonth({ year: 2026, month: 2 }, 31)).toBe('2026-02-28');
    expect(dayInMonth({ year: 2028, month: 2 }, 31)).toBe('2028-02-29');
    expect(dayInMonth({ year: 2026, month: 2 }, 0)).toBe('2026-02-01');
  });

  it('finds the Monday of next week', () => {
    // 2026-11-24 is a Tuesday; next week's Monday is the 30th.
    expect(nextMonday(d('2026-11-24'))).toBe('2026-11-30');
    // Called on a Monday, it still means the following Monday.
    expect(nextMonday(d('2026-11-23'))).toBe('2026-11-30');
  });

  it('labels weekdays Monday-first in both locales', () => {
    expect(weekdayShort('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayShort('zh-CN')).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
  });
});

describe('typed time input', () => {
  it('accepts padded, unpadded and full-width colons', () => {
    expect(parseTimeInput('09:05')).toBe('09:05');
    expect(parseTimeInput('9:05')).toBe('09:05');
    expect(parseTimeInput('9：05')).toBe('09:05');
  });

  it('accepts compact digit forms', () => {
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('930')).toBe('09:30');
    expect(parseTimeInput('0930')).toBe('09:30');
    expect(parseTimeInput('2359')).toBe('23:59');
  });

  it('rejects out-of-range or malformed values', () => {
    expect(parseTimeInput('24:00')).toBeNull();
    expect(parseTimeInput('09:60')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('abc')).toBeNull();
  });

  it('formats and splits clocks', () => {
    expect(formatClock(9, 5)).toBe('09:05');
    expect(splitClock('14:07')).toEqual({ hours: 14, minutes: 7 });
    // Malformed / absent values fall back to 09:00 rather than throwing.
    expect(splitClock(null)).toEqual({ hours: 9, minutes: 0 });
    expect(splitClock('bad')).toEqual({ hours: 9, minutes: 0 });
  });
});
