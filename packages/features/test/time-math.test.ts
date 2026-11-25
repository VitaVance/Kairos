import { describe, expect, it } from 'vitest';
import type { Instant } from '@todolist/core';
import { initI18n } from '@todolist/ui';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  entryTimeLabel,
  formatFullDate,
  formatMinuteRange,
  formatMonthDay,
  formatMonthName,
  formatMonthYear,
  formatMinutes,
  hourLabel,
  isDragDistance,
  layoutOverlapping,
  localDateKey,
  minuteAtOffset,
  parseHourLabel,
  selectionRange,
  snapMinutes,
  snapMinuteWithin,
  weekdayLabels,
} from '../src/calendar/time-math.js';

// `entryTimeLabel` and `hourLabel` read the calendar catalog; pin the runtime
// to English so the assertions below are the translated values, not raw keys.
initI18n('en');

describe('locale date helpers', () => {
  it('starts the weekday strip on Monday even for en, whose Intl data starts Sunday', () => {
    // en-US narrow labels begin "S" if you trust Intl's week start; walking
    // from a known Monday must put Mon first and Sun last.
    expect(weekdayLabels('narrow', 'en')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(weekdayLabels('short', 'en')).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(weekdayLabels('short', 'zh-CN')).toEqual([
      '周一',
      '周二',
      '周三',
      '周四',
      '周五',
      '周六',
      '周日',
    ]);
  });

  it('formats dates per locale instead of slicing ISO', () => {
    expect(formatMonthDay('2026-11-25', 'en')).toBe('Nov 25');
    expect(formatMonthDay('2026-11-25', 'zh-CN')).toBe('11月25日');
    expect(formatFullDate('2026-11-25', 'en')).toBe('November 25, 2026');
    expect(formatFullDate('2026-11-25', 'zh-CN')).toBe('2026年11月25日');
    expect(formatMonthYear(2026, 11, 'en')).toBe('November 2026');
    expect(formatMonthYear(2026, 11, 'zh-CN')).toBe('2026年11月');
    expect(formatMonthName(11, 'en')).toBe('Nov');
    expect(formatMonthName(11, 'zh-CN')).toBe('11月');
  });
});

describe('layoutOverlapping', () => {
  it('keeps non-overlapping entries in a single column', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 60, end: 120 },
      { id: 'c', start: 120, end: 180 },
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.columns === 1 && b.column === 0)).toBe(true);
  });

  it('splits two overlapping entries into two columns', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
    ]);
    const a = out.find((b) => b.id === 'a')!;
    const b = out.find((b) => b.id === 'b')!;
    expect(a.columns).toBe(2);
    expect(b.columns).toBe(2);
    expect(a.column).not.toBe(b.column);
  });

  it('reuses a freed column for a later entry', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 0, end: 120 },
      { id: 'c', start: 60, end: 90 },
    ]);
    const a = out.find((b) => b.id === 'a')!;
    const c = out.find((b) => b.id === 'c')!;
    expect(c.column).toBe(a.column);
    expect(a.columns).toBe(2);
  });

  it('treats touching intervals as non-overlapping', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 60, end: 120 },
    ]);
    expect(out.every((b) => b.columns === 1)).toBe(true);
  });

  it('returns one entry per input, sorted by start', () => {
    const out = layoutOverlapping([
      { id: 'late', start: 120, end: 180 },
      { id: 'early', start: 0, end: 60 },
    ]);
    expect(out.map((b) => b.id)).toEqual(['early', 'late']);
  });

  it('handles an empty list', () => {
    expect(layoutOverlapping([])).toEqual([]);
  });

  it('uses two lanes for three chained overlaps (max concurrency is 2)', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 60, end: 120 },
    ]);
    // a and c never overlap, so they share a lane; b needs the other one.
    expect(out.find((b) => b.id === 'a')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'b')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'c')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'a')!.column).toBe(0);
    expect(out.find((b) => b.id === 'b')!.column).toBe(1);
    expect(out.find((b) => b.id === 'c')!.column).toBe(0);
  });

  it('splits a genuine three-way concurrent overlap into three columns', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 90 },
      { id: 'b', start: 30, end: 120 },
      { id: 'c', start: 60, end: 150 },
    ]);
    expect(out.find((b) => b.id === 'a')!.columns).toBe(3);
    expect(out.find((b) => b.id === 'b')!.columns).toBe(3);
    expect(out.find((b) => b.id === 'c')!.columns).toBe(3);
    expect(new Set(out.map((b) => b.column)).size).toBe(3);
  });

  it('makes a fully containing event share the column count', () => {
    const out = layoutOverlapping([
      { id: 'outer', start: 0, end: 120 },
      { id: 'inner', start: 30, end: 60 },
    ]);
    expect(out.find((b) => b.id === 'outer')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'inner')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'outer')!.column).not.toBe(out.find((b) => b.id === 'inner')!.column);
  });

  it('gives zero-duration events their own lane without splitting unrelated ones', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'z', start: 60, end: 60 },
    ]);
    // Touching (not overlapping) still collapses to a single column.
    expect(out.find((b) => b.id === 'a')!.columns).toBe(1);
    expect(out.find((b) => b.id === 'z')!.columns).toBe(1);
  });

  it('starts a fresh one-column cluster after the previous one ends', () => {
    const out = layoutOverlapping([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 120, end: 180 },
    ]);
    expect(out.find((b) => b.id === 'a')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'b')!.columns).toBe(2);
    expect(out.find((b) => b.id === 'c')!.columns).toBe(1);
    expect(out.find((b) => b.id === 'c')!.column).toBe(0);
  });
});

