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

/** Number of filled steps in the heat ramp; step 0 is the empty cell. */
export const HEAT_STEPS = 5;
/** Highest heat step (4). Kept for callers that just need the cap. */
export const MAX_HEAT = HEAT_STEPS - 1;

export interface HeatBucket {
  /** 0–4, matching `--tl-heat-0` … `--tl-heat-4`. */
  step: number;
  /** Human range shown in the legend, e.g. "3–4". */
  label: string;
  /** Inclusive lower bound of the raw entry count. */
  min: number;
  /** Inclusive upper bound; null means open-ended (the "7+" bucket). */
  max: number | null;
}

/**
 * The scale, in one place so the legend and the cells cannot drift.
 *
 * Why these thresholds: a personal calendar is mostly one or two things a day
 * (the demo seed is one event per day, with a handful of 2–3 days when timed
 * tasks join the events). Three or four is a genuinely busy day, five or six
 * is exceptional, and seven-plus is the rare overloaded day. Even spacing
 * would put most real days in step 1 and waste the ramp's top half.
 */
export const HEAT_BUCKETS: readonly HeatBucket[] = [
  { step: 0, label: '0', min: 0, max: 0 },
  { step: 1, label: '1–2', min: 1, max: 2 },
  { step: 2, label: '3–4', min: 3, max: 4 },
  { step: 3, label: '5–6', min: 5, max: 6 },
  { step: 4, label: '7+', min: 7, max: null },
];

/**
 * Raw entry count → 0–4 heat step. Zero entries is genuinely step 0 so an
 * empty day stays visibly empty; a very large (or infinite) count caps at 4
 * instead of overflowing the ramp. Negative and NaN input degrades to 0.
 */
export function heatStep(count: number): number {
  if (Number.isNaN(count) || count <= 0) return 0;
  if (!Number.isFinite(count)) return MAX_HEAT;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return MAX_HEAT;
}

/**
 * Map every local day in the year to its *raw* entry count. The count — not
 * the step — is the value, because the cell's accessible label must state how
 * many entries a day has; colour is a visual encoding screen readers cannot
 * see. Rendering calls `heatStep` for the fill. Days outside the range are
 * absent rather than zero, so padding cells can be styled differently.
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
  return counts;
}
