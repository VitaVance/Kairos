import { beforeAll, describe, expect, it } from 'vitest';
import type { LocalDate } from '@todolist/core';
import { initTemporal } from '@todolist/core';
import {
  dayInMonth,
  formatClock,
  formatDayLabel,
  formatFriendlyDate,
  formatMonthHeading,
  monthKeyOf,
  nextMonday,
  parseTimeInput,
  shiftMonth,
  splitClock,
} from '../src/pickers/picker-math.js';

beforeAll(async () => {
  await initTemporal();
});

const d = (value: string) => value as LocalDate;

describe('friendly date labels', () => {
  const today = d('2026-11-24');

  it('names adjacent days the way every other task surface does', () => {
    expect(formatFriendlyDate(today, today)).toBe('今天');
    expect(formatFriendlyDate(d('2026-11-25'), today)).toBe('明天');
    expect(formatFriendlyDate(d('2026-11-26'), today)).toBe('后天');
    expect(formatFriendlyDate(d('2026-11-23'), today)).toBe('昨天');
  });

  it('shows M月D日 inside the current year and the full year otherwise', () => {
    expect(formatFriendlyDate(d('2026-03-05'), today)).toBe('3月5日');
    expect(formatFriendlyDate(d('2027-03-05'), today)).toBe('2027年3月5日');
  });

  it('appends the half-day bucket the same way formatDue does', () => {
    expect(formatFriendlyDate(today, today, 'morning')).toBe('今天 · 上午');
    expect(formatFriendlyDate(d('2026-03-05'), today, 'evening')).toBe('3月5日 · 晚上');
    expect(formatFriendlyDate(today, today, null)).toBe('今天');
  });

  it('marks the weekday of a day cell (Monday-first)', () => {
    expect(formatDayLabel(d('2026-11-24'))).toBe('2026年11月24日 周二');
    expect(formatDayLabel(d('2026-11-23'))).toBe('2026年11月23日 周一');
    expect(formatDayLabel(d('2026-11-29'))).toBe('2026年11月29日 周日');
  });
});

describe('month navigation', () => {
  it('parses and formats a month key', () => {
    expect(monthKeyOf(d('2026-11-24'))).toEqual({ year: 2026, month: 11 });
    expect(formatMonthHeading({ year: 2026, month: 1 })).toBe('2026年1月');
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
