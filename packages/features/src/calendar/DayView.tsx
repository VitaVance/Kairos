import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { Chip, EmptyState } from '@todolist/ui';
import { useDayEntries } from '../data/useCalendarEntries';
import {
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  formatMinutes,
  formatMinuteRange,
  formatRange,
  entryTimeLabel,
  hourLabel,
  layoutOverlapping,
  minutesOfDay,
} from './time-math';
import { useTimeRangeSelection } from './useTimeRangeSelection';
import './calendar.css';

export interface DayViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** Emitted with an "HH:MM" snapped to 15 minutes when an empty slot is clicked. */
  onCreateAt?: (time: string) => void;
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
const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * One-day time grid: a single wide column on a 00:00–24:00 axis.
 *
 * Interaction: clicking empty column space emits `onCreateAt("HH:MM")` snapped
 * to the nearest quarter hour; clicking a block emits `onOpenEntry`. There is no
 * keyboard path for "click an empty slot" — a create button in the header would
 * be the accessible alternative and is a deliberate follow-up, out of scope here.
 */
export function DayView({
  cursor,
  today,
  onCreateAt,
  onCreateRange,
  onOpenEntry,
  hourHeight = HOUR_PX,
}: DayViewProps) {
  const { data, loading, error } = useDayEntries(cursor);

  const pxPerMinute = hourHeight / 60;
  const totalMinutes = MINUTES_PER_DAY;

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

  function onColumnClick(event: MouseEvent<HTMLDivElement>) {
    // A completed range sweep leaves one synthetic click; consume it.
    if (rangeSelection.consumeClick()) return;
    if (!onCreateAt) return;
    // A click that lands on an existing block belongs to that block: it opens
    // the entry instead of spawning a second event on top of it.
    if ((event.target as HTMLElement).closest('.cal-day__block')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = (event.clientY - rect.top) / pxPerMinute;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, snapped));
    onCreateAt(formatMinutes(clamped));
  }

  // Drag across empty column space → a live range overlay → editor on release.
  // The last selectable minute is 23:45, matching the click path: "24:00" is not
  // a time the editor can represent on the same day.
  const rangeSelection = useTimeRangeSelection({
    enabled: Boolean(onCreateRange),
    bounds: { min: 0, max: MINUTES_PER_DAY - SNAP_MINUTES },
    pxPerMinute,
    blockSelector: '.cal-day__block',
    dragThresholdPx: DRAG_THRESHOLD_PX,
    onSelect: (_day, start, end) => onCreateRange?.(formatMinutes(start), formatMinutes(end)),
  });

  const weekdayIndex = useMemo(() => {
    // Local date → Monday-first index without Temporal: parse as UTC so the
    // result stays time-zone free (the date string itself is timezone-free).
    const d = new Date(`${cursor}T00:00:00Z`);
    return (d.getUTCDay() + 6) % 7;
  }, [cursor]);

  const isToday = cursor === today;

  return (
    <div className="cal-day">
      <header className="cal-day__head">
        <span className="cal-day__date">
          {cursor.slice(0, 4)}年{Number(cursor.slice(5, 7))}月{Number(cursor.slice(8))}日
        </span>
        <span className="cal-day__weekday">{WEEKDAY[weekdayIndex]}</span>
        {isToday ? <span className="cal-day__today">今天</span> : null}
      </header>

      {error ? (
        <p className="cal-error" role="alert">
          日程加载失败：{error.message}
        </p>
      ) : null}

      {allDay.length > 0 ? (
        <div className="cal-day__allday" role="group" aria-label="全天">
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
            message="没有安排"
            hint={onCreateAt || onCreateRange ? '点击时间轴空白处新建日程，或按住拖动选择时间段' : undefined}
            compact
          />
        </div>
      ) : null}

      <div className="cal-day__body" style={{ height: totalMinutes * pxPerMinute }}>
        <div className="cal-day__gutter" aria-hidden="true">
          {hours.map((h) => (
            <span className="cal-day__hourlabel" key={h} style={{ top: h * hourHeight }}>
              {hourLabel(h)}
            </span>
          ))}
        </div>

        <div
          className={`cal-day__col${onCreateAt || onCreateRange ? ' cal-day__col--create' : ''}${onCreateRange ? ' cal-range-col' : ''}`}
          onClick={onColumnClick}
          {...(onCreateRange ? rangeSelection.handlers(cursor) : {})}
        >
          {hours.slice(0, -1).map((h) => (
            <div className="cal-day__line" key={h} style={{ height: hourHeight }} />
          ))}

          {rangeSelection.selection ? (
            <div
              className="cal-range"
              aria-hidden="true"
              style={{
                top: rangeSelection.selection.start * pxPerMinute,
                height: (rangeSelection.selection.end - rangeSelection.selection.start) * pxPerMinute,
              }}
            >
              <span className="cal-range__label">
                {formatMinuteRange(rangeSelection.selection.start, rangeSelection.selection.end)}
              </span>
            </div>
          ) : null}

          {blocks.map((b, i) => {
            const id = `${b.entry.id}-${i}`;
            const p = placed.find((x) => x.id === id);
            const top = b.start * pxPerMinute;
            const height = Math.max(22, (b.end - b.start) * pxPerMinute - 2);
            const width = p ? 100 / p.columns : 100;
            const left = p ? (p.column * 100) / p.columns : 0;
            return (
              <div
                key={id}
                className="cal-day__block"
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
        </div>
      </div>
    </div>
  );
}