describe('localDateKey', () => {
  it('uses the app-local day, not the UTC day', () => {
    // 2025-11-30T16:30Z is 2025-12-01 00:30 at UTC+08:00.
    expect(localDateKey('2025-11-30T16:30:00.000Z', 'Asia/Shanghai')).toBe('2025-12-01');
    expect(localDateKey('2025-11-30T16:30:00.000Z', 'UTC')).toBe('2025-11-30');
    // 23:30 local east of UTC stays on the same local day.
    expect(localDateKey('2026-06-01T15:30:00.000Z', 'Asia/Shanghai')).toBe('2026-06-01');
  });
});

describe('time helpers', () => {
  it('parses hour labels and rejects garbage', () => {
    expect(parseHourLabel('08:00')).toBe(480);
    expect(parseHourLabel('13:30')).toBe(810);
    expect(parseHourLabel('25:00')).toBeNull();
    expect(parseHourLabel('nope')).toBeNull();
  });

  it('formats minutes back to a padded label', () => {
    expect(formatMinutes(480)).toBe('08:00');
    expect(formatMinutes(0)).toBe('00:00');
  });

  it('labels noon as Noon', () => {
    expect(hourLabel(12)).toBe('Noon');
    expect(hourLabel(8)).toBe('08:00');
    expect(hourLabel(20)).toBe('20:00');
  });
});

