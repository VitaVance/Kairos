import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { addDays, dayOfWeek } from '@todolist/core';
import { Chip, SegmentedControl } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  formatMinutes,
  formatMinuteRange,
  entryTimeLabel,
  hourLabel,
  layoutOverlapping,
  localDateKey,
  minutesOfDay,
} from './time-math';
import { useTimeRangeSelection } from './useTimeRangeSelection';
import './calendar.css';

export type MultiDaySpan = 3 | 5 | 7;

export interface MultiDayViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** Days on screen initially. The in-view control changes it live. */
  span?: MultiDaySpan;
  /** Notified when the span control changes, so the shell can name the range. */
  onSpanChange?: (span: MultiDaySpan) => void;
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
  /** Click an existing block (same contract as WeekView). */
  onOpenEntry?: (entry: CalendarEntry) => void;
  /**
   * Activate a day header → open that day in the day view. Only the header
   * strip is a control; the column body below keeps its click-to-create and
   * drag-to-select untouched.
   */
  onOpenDay?: (date: LocalDate) => void;
}

const HOUR_PX = 58;
const DRAG_THRESHOLD_PX = 3;
const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const SPAN_OPTIONS = [
  { value: '3', label: '3天' },
  { value: '5', label: '5天' },
  { value: '7', label: '7天' },
] as const;

type SpanValue = (typeof SPAN_OPTIONS)[number]['value'];

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * N consecutive days as time-grid columns, starting at the cursor date.
 *
 * Same geometry and overlap packing as WeekView, but N is a control. When the
 * chosen span does not fit the available width the grid scrolls horizontally;
 * column minimums are set with container queries so the host's width, not the
 * viewport's, decides when that happens.
 */
