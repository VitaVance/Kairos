import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { addDays, startOfWeek } from '@todolist/core';
import { Chip, EmptyState, useTranslation } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import { entryTimeLabel, formatMonthYear, localDateKey, weekdayLabels } from './time-math';
import './calendar.css';

export interface MonthViewProps {
  cursor: LocalDate;
  today: LocalDate;
  onDayClick?: (date: LocalDate) => void;
  onOpenDay?: (date: LocalDate) => void;
  /** Click on a cell's empty area (not a chip) → create an event on that day. */
  onCreateAt?: (date: LocalDate) => void;
  /**
   * Click an event chip. Month is a dense overview, but a chip that is visibly
   * a chip and does nothing when clicked reads as broken — every other view
   * opens the entry, so this one must too.
   */
  onOpenEntry?: (entry: CalendarEntry) => void;
}

function buildGrid(cursor: LocalDate): LocalDate[][] {
  const first = `${cursor.slice(0, 7)}-01` as LocalDate;
  const gridStart = startOfWeek(first);
  const rows: LocalDate[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: LocalDate[] = [];
    for (let i = 0; i < 7; i++) row.push(addDays(gridStart, w * 7 + i));
    rows.push(row);
  }
  return rows;
}

export function MonthView({ cursor, today, onDayClick, onOpenDay, onCreateAt, onOpenEntry }: MonthViewProps) {
  const { t } = useTranslation('calendar');
  // Narrow labels repeat across languages ("M", "T", "T" …), so the strip is
  // keyed by index; recomputed per render so a live switch relabels it.
  const weekdays = weekdayLabels('narrow');
  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const rangeFrom = grid[0]?.[0] ?? cursor;
  const rangeTo = grid[5]?.[6] ?? cursor;
  const { data, loading, error } = useRangeEntries(rangeFrom, rangeTo);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data ?? []) {
      // Bucket by the app-local calendar day. `startAt` is a UTC instant, so
      // slicing it would file evening events and local-midnight all-day items
      // on the wrong day (and the wrong month) outside UTC.
      const key = localDateKey(entry.startAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [data]);

  const monthPrefix = cursor.slice(0, 7);

  /**
   * Pending single-click open. A month cell does two things on the same
   * target — single click drills into the day, double click creates an event —
   * and the browser reports only one `dblclick` after having already delivered
   * the first `click`. Acting on that first click immediately navigated to the
   * day view, so the second click of a double-click landed *there*: the event
   * was created on the right date but the user was yanked off the month grid
   * mid-gesture. Deferring the open by one double-click window lets the second
   * click cancel it. 250 ms is the conventional threshold; anything longer
   * makes a plain click feel laggy.
   */
  const openTimer = useRef<number | null>(null);
  const cancelPendingOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  useEffect(() => cancelPendingOpen, []);

  function onCellClick(event: ReactMouseEvent<HTMLDivElement>, day: LocalDate) {
    // Cursor move on any cell click (unchanged behavior).
    onDayClick?.(day);
    // A click on a chip belongs to that chip, not the cell.
    if ((event.target as HTMLElement).closest('.tl-chip')) return;
    // Creating an event is a deliberate double-click, so a stray click never
    // spawns a blank dialog.
    if (event.detail >= 2) {
      cancelPendingOpen();
      onCreateAt?.(day);
      return;
    }
    if (!onOpenDay) return;
    cancelPendingOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      onOpenDay(day);
    }, 250);
  }

  return (
    <div className="mv">
      <div className="mv__weekdays" aria-hidden="true">
        {weekdays.map((d, i) => (
          <span key={i} className="mv__weekday">
            {d}
          </span>
        ))}
      </div>
      {/*
        No `role="grid"`: there is no grid keyboard model (no arrow-key cell
        navigation, no single tab stop for the grid), so the role would promise
        behaviour that does not exist. The cells are pointer-only; the chips
        inside them are the real controls and stay real buttons. A labelled
        group is the honest container.
      */}
      <div className="mv__grid" role="group" aria-label={formatMonthYear(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)))}>
        {grid.map((week, wi) => (
          <div className="mv__week" key={wi}>
            {week.map((day) => {
              const entries = byDay.get(day) ?? [];
              const outside = !day.startsWith(monthPrefix);
              const isToday = day === today;
              return (
                <div
                  className={`mv__cell${outside ? ' mv__cell--out' : ''}${isToday ? ' mv__cell--today' : ''}`}
                  key={day}
                  onClick={(e) => onCellClick(e, day)}
                >
                  <span className={`mv__date${isToday ? ' mv__date--today' : ''}`}>{Number(day.slice(8))}</span>
                  <div className="mv__events">
                    {entries.slice(0, 4).map((e) => (
                      <Chip
                        key={`${e.source}-${e.id}`}
                        title={e.title}
                        time={e.period ? entryTimeLabel(e) : undefined}
                        color={e.color}
                        done={e.done}
                        allDay={e.allDay}
                        {...(onOpenEntry ? { onClick: () => onOpenEntry(e) } : {})}
                      />
                    ))}
                    {entries.length > 4 ? <span className="mv__more">+{entries.length - 4}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {error ? (
        <p className="cal-error" role="alert">
          {t('loadFailed', { message: error.message })}
        </p>
      ) : loading && !data ? (
        <EmptyState message={t('loading')} compact />
      ) : null}
    </div>
  );
}