describe('drag-to-select time math', () => {
  it('snaps minutes to the nearest slot', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(53)).toBe(60);
    expect(SNAP_MINUTES).toBe(15);
  });

  it('snaps and clamps into the visible bounds', () => {
    const bounds = { min: 480, max: 1200 };
    expect(snapMinuteWithin(470, bounds)).toBe(480);
    expect(snapMinuteWithin(1300, bounds)).toBe(1200);
    expect(snapMinuteWithin(615, bounds)).toBe(615);
    // Rounding is applied before the clamp, so 1199 → 1200, not past it.
    expect(snapMinuteWithin(1199, bounds)).toBe(1200);
  });

  it('converts a column pixel offset to a snapped, clamped minute', () => {
    const bounds = { min: 480, max: 1200 };
    const pxPerMinute = 1; // one pixel per minute keeps the numbers readable
    expect(minuteAtOffset(0, pxPerMinute, bounds)).toBe(480);
    expect(minuteAtOffset(92, pxPerMinute, bounds)).toBe(570); // 09:30
    // Above the column and below it both clamp into range.
    expect(minuteAtOffset(-500, pxPerMinute, bounds)).toBe(480);
    expect(minuteAtOffset(5000, pxPerMinute, bounds)).toBe(1200);
    // Degenerate scale is rejected rather than producing NaN / Infinity.
    expect(minuteAtOffset(100, 0, bounds)).toBe(480);
  });

  it('tracks the real grid scale', () => {
    // 58px per hour = 0.9666..px per minute; 116px down is two hours.
    const pxPerMinute = 58 / 60;
    const bounds = { min: 480, max: 1200 };
    expect(minuteAtOffset(0, pxPerMinute, bounds)).toBe(480);
    expect(minuteAtOffset(116, pxPerMinute, bounds)).toBe(600); // 10:00
  });

  it('orders the selection so dragging upward equals dragging downward', () => {
    const down = selectionRange(630, 690); // 10:30 → 11:30
    const up = selectionRange(690, 630); // 11:30 → 10:30
    expect(down).toEqual({ start: 630, end: 690 });
    expect(up).toEqual(down);
    expect(formatMinuteRange(down.start, down.end)).toBe('10:30 – 11:30');
  });

  it('gives a zero-length selection one full slot', () => {
    expect(selectionRange(600, 600)).toEqual({ start: 600, end: 615 });
    // Snapping first means a sub-slot wobble is still a one-slot range.
    expect(selectionRange(602, 606)).toEqual({ start: 600, end: 615 });
  });

  it('clamps a selection to the column bounds', () => {
    const bounds = { min: 480, max: 1200 };
    expect(selectionRange(470, 1250, bounds)).toEqual({ start: 480, end: 1200 });
    // A one-slot selection pinned to the bottom edge stays inside.
    expect(selectionRange(1200, 1200, bounds)).toEqual({ start: 1185, end: 1200 });
  });

  it('keeps a selection inside a day column that ends at 23:45', () => {
    // DayView bounds exclude the closing 24:00 minute.
    const bounds = { min: 0, max: MINUTES_PER_DAY - SNAP_MINUTES };
    expect(selectionRange(0, MINUTES_PER_DAY, bounds)).toEqual({ start: 0, end: 1425 });
    expect(selectionRange(0, 0, bounds)).toEqual({ start: 0, end: 15 });
  });

  it('only treats real movement beyond the threshold as a drag', () => {
    expect(isDragDistance(0, 0, 3)).toBe(false);
    expect(isDragDistance(2, 2, 3)).toBe(false); // within the radius
    expect(isDragDistance(0, 4, 3)).toBe(true);
    expect(isDragDistance(-4, 0, 3)).toBe(true);
    expect(isDragDistance(4, 4, 3)).toBe(true);
  });

  it('formats a padded range label', () => {
    expect(formatMinuteRange(630, 690)).toBe('10:30 – 11:30');
    expect(formatMinuteRange(0, 60)).toBe('00:00 – 01:00');
  });
});

describe('entryTimeLabel', () => {
  const day = {
    allDay: true,
    period: null,
    startAt: '2026-12-01T00:00:00.000Z' as Instant,
    endAt: '2026-12-01T23:59:59.999Z' as Instant,
  };

  it('labels a day-precision all-day entry All day', () => {
    expect(entryTimeLabel(day)).toBe('All day');
  });

  it('labels each half-day bucket', () => {
    expect(entryTimeLabel({ ...day, period: 'morning' })).toBe('Morning');
    expect(entryTimeLabel({ ...day, period: 'afternoon' })).toBe('Afternoon');
    expect(entryTimeLabel({ ...day, period: 'evening' })).toBe('Evening');
  });

  it('keeps the formatted range for a timed entry', () => {
    expect(
      entryTimeLabel({
        allDay: false,
        period: null,
        startAt: new Date(2026, 11, 1, 8, 0).toISOString() as Instant,
        endAt: new Date(2026, 11, 1, 9, 0).toISOString() as Instant,
      }),
    ).toBe('8:00 - 9:00');
  });
});