export function MultiDayView({
  cursor,
  today,
  span = 3,
  onSpanChange,
  dayStartHour = 8,
  dayEndHour = 20,
  hourHeight = HOUR_PX,
  onCreateAt,
  onCreateRange,
  onOpenEntry,
  onOpenDay,
}: MultiDayViewProps) {
  const [spanValue, setSpanValue] = useState<SpanValue>(String(span) as SpanValue);
  const dayCount = Number(spanValue) as MultiDaySpan;

  const setSpan = (next: SpanValue) => {
    setSpanValue(next);
    onSpanChange?.(Number(next) as MultiDaySpan);
  };

  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(cursor, i)),
    [cursor, dayCount],
  );
  const lastDay = days[days.length - 1] ?? cursor;
  const { data, loading, error } = useRangeEntries(cursor, lastDay);

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
      if (entry.allDay) continue;
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

  function onColumnClick(event: ReactMouseEvent<HTMLDivElement>, day: LocalDate) {
    // A completed range sweep leaves one synthetic click; consume it.
    if (rangeSelection.consumeClick()) return;
    if (!onCreateAt) return;
    // Clicks that land on a block belong to the block's own handler.
    if ((event.target as HTMLElement).closest('.mdv__block')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = dayStartMin + (event.clientY - rect.top) / pxPerMinute;
    const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, snap(raw)));
    onCreateAt(day, formatMinutes(clamped));
  }

  // Drag across empty column space → a live range overlay → editor on release.
  const rangeSelection = useTimeRangeSelection({
    enabled: Boolean(onCreateRange),
    bounds: { min: dayStartMin, max: dayStartMin + totalMinutes },
    pxPerMinute,
    blockSelector: '.mdv__block',
    dragThresholdPx: DRAG_THRESHOLD_PX,
    onSelect: (day, start, end) => onCreateRange?.(day, formatMinutes(start), formatMinutes(end)),
  });

  const status = loading && !data ? '加载中…' : data && data.length === 0 ? '没有安排' : null;

  return (
    <div className="mdv" data-days={dayCount}>
      <div className="mdv__toolbar">
        {error ? (
          <span className="cal-error" role="alert">
            日程加载失败：{error.message}
          </span>
        ) : (
          <span className="mdv__status" role="status">
            {status}
          </span>
        )}
        <SegmentedControl
          options={SPAN_OPTIONS}
          value={spanValue}
          onChange={setSpan}
          size="sm"
          ariaLabel="显示天数"
        />
      </div>

      <div className="mdv__scroll">
        <div className="mdv__grid" style={{ ['--wv-hour' as string]: `${hourHeight}px` }}>
          <div className="mdv__head">
            <div className="mdv__gutter-head" />
            {days.map((day) => {
              const content = (
                <>
                  <span className="mdv__daynum">{Number(day.slice(8))}</span>
                  <span className="mdv__dayname">{WEEKDAY[dayOfWeek(day)]}</span>
                </>
              );
              const className = `mdv__dayhead${day === today ? ' mdv__dayhead--today' : ''}`;
              return onOpenDay ? (
                // The header is the control, not the column. It is a grid
                // sibling of the column today, but stopping the click keeps
                // navigation from ever reaching a create/range handler if the
                // head markup moves inside the column later.
                // `wv__dayhead--button` is reused because it is the existing
                // button reset/hover/focus treatment for this exact header shape.
                <button
                  type="button"
                  className={`${className} wv__dayhead--button`}
                  key={day}
                  aria-label={`打开 ${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 的日视图`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDay(day);
                  }}
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

          <div className="mdv__allday" role="group" aria-label="全天">
            <div className="mdv__gutter-head">全天</div>
            {days.map((day) => {
              const items = allDayByDay.get(day) ?? [];
              return (
                <div
                  className={`mdv__allday-cell${items.length === 0 ? ' mdv__allday-cell--empty' : ''}`}
                  key={day}
                >
                  {items.map((entry) => (
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
              );
            })}
          </div>

          <div className="mdv__body" style={{ height: totalMinutes * pxPerMinute + 24 }}>
            <div className="mdv__gutter" aria-hidden="true">
              {hours.map((h) => (
                <div className="mdv__hour" key={h} style={{ height: hourHeight }}>
                  <span>{hourLabel(h)}</span>
                </div>
              ))}
            </div>

            {days.map((day) => {
              const placed = layoutOverlapping(
                (byDay.get(day) ?? []).map((b, i) => ({
                  id: `${b.entry.id}-${i}`,
                  start: b.start,
                  end: b.end,
                })),
              );
              const lookup = new Map(placed.map((p) => [p.id, p]));
              return (
                <div
                  className={`mdv__col${day === today ? ' mdv__col--today' : ''}${onCreateAt || onCreateRange ? ' cal-week-col--create' : ''}${onCreateRange ? ' cal-range-col' : ''}`}
                  key={day}
                  onClick={(e) => onColumnClick(e, day)}
                  {...(onCreateRange ? rangeSelection.handlers(day) : {})}
                >
                  {hours.slice(0, -1).map((h) => (
                    <div className="mdv__line" key={h} style={{ height: hourHeight }} />
                  ))}
                  {(byDay.get(day) ?? []).map((b, i) => {
                    const id = `${b.entry.id}-${i}`;
                    const p = lookup.get(id);
                    const top = Math.max(0, b.start) * pxPerMinute;
                    const height = Math.max(20, (b.end - Math.max(0, b.start)) * pxPerMinute - 2);
                    const width = p ? 100 / p.columns : 100;
                    const left = p ? (p.column * 100) / p.columns : 0;
                    return (
                      <div
                        key={id}
                        className="mdv__block"
                        style={{
                          top,
                          height,
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                        }}
                      >
                        <Chip
                          title={b.entry.title}
                          time={entryTimeLabel(b.entry)}
                          color={b.entry.color}
                          done={b.entry.done}
                          allDay={b.entry.allDay}
                          onClick={onOpenEntry ? () => onOpenEntry(b.entry) : undefined}
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
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
