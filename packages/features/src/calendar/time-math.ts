/** Pure time math for the calendar surfaces — no DOM, no React, unit-tested. */
import type { CalendarEntry } from '@todolist/core';
import { APP_TIME_ZONE } from '@todolist/core';
import { PERIOD_LABEL } from '../pickers/picker-math';

const HH_MM = /^(\d{2}):(\d{2})$/;

/**
 * The local calendar day ("YYYY-MM-DD") containing an instant, in the app time
 * zone.
 *
 * Calendar views MUST bucket entries with this rather than `iso.slice(0, 10)`.
 * An instant is UTC, so slicing yields the UTC day: for a machine east of UTC
 * an entry at 00:30 local lands on the previous UTC day, and an all-day item
 * anchored to local midnight (e.g. due 2026-12-01 at UTC+08:00 →
 * 2026-11-30T16:00Z) would be filed under the *previous* month. That breaks the
 * agreement between every grid and the `startOfDay`/`endOfDay` range query that
 * produced the entry in the first place.
 */
export function localDateKey(iso: string, timeZone: string = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Minutes from local midnight for an ISO instant, in the machine's zone.
 * Reads the wall clock fields from Intl rather than Date getters so it stays
 * correct for any time zone offset.
 */
export function minutesOfDay(iso: string, timeZone: string = APP_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  // "24" appears for midnight in some engines.
  return (hour % 24) * 60 + minute;
}

/** "08:00" → 480. Returns null for malformed input. */
export function parseHourLabel(label: string): number | null {
  const m = HH_MM.exec(label);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 480 → "08:00" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Slot width the calendar time grids snap to, in minutes. */
export const SNAP_MINUTES = 15;

/** Minutes in a local day. */
export const MINUTES_PER_DAY = 24 * 60;

/** A half-open minute span within one local day. `start < end`. */
export interface MinuteRange {
  start: number;
  end: number;
}

/** The minute span a grid column actually shows (e.g. 08:00–20:00). */
export interface MinuteBounds {
  min: number;
  max: number;
}

/** Round a minute-of-day to the nearest slot. */
export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * Snap to the nearest slot, then clamp into `bounds`. The result is inclusive of
 * `bounds.max`, so sweeping to the foot of a column can end exactly on the
 * closing hour; a zero-length span is widened by `selectionRange` instead.
 */
export function snapMinuteWithin(minutes: number, bounds: MinuteBounds, step: number = SNAP_MINUTES): number {
  return Math.min(bounds.max, Math.max(bounds.min, snapMinutes(minutes, step)));
}

/**
 * Turn a pixel offset from the top of a grid column into a snapped
 * minute-of-day. The column top is `bounds.min`; offsets above the column
 * (negative) and below it both clamp into the visible range, so a captured
 * pointer that leaves the grid keeps producing a valid time.
 */
export function minuteAtOffset(
  offsetPx: number,
  pxPerMinute: number,
  bounds: MinuteBounds,
  step: number = SNAP_MINUTES,
): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(pxPerMinute) || pxPerMinute <= 0) {
    return bounds.min;
  }
  return snapMinuteWithin(bounds.min + offsetPx / pxPerMinute, bounds, step);
}

/**
 * Selection range between the pointer-down anchor and the current pointer
 * position. Both are snapped and clamped first, then sorted, so dragging
 * upward produces the same span as dragging downward. A zero-length selection
 * grows to one slot, so a committed range always has a positive duration.
 */
export function selectionRange(
  anchorMin: number,
  focusMin: number,
  bounds: MinuteBounds = { min: 0, max: MINUTES_PER_DAY },
  step: number = SNAP_MINUTES,
): MinuteRange {
  const anchor = snapMinuteWithin(anchorMin, bounds, step);
  const focus = snapMinuteWithin(focusMin, bounds, step);
  const start = Math.min(anchor, focus);
  let end = Math.max(anchor, focus);
  if (end - start < step) {
    end = Math.min(bounds.max, start + step);
    if (end - start < step) return { start: Math.max(bounds.min, end - step), end };
  }
  return { start, end };
}

/**
 * True once the pointer has travelled far enough from where it went down to
 * count as a drag rather than a click. Distance is Euclidean, so a deliberate
 * sweep in any direction starts a selection while sub-pixel jitter during a
 * tap stays on the click path.
 */
export function isDragDistance(dx: number, dy: number, thresholdPx: number): boolean {
  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}

/** "10:30 – 11:30" — the live label shown inside a drag selection. */
export function formatMinuteRange(startMin: number, endMin: number): string {
  return `${formatMinutes(startMin)} – ${formatMinutes(endMin)}`;
}

/** Short time range, e.g. "8:00 - 9:00". */
export function formatRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    return m === 0 ? `${h}:00` : `${h}:${String(m).padStart(2, '0')}`;
  };
  return `${fmt(startIso)} - ${fmt(endIso)}`;
}

/**
 * The time label an entry should carry on its chip.
 *
 * A day task and a period task both sit in the all-day strip (`allDay: true`),
 * so without the period both would read "全天". The period task's whole point
 * is to name its half-day, so it wins over `allDay`; everything else falls
 * through to the same range label the views already rendered.
 */
export function entryTimeLabel(
  entry: Pick<CalendarEntry, 'allDay' | 'period' | 'startAt' | 'endAt'>,
): string {
  if (entry.period) return PERIOD_LABEL[entry.period];
  if (entry.allDay) return '全天';
  return formatRange(entry.startAt, entry.endAt);
}

/** 24h clock label for the hour gutter, with 正午 at 12. */
export function hourLabel(hour: number): string {
  if (hour === 12) return '正午';
  return `${String(hour).padStart(2, '0')}:00`;
}

export interface PlacedBlock {
  id: string;
  /** 0-based column within the day. */
  column: number;
  columns: number;
}

/**
 * Greedy column packing for overlapping intervals in a single day column.
 *
 * Entries are sorted by start then by longest duration. A *cluster* is a set of
 * transitively overlapping intervals (an interval joins the open cluster while
 * it starts before the farthest end seen so far). Within a cluster every block
 * shares the same column count — the peak number of concurrent columns — so the
 * splits line up: two overlapping events, a chain of three, and one event full
 * containing another all read as clean side-by-side lanes. Intervals that start
 * after everything before them ends begin a fresh one-column cluster.
 *
 * Zero-duration events are widened to a one-minute sliver first so they still
 * occupy a lane instead of colliding with neighbours at the same point.
 */
export function layoutOverlapping(
  entries: readonly { id: string; start: number; end: number }[],
): PlacedBlock[] {
  const sorted = [...entries]
    .map((e) => ({ id: e.id, start: e.start, end: Math.max(e.end, e.start + 1) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const result: PlacedBlock[] = [];
  /** Start of the current cluster and its peak column usage. */
  let clusterEnd = -Infinity;
  /** Occupied end-time per column within the current cluster. */
  let columnEnds: number[] = [];
  /** Blocks placed in the current cluster, awaiting the final column count. */
  let cluster: { id: string; column: number }[] = [];

  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const block of cluster) result.push({ id: block.id, column: block.column, columns });
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const entry of sorted) {
    const { start, end } = entry;

    // This entry begins after everything placed so far has ended → the previous
    // cluster is closed and a new one starts here.
    if (start >= clusterEnd) flush();

    let column = columnEnds.findIndex((colEnd) => colEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    cluster.push({ id: entry.id, column });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return result;
}
