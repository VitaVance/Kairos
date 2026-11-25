import { describe, expect, it } from 'vitest';
import type { Instant, LocalDate } from '@todolist/core';
import {
  precisionChoiceOf,
  scheduleForChoice,
  scheduleForPrecision,
  scheduleHint,
} from '../src/task/TaskDetailPanel';

const TODAY = '2026-09-06' as LocalDate;
const MIDNIGHT = '2026-09-05T16:00:00.000Z' as Instant;
const AFTERNOON = '2026-09-06T06:30:00.000Z' as Instant;
/** The local wall clock `AFTERNOON` shows, derived the same way the panel does. */
const AFTERNOON_CLOCK = (() => {
  const d = new Date(AFTERNOON);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
})();

/**
 * The pure scheduling logic behind the detail panel's five-way control.
 *
 * `scheduleForChoice` is exactly what `onPrecisionChange` calls, so asserting
 * on it covers §4.3 rules 1 (auto-adopt today), 3 (09:00 seed) and 4 (one
 * write when leaving 具体时间); `scheduleForPrecision` covers the two date /
 * clock edits. The component renders these values directly.
 */
describe('scheduleForPrecision — the four mapping paths', () => {
  it('maps 全天 to a day schedule', () => {
    expect(scheduleForPrecision('day', TODAY, '09:00')).toEqual({ kind: 'day', date: TODAY });
  });

  it.each(['morning', 'afternoon', 'evening'] as const)(
    'maps %s to a period schedule',
    (period) => {
      expect(scheduleForPrecision(period, TODAY, '09:00')).toEqual({
        kind: 'period',
        date: TODAY,
        period,
      });
    },
  );

  it('maps 具体时间 to a time schedule carrying the clock', () => {
    expect(scheduleForPrecision('time', TODAY, '14:30')).toEqual({
      kind: 'time',
      date: TODAY,
      time: '14:30',
    });
  });
});

describe('scheduleForChoice — interaction rules', () => {
  const none = { dueDate: null, dueAt: null, allDay: false, duePeriod: null } as const;

  it('adopts today when the task has no date yet (rule 1)', () => {
    expect(scheduleForChoice(none, 'morning', TODAY)).toEqual({
      kind: 'period',
      date: TODAY,
      period: 'morning',
    });
    expect(scheduleForChoice(none, 'day', TODAY)).toEqual({ kind: 'day', date: TODAY });
  });

  it('adopts today even for 全天, matching the old checkbox behaviour', () => {
    expect(scheduleForChoice(none, 'day', TODAY)).toEqual({ kind: 'day', date: TODAY });
  });

  it('keeps the existing date when there is one', () => {
    const task = { dueDate: '2026-10-01' as LocalDate, dueAt: MIDNIGHT, allDay: true, duePeriod: null };
    expect(scheduleForChoice(task, 'afternoon', TODAY)).toEqual({
      kind: 'period',
      date: '2026-10-01' as LocalDate,
      period: 'afternoon',
    });
  });

  it('seeds 09:00 when switching to 具体时间 with no clock (rule 3)', () => {
    const task = { dueDate: TODAY, dueAt: MIDNIGHT, allDay: true, duePeriod: null };
    expect(scheduleForChoice(task, 'time', TODAY)).toEqual({
      kind: 'time',
      date: TODAY,
      time: '09:00',
    });
  });

  it('reuses the stored clock when the task already has one', () => {
    const task = { dueDate: TODAY, dueAt: AFTERNOON, allDay: false, duePeriod: null };
    expect(scheduleForChoice(task, 'time', TODAY)).toEqual({
      kind: 'time',
      date: TODAY,
      time: AFTERNOON_CLOCK,
    });
  });

  it('leaves 具体时间 in one write when switching back to a bucket (rule 4)', () => {
    const task = { dueDate: TODAY, dueAt: AFTERNOON, allDay: false, duePeriod: null };
    // One union value: no separate "clear the clock" step.
    expect(scheduleForChoice(task, 'morning', TODAY)).toEqual({
      kind: 'period',
      date: TODAY,
      period: 'morning',
    });
  });
});

describe('precisionChoiceOf — control reflects stored precision', () => {
  it('shows 全天 for a dateless task', () => {
    expect(precisionChoiceOf({ dueDate: null, dueAt: null, allDay: false, duePeriod: null })).toBe('day');
  });

  it('distinguishes day, period and time', () => {
    expect(precisionChoiceOf({ dueDate: TODAY, dueAt: MIDNIGHT, allDay: true, duePeriod: null })).toBe('day');
    expect(
      precisionChoiceOf({ dueDate: TODAY, dueAt: MIDNIGHT, allDay: true, duePeriod: 'evening' }),
    ).toBe('evening');
    expect(precisionChoiceOf({ dueDate: TODAY, dueAt: AFTERNOON, allDay: false, duePeriod: null })).toBe(
      'time',
    );
  });
});

describe('scheduleHint — grey echo uses duePrecisionOf', () => {
  it('says 无日期 for an unscheduled task', () => {
    expect(scheduleHint({ dueDate: null, dueAt: null, allDay: false, duePeriod: null }, TODAY)).toBe(
      '无日期',
    );
  });

  it('names the whole day', () => {
    expect(scheduleHint({ dueDate: TODAY, dueAt: MIDNIGHT, allDay: true, duePeriod: null }, TODAY)).toBe(
      '今天 · 全天',
    );
  });

  it('names the bucket and says there is no fixed time', () => {
    expect(
      scheduleHint({ dueDate: TODAY, dueAt: MIDNIGHT, allDay: true, duePeriod: 'morning' }, TODAY),
    ).toBe('今天 · 上午 · 无固定时间');
  });

  it('shows the clock for an exact time', () => {
    expect(scheduleHint({ dueDate: TODAY, dueAt: AFTERNOON, allDay: false, duePeriod: null }, TODAY)).toBe(
      `今天 ${AFTERNOON_CLOCK}`,
    );
  });
});
