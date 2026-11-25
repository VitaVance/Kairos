import { describe, expect, it } from 'vitest';
import { localDateKey } from '../src/calendar/time-math.js';
import { buildMonthGrid, buildYear, heatByDay, heatLevel, MAX_HEAT } from '../src/calendar/year-math.js';

describe('buildMonthGrid', () => {
  it('always returns six Monday-first rows of seven cells', () => {
    const grid = buildMonthGrid(2026, 2);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-02-01 is a Sunday, so the first row starts on Monday the 26th of Jan.
    expect(grid.weeks[0]?.[0]?.date).toBe('2026-01-26');
    expect(grid.weeks[0]?.[0]?.inMonth).toBe(false);
    expect(grid.weeks[0]?.[6]?.date).toBe('2026-02-01');
    expect(grid.weeks[0]?.[6]?.inMonth).toBe(true);
  });

  it('flags only the grid days that belong to the month', () => {
    const grid = buildMonthGrid(2026, 2);
    const inMonth = grid.weeks.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[0]?.date).toBe('2026-02-01');
    expect(inMonth.at(-1)?.date).toBe('2026-02-28');
  });

  it('handles a leap February', () => {
    const grid = buildMonthGrid(2028, 2);
    const inMonth = grid.weeks.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe('buildYear', () => {
  it('returns twelve January-first months with stable keys', () => {
    const months = buildYear(2026);
    expect(months).toHaveLength(12);
    expect(months[0]?.key).toBe('2026-01');
    expect(months[11]?.key).toBe('2026-12');
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('heatLevel', () => {
  it('maps entry counts onto 0–4 dots', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(3)).toBe(3);
    expect(heatLevel(4)).toBe(4);
    expect(heatLevel(9)).toBe(MAX_HEAT);
  });

  it('treats negatives as empty', () => {
    expect(heatLevel(-2)).toBe(0);
  });
});

describe('heatByDay', () => {
  it('counts entries per local day and ignores other years', () => {
    const heat = heatByDay(
      [
        { startAt: '2026-03-04T09:00:00.000Z' },
        { startAt: '2026-03-04T11:00:00.000Z' },
        { startAt: '2026-03-05T09:00:00.000Z' },
        { startAt: '2027-03-05T09:00:00.000Z' },
      ],
      2026,
    );
    // Mid-day UTC instants resolve to the same local day at every offset.
    expect(heat.get(localDateKey('2026-03-04T09:00:00.000Z'))).toBe(2);
    expect(heat.get(localDateKey('2026-03-05T09:00:00.000Z'))).toBe(1);
    expect(heat.has(localDateKey('2027-03-05T09:00:00.000Z'))).toBe(false);
  });

  it('buckets by the app-local day, not the UTC day', () => {
    // An all-day task due 2026-12-01 anchors to local midnight; at UTC+08:00
    // that instant is still 2026-11-30 in UTC. It must count toward Dec 1.
    const instant = '2026-11-30T16:00:00.000Z';
    const heat = heatByDay([{ startAt: instant }], 2026, 'Asia/Shanghai');
    expect(heat.get('2026-12-01')).toBe(1);
    expect(heat.has('2026-11-30')).toBe(false);
  });

  it('caps a very busy day at the maximum', () => {
    const heat = heatByDay(
      Array.from({ length: 12 }, () => ({ startAt: '2026-06-01T09:00:00.000Z' })),
      2026,
    );
    expect(heat.get(localDateKey('2026-06-01T09:00:00.000Z'))).toBe(MAX_HEAT);
  });
});
