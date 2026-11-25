import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarEntry, Instant, LocalDate } from '@todolist/core';
import { startOfWeek, addDays, startOfDay } from '@todolist/core';
import { Chip } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  formatMinutes,
  formatMinuteRange,
  formatRange,
  hourLabel,
  layoutOverlapping,
  localDateKey,
  minutesOfDay,
} from './time-math';
import { useTimeRangeSelection } from './useTimeRangeSelection';
import './calendar.css';

export interface WeekViewProps {
  cursor: LocalDate;
  today: LocalDate;
  dayStartHour?: number;
  dayEndHour?: number;
  hourHeight?: number;
  /** Click on empty column space → `"HH:MM"` snapped to 15 minutes. */
  onCreateAt?: (date: LocalDate, time: string) => void;
  /**
   * Drag across empty column space → `"HH:MM"` start and end, snapped to 15
   * minutes. A press that does not move still goes through `onCreateAt`.
   */
  onCreateRange?: (date: LocalDate, start: string, end: string) => void;
  /** Click an existing block. */
  onOpenEntry?: (entry: CalendarEntry) => void;
  /**
   * Vertical drag of a block → its new start instant. When omitted, blocks are
   * not draggable (a plain click still opens the entry).
   */
  onReschedule?: (entry: CalendarEntry, newStart: Instant) => void;
  /**
   * Activate a day header → open that day in the day view. Only the header cell
   * is a control; the column body keeps its click-to-create / drag-to-select.
   */
  onOpenDay?: (date: LocalDate) => void;
}

const HOUR_PX = 58;
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  entry: CalendarEntry;
  day: LocalDate;
  pointerId: number;
  /** Pointer Y at grab, used to measure the vertical delta. */
  startY: number;
  /** Whole-day minute where the block began, used to clamp the drop. */
  originAbsMin: number;
  /** Block duration in minutes; the ghost and the new start both preserve it. */
  duration: number;
  /** Current snapped start as minutes from midnight. */
  currentAbsMin: number;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampStart(absMin: number, duration: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY - duration, absMin));
}

/**
 * Week time grid with click-to-create, click-to-open, and pointer drag to
 * reschedule. Drag deliberately uses pointer events + `setPointerCapture`
 * (not HTML5 DnD) so it works inside the packaged webview and on touch.
 *
 * Keyboard: entries are reachable via the Chip button; moving a block with the
 * keyboard (arrow-key nudging) is a deliberate follow-up and out of scope here.
 */
