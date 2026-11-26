import { useMemo } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { addDays, eachDay, startOfWeek } from '@todolist/core';
import { useTranslation } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import { entryTimeLabel, localDateKey, weekdayLabels } from './time-math';

export interface TimelineViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** How many days from the week start to show. */
  span?: number;
}

/**
 * Agenda view: one row per day — a date slab, a start-time gutter, a tick on a
 * continuous day axis, and the event block.
 *
 * The axis is the point of the view: a day's entries hang off one line, so the
 * shape of the day (a dense morning, a single late slot) reads before any text
 * does. The block carries the time on its first line and the title beneath it,
 * which is what makes a block editable-looking at 40px tall; a single-line
 * strip read as a list row instead of an appointment.
 */
export function TimelineView({ cursor, today, span = 7 }: TimelineViewProps) {
  const { t } = useTranslation('calendar');
  // Monday-first, locale-derived; the index `i` matches `eachDay` from a week start.
  const weekdays = weekdayLabels('short');
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
      {loading && !data ? (
        <p className="cal-status" role="status">
          {t('loading')}
        </p>
      ) : null}
      {error ? (
        <p className="cal-error" role="alert">
          {t('loadFailed', { message: error.message })}
        </p>
      ) : null}
      {days.map((day, i) => {
        const entries = byDay.get(day) ?? [];
        const isToday = day === today;
        return (
          <section className={`tv__day${isToday ? ' tv__day--today' : ''}`} key={day}>
            {/* The date slab is one grid cell that spans every entry row, so
                the numeral stays pinned to the top of its day while the axis
                and blocks run past it. `aria-hidden` on the visual parts keeps
                the heading from being read twice by the section's label. */}
            <h2 className="tv__date-cell">
              <span className={`tv__date${isToday ? ' tv__date--today' : ''}`}>
                {Number(day.slice(8))}
              </span>
              <span className="tv__weekday">{weekdays[i]}</span>
              {isToday ? <span className="tv__badge">{t('today')}</span> : null}
            </h2>

            {entries.length === 0 ? (
              <p className="tv__empty">{t('empty')}</p>
            ) : (
              <ol className="tv__list">
                {entries.map((e) => {
                  // Gutter: the start time alone, so the column reads as a
                  // timetable down the whole day. The full range lives inside
                  // the block, which is where a reader looks for "how long".
                  const label = entryTimeLabel(e);
                  const start = label.includes(' - ') ? label.split(' - ')[0]! : label;
                  return (
                    <li className="tv__item" key={`${e.source}-${e.id}`}>
                      <time className="tv__time" dateTime={e.startAt}>
                        <span className="tl-visually-hidden">{label}</span>
                        <span aria-hidden="true">{start}</span>
                      </time>
                      <span className="tv__axis" aria-hidden="true" />
                      <div
                        className={`tv__event${e.done ? ' tv__event--done' : ''}`}
                        style={{ ['--chip-color' as string]: e.color }}
                      >
                        <span className="tv__event-time">{label}</span>
                        <span className="tv__event-title">{e.title}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
