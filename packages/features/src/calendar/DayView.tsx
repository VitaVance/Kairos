import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { Chip, EmptyState, useTranslation } from '@todolist/ui';
import { useDayEntries } from '../data/useCalendarEntries';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  formatFullDate,
  formatMinutes,
  formatMinuteRange,
  formatRange,
  entryTimeLabel,
  hourLabel,
  isDragDistance,
  layoutOverlapping,
  minutesOfDay,
  selectionRange,
  snapMinuteWithin,
  weekdayLabels,
} from './time-math';
import './calendar.css';
import type { SlotAnchor } from './QuickEventComposer';

export interface DayViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** Emitted with an "HH:MM" snapped to 15 minutes when an empty slot is clicked. */
  onCreateAt?: (time: string) => void;
  /**
   * An empty-slot click routed to the quick composer, with the click point and
   * the column to return focus to. Takes precedence over `onCreateAt`.
   */
  onCreateSlot?: (time: string, anchor: SlotAnchor) => void;
  /**
   * Drag across empty column space → `"HH:MM"` start and end, snapped to 15
   * minutes. A press that does not move still goes through `onCreateAt`.
   */
  onCreateRange?: (start: string, end: string) => void;
  /** Emitted when an existing block is clicked. */
  onOpenEntry?: (entry: CalendarEntry) => void;
  hourHeight?: number;
}

const HOUR_PX = 58;
const DRAG_THRESHOLD_PX = 3;
/**
 * 00:00–06:00 is almost always empty, so those six hours render at a quarter
 * of `hourHeight` and carry one "00:00 – 06:00" gutter label instead of six
 * stacked labels. Everything that converts between minutes and pixels
 * (`yForMinute` / `minuteForY`) uses this same piecewise-linear scale, so
 * blocks, the range overlay, click-to-create and the now-line all land on the
 * same pixel. `hourHeight` keeps meaning "a normal hour".
 */
const EARLY_END_MIN = 6 * 60;
const EARLY_SCALE = 0.25;
const SELECTION_BOUNDS = { min: 0, max: MINUTES_PER_DAY - SNAP_MINUTES };
const CLICK_SUPPRESS_MS = 400;

interface DayDrag {
  pointerId: number;
  captureEl: HTMLDivElement;
  startX: number;
  startY: number;
  /** Snapped minute under the pointer at press time. */
  anchorMin: number;
  /** Latest snapped minute under the pointer. */
  focusMin: number;
  dragged: boolean;
  /** Escape cancelled the sweep; the release must not commit. */
  aborted: boolean;
}

/**
 * Wall-clock minute-of-day in the app time zone, re-read on every minute
 * boundary while `active`. A single `setTimeout` aligned to the next minute
 * then a 60s interval keeps the tick from drifting, and the timer is cleared
 * on unmount. Inactive views schedule nothing.
 */