export function WeekView({
  cursor,
  today,
  dayStartHour = 8,
  dayEndHour = 20,
  hourHeight = HOUR_PX,
  onCreateAt,
  onCreateRange,
  onOpenEntry,
  onReschedule,
  onOpenDay,
}: WeekViewProps) {
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const { data, loading, error } = useRangeEntries(weekStart, days[6] ?? weekStart);

  const dayStartMin = dayStartHour * 60;
  const totalMinutes = (dayEndHour - dayStartHour) * 60;
  const pxPerMinute = hourHeight / 60;

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = dayStartHour; h <= dayEndHour; h++) out.push(h);
    return out;
  }, [dayStartHour, dayEndHour]);

  const byDay = useMemo(() => {
    const map = new Map<string, { entry: CalendarEntry; start: number; end: number }[]>();
    for (const entry of data ?? []) {
      // All-day entries live in the banner strip above the grid, not the timed
      // lanes (their midnight→midnight span would otherwise draw a sliver at
      // the top of the column).
      if (entry.allDay) continue;
      // Bucket by the app-local day (an instant sliced as UTC files evening
      // events on the previous day outside UTC).
      const key = localDateKey(entry.startAt);
      const start = minutesOfDay(entry.startAt) - dayStartMin;
      const end = minutesOfDay(entry.endAt) - dayStartMin;
      const list = map.get(key) ?? [];
      list.push({ entry, start, end: Math.max(end, start + 15) });
      map.set(key, list);
    }
    return map;
  }, [data, dayStartMin]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data ?? []) {
      if (!entry.allDay) continue;
      const key = localDateKey(entry.startAt);
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return map;
  }, [data]);

  // Drag state lives in a ref for the pointermove loop and in state for
  // rendering the live ghost. `movedRef` suppresses the click that follows a drag.
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const movedRef = useRef(false);

  function startDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    entry: CalendarEntry,
    day: LocalDate,
    start: number,
    end: number,
  ) {
    if (!onReschedule || entry.allDay) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    movedRef.current = false;
    const absStart = clampStart(start + dayStartMin, end - start);
    const state: DragState = {
      entry,
      day,
      pointerId: event.pointerId,
      startY: event.clientY,
      originAbsMin: absStart,
      duration: end - start,
      currentAbsMin: absStart,
    };
    dragRef.current = state;
    setDrag(state);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const deltaMin = (event.clientY - state.startY) / pxPerMinute;
    if (Math.abs(event.clientY - state.startY) > DRAG_THRESHOLD_PX) movedRef.current = true;
    const nextAbs = clampStart(state.originAbsMin + snap(deltaMin), state.duration);
    if (nextAbs === state.currentAbsMin) return;
    const updated: DragState = { ...state, currentAbsMin: nextAbs };
    dragRef.current = updated;
    setDrag(updated);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    try {
      event.currentTarget.releasePointerCapture(state.pointerId);
    } catch {
      // Pointer capture was already released (e.g. pointercancel); ignore.
    }
    if (!movedRef.current || !onReschedule) return;
    const newStart = new Date(
      Date.parse(startOfDay(state.day)) + state.currentAbsMin * 60_000,
    ).toISOString() as Instant;
    onReschedule(state.entry, newStart);
  }

  function cancelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    movedRef.current = false;
  }

  // Drag across empty column space → a live range overlay → editor on release.
  const rangeSelection = useTimeRangeSelection({
    enabled: Boolean(onCreateRange),
    bounds: { min: dayStartMin, max: dayStartMin + totalMinutes },
    pxPerMinute,
    blockSelector: '.wv__block',
    dragThresholdPx: DRAG_THRESHOLD_PX,
    onSelect: (day, start, end) => onCreateRange?.(day, formatMinutes(start), formatMinutes(end)),
  });

  function onColumnClick(event: ReactMouseEvent<HTMLDivElement>, day: LocalDate) {
    // A drag ends with a click somewhere in the column; swallow exactly that one
    // so releasing a dragged block never opens the create form underneath it.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    // A completed range sweep leaves one synthetic click; consume it so the
    // sweep does not also create a zero-duration event.
    if (rangeSelection.consumeClick()) return;
    if (!onCreateAt) return;
    // Ignore clicks that originated on a block/chip; only empty space creates.
    if ((event.target as HTMLElement).closest('.wv__block')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = dayStartMin + (event.clientY - rect.top) / pxPerMinute;
    const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, snap(raw)));
    onCreateAt(day, formatMinutes(clamped));
  }

  function onChipClick(entry: CalendarEntry) {
    // A drag ends with a click; swallow exactly that one.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    onOpenEntry?.(entry);
  }

  return (
    <div className="wv" style={{ ['--wv-hour' as string]: `${hourHeight}px` }}>
      <div className="wv__head">
        <div className="wv__gutter-head" />
        {days.map((day) => {
          const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][days.indexOf(day)];
          const content = (
            <>
              <span className="wv__daynum">{Number(day.slice(8))}</span>
              <span className="wv__dayname">{weekday}</span>
            </>
          );
          const className = `wv__dayhead${day === today ? ' wv__dayhead--today' : ''}`;
          return onOpenDay ? (
            // The header is the control; the column body below keeps its
            // click-to-create and drag-to-select untouched.
            <button
              type="button"
              className={`${className} wv__dayhead--button`}
              key={day}
              aria-label={`打开 ${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`}
              onClick={() => onOpenDay(day)}
            >
              {content}
            </button>
          ) : (
            <div className={className} key={day}>
              {content}
            </div>
          );
        })}
      </div>

      <div className="wv__allday" role="group" aria-label="全天">
        <div className="wv__gutter-head">全天</div>
        {days.map((day) => {
          const items = allDayByDay.get(day) ?? [];
          return (
            <div
              className={`wv__allday-cell${items.length === 0 ? ' wv__allday-cell--empty' : ''}`}
              key={day}
            >
              {items.map((entry) => (
                <Chip
                  key={`${entry.source}-${entry.id}`}
                  title={entry.title}
                  color={entry.color}
                  done={entry.done}
                  allDay
                  onClick={onOpenEntry ? () => onOpenEntry(entry) : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="cal-error" role="alert">
          日程加载失败：{error.message}
        </p>
      ) : loading && !data ? (
        <p className="wv__status" role="status">
          加载中…
        </p>
      ) : null}

      <div className="wv__body" style={{ height: totalMinutes * pxPerMinute + 24 }}>
        <div className="wv__gutter">
          {hours.map((h) => (
            <div className="wv__hour" key={h} style={{ height: hourHeight }}>
              <span>{hourLabel(h)}</span>
            </div>
          ))}
        </div>

        {days.map((day) => {
          const placed = layoutOverlapping(
            (byDay.get(day) ?? []).map((b, i) => ({ id: `${b.entry.id}-${i}`, start: b.start, end: b.end })),
          );
          const lookup = new Map(placed.map((p) => [p.id, p]));
          return (
            <div
              className={`wv__col${day === today ? ' wv__col--today' : ''}${onCreateAt || onCreateRange ? ' cal-week-col--create' : ''}${onCreateRange ? ' cal-range-col' : ''}`}
              key={day}
              onClick={(e) => onColumnClick(e, day)}
              {...(onCreateRange ? rangeSelection.handlers(day) : {})}
            >
              {hours.slice(0, -1).map((h) => (
                <div className="wv__line" key={h} style={{ height: hourHeight }} />
              ))}
              {(byDay.get(day) ?? []).map((b, i) => {
                const id = `${b.entry.id}-${i}`;
                const p = lookup.get(id);
                const top = Math.max(0, b.start) * pxPerMinute;
                const height = Math.max(20, (b.end - Math.max(0, b.start)) * pxPerMinute - 2);
                const width = p ? 100 / p.columns : 100;
                const left = p ? (p.column * 100) / p.columns : 0;
                const draggable = Boolean(onReschedule) && !b.entry.allDay;
                const dragging =
                  drag !== null &&
                  drag.entry.source === b.entry.source &&
                  drag.entry.id === b.entry.id &&
                  drag.day === day;
                return (
                  <div
                    key={id}
                    className={`wv__block${draggable ? ' cal-week-block--draggable' : ''}${dragging ? ' cal-week-block--dragging' : ''}`}
                    style={{
                      top,
                      height,
                      left: `calc(${left}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                    onPointerDown={draggable ? (e) => startDrag(e, b.entry, day, b.start, b.end) : undefined}
                    onPointerMove={draggable ? moveDrag : undefined}
                    onPointerUp={draggable ? endDrag : undefined}
                    onPointerCancel={draggable ? cancelDrag : undefined}
                  >
                    <Chip
                      title={b.entry.title}
                      time={formatRange(b.entry.startAt, b.entry.endAt)}
                      color={b.entry.color}
                      done={b.entry.done}
                      onClick={onOpenEntry ? () => onChipClick(b.entry) : undefined}
                    />
                  </div>
                );
              })}

              {rangeSelection.selection && rangeSelection.selection.day === day ? (
                <div
                  className="cal-range"
                  aria-hidden="true"
                  style={{
                    top: (rangeSelection.selection.start - dayStartMin) * pxPerMinute,
                    height: (rangeSelection.selection.end - rangeSelection.selection.start) * pxPerMinute,
                  }}
                >
                  <span className="cal-range__label">
                    {formatMinuteRange(rangeSelection.selection.start, rangeSelection.selection.end)}
                  </span>
                </div>
              ) : null}

              {drag && drag.day === day ? (
                <div
                  className="cal-week-ghost"
                  aria-hidden="true"
                  style={{
                    top: drag.currentAbsMin * pxPerMinute - dayStartMin * pxPerMinute,
                    height: Math.max(20, drag.duration * pxPerMinute - 2),
                    left: 2,
                    right: 2,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
