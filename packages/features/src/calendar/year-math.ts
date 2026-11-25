/** Pure helpers for the year overview — no DOM, no React, unit-tested. */
import type { LocalDate } from '@todolist/core';
import { addDays, startOfWeek } from '@todolist/core';
import { localDateKey } from './time-math.js';

export interface MonthCell {
  date: LocalDate;
  /** False for leading/trailing padding days that frame the grid. */
  inMonth: boolean;
}

export interface MonthGrid {
  /** "YYYY-MM" of this month, handy as a stable key. */
  key: string;
  /** 1–12. */
  month: number;
  /** Always 6 rows × 7 columns, Monday-first, so every card is the same height. */
  weeks: MonthCell[][];
}

/** Builds the 6×7 grid for one month of the given year. */
export function buildMonthGrid(year: number, month: number): MonthGrid {
  const first = `${year}-${String(month).padStart(2, '0')}-01` as LocalDate;
  const gridStart = startOfWeek(first);
  const weeks: MonthCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: MonthCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(gridStart, w * 7 + i);
      row.push({ date, inMonth: Number(date.slice(5, 7)) === month });
    }
    weeks.push(row);
  }
  return { key: first.slice(0, 7), month, weeks };
}

/** All 12 month grids for a year, January first. */
export function buildYear(year: number): MonthGrid[] {
  return Array.from({ length: 12 }, (_, i) => buildMonthGrid(year, i + 1));
}

export const MAX_HEAT = 4;

/**
 * Entry count → 0–4 heat level, the number of dots a day shows in the year
 * view. Zero entries is genuinely zero so an empty day reads as empty.
 */
export function heatLevel(count: number): number {
  if (count <= 0) return 0;
  return Math.min(MAX_HEAT, Math.max(1, count));
}

/**
 * Map every local day in the year to its heat level. Days outside the range
 * are absent rather than zero, so padding cells can be styled differently.
 *
 * Keyed by plain `"YYYY-MM-DD"` rather than a branded `LocalDate`: every caller
 * looks up by slicing or by a grid cell's date, and branding the key only
 * forces awkward casts at both the read and the test site.
 *
 * `startAt` is a UTC instant, so the bucket key comes from `localDateKey`, not
 * `slice(0, 10)` — otherwise an all-day item on Jan 1 or a late-evening event
 * lands a day (and possibly a year) early for machines east of UTC.
 */
export function heatByDay(
  entries: readonly { startAt: string }[],
  year: number,
  timeZone?: string,
): Map<string, number> {
  const yearPrefix = `${year}-`;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const day = localDateKey(entry.startAt, timeZone);
    if (!day.startsWith(yearPrefix)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const heat = new Map<string, number>();
  for (const [day, count] of counts) heat.set(day, heatLevel(count));
  return heat;
}