export function useNowMinutes(active: boolean): number {
  const [minute, setMinute] = useState(() => minutesOfDay(new Date().toISOString()));

  useEffect(() => {
    if (!active) return;
    let interval: number | undefined;
    const tick = () => setMinute(minutesOfDay(new Date().toISOString()));
    tick();
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [active]);

  return minute;
}

/**
 * The current-time rule. Self-contained: it owns the minute tick, so a tick
 * re-renders only this line — the surrounding day/week grid (memoised blocks,
 * gutter, lines) is untouched. Decorative for assistive tech; static (no
 * pulse), so `prefers-reduced-motion` has nothing to disable.
 *
 * `offsetForMinute` maps a minute-of-day to a pixel offset from the top of the
 * column (the day view's scale is piecewise-compressed, the week's is linear),
 * and the line is suppressed when "now" falls outside `[minMinute, maxMinute]`
 * or when `active` is false.
 */
export function NowLine({
  active,
  minMinute,
  maxMinute,
  offsetForMinute,
}: {
  active: boolean;
  minMinute: number;
  maxMinute: number;
  offsetForMinute: (minute: number) => number;
}) {
  const minute = useNowMinutes(active);
  if (!active || minute < minMinute || minute > maxMinute) return null;
  return (
    <div className="cal-now" aria-hidden="true" style={{ top: offsetForMinute(minute) }}>
      <span className="cal-now__dot" />
    </div>
  );
}

/**
 * One-day time grid: a single wide column.
 *
 * Geometry: 00:00–06:00 is compressed to a quarter height (see `EARLY_SCALE`),
 * every other hour is `hourHeight`. The mapping is piecewise-linear, so the
 * pointer maths here is local rather than the shared drag-to-select hook, which
 * assumes a single constant `pxPerMinute`.
 *
 * Interaction: clicking empty column space emits `onCreateAt("HH:MM")` snapped
 * to the nearest quarter hour, or — when the host supplies `onCreateSlot` — the
 * same click routes to the quick composer with its anchor; dragging across empty
 * space emits a range; clicking a block emits `onOpenEntry`. There is no
 * keyboard path for "click an empty slot" — a create button in the view's host
 * would be the accessible alternative and is a deliberate follow-up.
 */
export function DayView({
  cursor,
  today,
  onCreateAt,
  onCreateSlot,
  onCreateRange,
  onOpenEntry,
  hourHeight = HOUR_PX,
}: DayViewProps) {
  const { t } = useTranslation('calendar');
  const { data, loading, error } = useDayEntries(cursor);

  const pxPerMinute = hourHeight / 60;
  const earlyPxPerMinute = pxPerMinute * EARLY_SCALE;
  const earlyHeight = EARLY_END_MIN * earlyPxPerMinute;
  const totalHeight = earlyHeight + (MINUTES_PER_DAY - EARLY_END_MIN) * pxPerMinute;

  /** Minute-of-day → pixel offset from the top of the column. */
  const yForMinute = (minute: number): number =>
    minute <= EARLY_END_MIN
      ? minute * earlyPxPerMinute
      : earlyHeight + (minute - EARLY_END_MIN) * pxPerMinute;

  /** Pixel offset from the top of the column → unsnapped minute-of-day. */
  const minuteForY = (y: number): number =>
    y <= earlyHeight ? y / earlyPxPerMinute : EARLY_END_MIN + (y - earlyHeight) / pxPerMinute;

  const hours = useMemo(() => Array.from({ length: 25 }, (_, h) => h), []);

  const blocks = useMemo(() => {
    const list = (data ?? [])
      .filter((entry) => !entry.allDay)
      .map((entry) => {
        const start = minutesOfDay(entry.startAt);
        const end = Math.max(minutesOfDay(entry.endAt), start + 15);
        return { entry, start, end: Math.min(end, MINUTES_PER_DAY) };
      });
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    return list;
  }, [data]);

  const allDay = useMemo(() => (data ?? []).filter((entry) => entry.allDay), [data]);

  const placed = useMemo(
    () => layoutOverlapping(blocks.map((b, i) => ({ id: `${b.entry.id}-${i}`, start: b.start, end: b.end }))),
    [blocks],
  );

  // ---- Drag-to-select a range (piecewise scale, so done locally). ----
  const dragRef = useRef<DayDrag | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);

  function clearSuppression() {
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    suppressClickRef.current = false;
  }

  function armSuppression() {
    suppressClickRef.current = true;
    if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
    // Backstop only: normally the trailing click consumes this, or the next
    // pointerdown clears it.
    suppressTimerRef.current = window.setTimeout(() => {
      suppressTimerRef.current = null;
      suppressClickRef.current = false;
    }, CLICK_SUPPRESS_MS);
  }

  function consumeClick(): boolean {
    if (!suppressClickRef.current) return false;
    clearSuppression();
    return true;
  }

  function releasePointer(el: HTMLElement, pointerId: number) {
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Capture was already lost (pointercancel / detached); ignore.
    }
  }

  function onColumnPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onCreateRange) return;
    if (event.button !== 0) return;
    if (event.isPrimary === false) return;
    // A press on a block belongs to that block (open / its own handlers).
    if ((event.target as Element).closest('.cal-day__block')) return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const anchorMin = snapMinuteWithin(minuteForY(event.clientY - rect.top), SELECTION_BOUNDS, SNAP_MINUTES);
    // A new press starts a new gesture; drop any stale suppression.
    clearSuppression();
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone (very fast tap); in-column sweep still works.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      captureEl: el,
      startX: event.clientX,
      startY: event.clientY,
      anchorMin,
      focusMin: anchorMin,
      dragged: false,
      aborted: false,
    };
    setSelection(null);
    setPressing(true);
  }

  function onColumnPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId || state.aborted) return;
    const rect = state.captureEl.getBoundingClientRect();
    const focusMin = snapMinuteWithin(minuteForY(event.clientY - rect.top), SELECTION_BOUNDS, SNAP_MINUTES);
    state.focusMin = focusMin;
    if (!state.dragged) {
      if (!isDragDistance(event.clientX - state.startX, event.clientY - state.startY, DRAG_THRESHOLD_PX)) return;
      state.dragged = true;
    }
    setSelection(selectionRange(state.anchorMin, focusMin, SELECTION_BOUNDS, SNAP_MINUTES));
  }

  function onColumnPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releasePointer(state.captureEl, state.pointerId);
    setSelection(null);
    setPressing(false);
    if (state.aborted) {
      armSuppression();
      return;
    }
    if (!state.dragged) return;
    const range = selectionRange(state.anchorMin, state.focusMin, SELECTION_BOUNDS, SNAP_MINUTES);
    armSuppression();
    // Defer past the synthetic click so the editor does not open beneath it.
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      onCreateRange?.(formatMinutes(range.start), formatMinutes(range.end));
    }, 0);
  }

  function onColumnPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releasePointer(state.captureEl, state.pointerId);
    setSelection(null);
    setPressing(false);
    armSuppression();
  }

  // Escape cancels the sweep while the pointer is still down.
  useEffect(() => {
    if (!pressing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const state = dragRef.current;
      if (state) {
        state.aborted = true;
        state.dragged = false;
      }
      setSelection(null);
      setPressing(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pressing]);

  // Freeze document text selection for the whole press.
  useEffect(() => {
    if (!pressing) return;
    document.body.classList.add('cal-selecting');
    return () => document.body.classList.remove('cal-selecting');
  }, [pressing]);

  // Unmount mid-drag: drop capture and timers.
  useEffect(
    () => () => {
      const state = dragRef.current;
      if (state) releasePointer(state.captureEl, state.pointerId);
      dragRef.current = null;
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );

  function onColumnClick(event: MouseEvent<HTMLDivElement>) {
    // A completed range sweep leaves one synthetic click; consume it.
    if (consumeClick()) return;
    if (!onCreateAt && !onCreateSlot) return;
    // A click that lands on an existing block belongs to that block.
    if ((event.target as HTMLElement).closest('.cal-day__block')) return;
    const col = event.currentTarget;
    const rect = col.getBoundingClientRect();
    const snapped = snapMinuteWithin(
      minuteForY(event.clientY - rect.top),
      SELECTION_BOUNDS,
      SNAP_MINUTES,
    );
    const time = formatMinutes(snapped);
    if (onCreateSlot) {
      onCreateSlot(time, {
        x: event.clientX,
        y: event.clientY,
        // The column is a plain div; the composer makes it focusable on close.
        returnFocusTo: col,
      });
      return;
    }
    onCreateAt?.(time);
  }

  const weekdayIndex = useMemo(() => {
    // Local date → Monday-first index without Temporal: parse as UTC so the
    // result stays time-zone free (the date string itself is timezone-free).
    const d = new Date(`${cursor}T00:00:00Z`);
    return (d.getUTCDay() + 6) % 7;
  }, [cursor]);

  const isToday = cursor === today;
  // Weekday labels are derived from the active locale and walked Monday-first,
  // so the header never inherits English's Sunday-first Intl data.
  const weekdays = weekdayLabels('short');

  return (
    <div className="cal-day">
      <header className="cal-day__head">
        <span className="cal-day__date">{formatFullDate(cursor)}</span>
        <span className="cal-day__weekday">{weekdays[weekdayIndex]}</span>
        {isToday ? <span className="cal-day__today">{t('today')}</span> : null}
      </header>

      {error ? (
        <p className="cal-error" role="alert">
          {t('loadFailed', { message: error.message })}
        </p>
      ) : null}

      {allDay.length > 0 ? (
        <div className="cal-day__allday" role="group" aria-label={t('allDay')}>
          {allDay.map((entry) => (
            <Chip
              key={`${entry.source}-${entry.id}`}
              title={entry.title}
              time={entry.period ? entryTimeLabel(entry) : undefined}
              color={entry.color}
              done={entry.done}
              allDay
              onClick={onOpenEntry ? () => onOpenEntry(entry) : undefined}
            />
          ))}
        </div>
      ) : null}

      {!loading && !error && blocks.length === 0 && allDay.length === 0 ? (
        <div className="cal-day__empty">
          <EmptyState
            message={t('empty')}
            hint={onCreateAt || onCreateSlot || onCreateRange ? t('emptyHint') : undefined}
            compact
          />
        </div>
      ) : null}

      <div className="cal-day__body" style={{ height: totalHeight }}>
        <div className="cal-day__gutter" aria-hidden="true">
          {/* The compressed 00:00–06:00 band is labelled by its two edges, not
              by a "00:00 – 06:00" range: the 48px gutter fits a single "HH:MM"
              and the range form was clipped to "–06:00" the moment it shipped. */}
          <span className="cal-day__hourlabel" style={{ top: 0 }}>
            {hourLabel(0)}
          </span>
          <span className="cal-day__hourlabel cal-day__hourlabel--span" style={{ top: earlyHeight }}>
            {hourLabel(EARLY_END_MIN / 60)}
          </span>
          {hours
            .filter((h) => h > 6)
            .map((h) => (
              <span className="cal-day__hourlabel" key={h} style={{ top: yForMinute(h * 60) }}>
                {hourLabel(h)}
              </span>
            ))}
        </div>

        <div
          className={`cal-day__col${onCreateAt || onCreateSlot || onCreateRange ? ' cal-day__col--create' : ''}${onCreateRange ? ' cal-range-col' : ''}`}
          onClick={onColumnClick}
          onPointerDown={onColumnPointerDown}
          onPointerMove={onColumnPointerMove}
          onPointerUp={onColumnPointerUp}
          onPointerCancel={onColumnPointerCancel}
        >
          {hours.slice(0, -1).map((h) => (
            <div
              className="cal-day__line"
              key={h}
              style={{ height: h < 6 ? hourHeight * EARLY_SCALE : hourHeight }}
            />
          ))}

          {selection ? (
            <div
              className="cal-range"
              aria-hidden="true"
              style={{
                top: yForMinute(selection.start),
                height: yForMinute(selection.end) - yForMinute(selection.start),
              }}
            >
              <span className="cal-range__label">
                {formatMinuteRange(selection.start, selection.end)}
              </span>
            </div>
          ) : null}

          {blocks.map((b, i) => {
            const id = `${b.entry.id}-${i}`;
            const p = placed.find((x) => x.id === id);
            const top = yForMinute(b.start);
            const height = Math.max(22, yForMinute(b.end) - top - 2);
            const width = p ? 100 / p.columns : 100;
            const left = p ? (p.column * 100) / p.columns : 0;
            const tall = height >= 46;
            return (
              <div
                key={id}
                className={`cal-day__block cal-block ${tall ? 'cal-block--tall' : 'cal-block--short'}`}
                style={{ top, height, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }}
              >
                <Chip
                  title={b.entry.title}
                  time={formatRange(b.entry.startAt, b.entry.endAt)}
                  color={b.entry.color}
                  done={b.entry.done}
                  onClick={onOpenEntry ? () => onOpenEntry(b.entry) : undefined}
                />
              </div>
            );
          })}

          {isToday ? (
            <NowLine
              active
              minMinute={0}
              maxMinute={MINUTES_PER_DAY}
              offsetForMinute={yForMinute}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
