import { useMemo } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { addDays, eachDay, startOfWeek } from '@todolist/core';
import { useRangeEntries } from '../data/useCalendarEntries';
import { entryTimeLabel, localDateKey } from './time-math';

export interface TimelineViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** How many days from the week start to show. */
  span?: number;
}

const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** Agenda view: days as sections, entries as a vertical timeline per day. */
export function TimelineView({ cursor, today, span = 7 }: TimelineViewProps) {
  const start = useMemo(() => startOfWeek(cursor), [cursor]);
  const days = useMemo(() => eachDay(start, addDays(start, span - 1)), [start, span]);
  const { data, loading, error } = useRangeEntries(start, addDays(start, span - 1));

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data ?? []) {
      const key = localDateKey(entry.startAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    }
    return map;
  }, [data]);

  return (
    <div className="tv">
      {loading && !data ? <p className="cal-status" role="status">加载中…</p> : null}
      {error ? (
        <p className="cal-error" role="alert">
          日程加载失败：{error.message}
        </p>
      ) : null}
      {days.map((day, i) => {
        const entries = byDay.get(day) ?? [];
        const isToday = day === today;
        return (
          <section className={`tv__day${isToday ? ' tv__day--today' : ''}`} key={day}>
            <header className="tv__head">
              <span className={`tv__date${isToday ? ' tv__date--today' : ''}`}>{Number(day.slice(8))}</span>
              <span className="tv__weekday">{WEEKDAY[i]}</span>
              {isToday ? <span className="tv__badge">今天</span> : null}
            </header>
            {entries.length === 0 ? (
              <p className="tv__empty">没有安排</p>
            ) : (
              <ol className="tv__list">
                {entries.map((e) => (
                  <li className="tv__item" key={`${e.source}-${e.id}`}>
                    <span className="tv__axis" aria-hidden="true" />
                    <time className="tv__time">{entryTimeLabel(e)}</time>
                    <div
                      className={`tv__event${e.done ? ' tv__event--done' : ''}`}
                      style={{ ['--chip-color' as string]: e.color }}
                    >
                      <span className="tv__event-title">{e.title}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
