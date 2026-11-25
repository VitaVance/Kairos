import { useMemo, useState } from 'react';
import type { CalendarEntry, LocalDate } from '@todolist/core';
import { addDays, startOfWeek } from '@todolist/core';
import { Chip, SegmentedControl, useTranslation } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import {
  entryTimeLabel,
  formatMonthDay,
  formatMonthName,
  formatNumericMonthDay,
  formatRange,
  localDateKey,
  weekdayLabels,
} from './time-math';
import './calendar.css';

export type MultiWeekDensity = 2 | 3 | 4;

export interface MultiWeekViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /** Consecutive weeks shown initially. The in-view control changes it live. */
  weeks?: MultiWeekDensity;
  /**
   * Notified whenever the density control changes. The shell listens so its
   * header can name the range actually on screen — a 3-week window straddles
   * a month boundary, so the title cannot be derived from the cursor alone.
   */
  onWeeksChange?: (weeks: MultiWeekDensity) => void;
  /** Click a compact event chip (same contract as WeekView). */
  onOpenEntry?: (entry: CalendarEntry) => void;
  /**
   * Activate a week row's own header → open that week in the week view.
   * Emitted with the week's Monday.
   */
  onOpenWeek?: (date: LocalDate) => void;
  /**
   * Activate a day's numeral → open that day in the day view. Only the date
   * strip in the cell head is a control; the cell body keeps the chips and the
   * `+N more` indicator, so opening an entry never also opens the day.
   */
  onOpenDay?: (date: LocalDate) => void;
}

type DensityValue = '2' | '3' | '4';

const CHIPS_PER_DAY = 3;

/**
 * Several consecutive weeks as one scrolling column of 7-column rows.
 *
 * Entries render as compact chips instead of time blocks: this view trades
 * vertical precision for breadth. Paging lives in the TopBar (one week per
 * step); the density control here changes how many weeks are in the column.
 */
export function MultiWeekView({
  cursor,
  today,
  weeks = 3,
  onOpenEntry,
  onWeeksChange,
  onOpenWeek,
  onOpenDay,
}: MultiWeekViewProps) {
  const { t } = useTranslation('calendar');
  const densityOptions = (['2', '3', '4'] as const).map((value) => ({
    value,
    label: t('spanWeeks', { weeks: Number(value) }),
  }));
  const weekdays = weekdayLabels('narrow');
  const [density, setDensityState] = useState<DensityValue>(String(weeks) as DensityValue);
  const weekCount = Number(density) as MultiWeekDensity;

  const setDensity = (next: DensityValue) => {
    setDensityState(next);
    onWeeksChange?.(Number(next) as MultiWeekDensity);
  };

  const rangeStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const rangeEnd = useMemo(() => addDays(rangeStart, weekCount * 7 - 1), [rangeStart, weekCount]);
  const { data, loading, error } = useRangeEntries(rangeStart, rangeEnd);

  const weeksOfDays = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, w) =>
        Array.from({ length: 7 }, (_, i) => addDays(rangeStart, w * 7 + i)),
      ),
    [rangeStart, weekCount],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data ?? []) {
      const key = localDateKey(entry.startAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [data]);

  const status = loading && !data ? t('loading') : data && data.length === 0 ? t('empty') : null;

  return (
    <div className={`mwv${onOpenWeek ? ' mwv--weeklinks' : ''}`}>
      <div className="mwv__toolbar">
        {error ? (
          <span className="cal-error" role="alert">
            {t('loadFailed', { message: error.message })}
          </span>
        ) : (
          <span className="mwv__status" role="status">
            {status}
          </span>
        )}
        <SegmentedControl
          options={densityOptions}
          value={density}
          onChange={setDensity}
          size="sm"
          ariaLabel={t('multiWeek.spanLabel')}
        />
      </div>

      <div className="mwv__scroll">
        <div className="mwv__weekdays" aria-hidden="true">
          {onOpenWeek ? <span className="mwv__weekday mwv__weekday--gutter" /> : null}
          {weekdays.map((d, i) => (
            <span key={i} className="mwv__weekday">
              {d}
            </span>
          ))}
        </div>

        <div className="mwv__grid" role="grid" aria-label={t('multiWeek.gridAria', { weeks: weekCount })}>
          {weeksOfDays.map((week) => {
            const monday = week[0];
            return (
              <div className="mwv__week" role="row" key={week[0]}>
                {onOpenWeek && monday ? (
                  <div className="mwv__weeklead" role="rowheader">
                    <button
                      type="button"
                      className="mwv__weekopen"
                      aria-label={t('multiWeek.openWeekAria', { date: formatMonthDay(monday) })}
                      onClick={() => onOpenWeek(monday)}
                    >
                      {formatNumericMonthDay(monday)}
                    </button>
                  </div>
                ) : null}
                {week.map((day) => {
                  const entries = byDay.get(day) ?? [];
                  const isToday = day === today;
                  const firstOfMonth = day.slice(8) === '01';
                  return (
                    <div
                      className={`mwv__cell${isToday ? ' mwv__cell--today' : ''}`}
                      role="gridcell"
                      key={day}
                    >
                      <div className="mwv__cellhead">
                        {onOpenDay ? (
                          // Only the numeral is a control: the cell also hosts
                          // chips (which open their entry) and a `+N more`
                          // indicator, so the cell itself must not be a button.
                          <button
                            type="button"
                            className={`mwv__date mwv__datebtn${isToday ? ' mwv__date--today' : ''}`}
                            aria-label={t('openDayAria', { date: formatMonthDay(day) })}
                            onClick={() => onOpenDay(day)}
                          >
                            {Number(day.slice(8))}
                          </button>
                        ) : (
                          <span className={`mwv__date${isToday ? ' mwv__date--today' : ''}`}>
                            {Number(day.slice(8))}
                          </span>
                        )}
                        {firstOfMonth ? (
                          <span className="mwv__monthtag">{formatMonthName(Number(day.slice(5, 7)))}</span>
                        ) : null}
                      </div>
                      <div className="mwv__events">
                        {entries.slice(0, CHIPS_PER_DAY).map((entry) => (
                          <div className="mwv__chip" key={`${entry.source}-${entry.id}`}>
                            <Chip
                              title={entry.title}
                              time={entry.period ? entryTimeLabel(entry) : entry.allDay ? undefined : formatRange(entry.startAt, entry.endAt)}
                              color={entry.color}
                              done={entry.done}
                              allDay={entry.allDay}
                              onClick={onOpenEntry ? () => onOpenEntry(entry) : undefined}
                            />
                          </div>
                        ))}
                        {entries.length > CHIPS_PER_DAY ? (
                          <span className="mwv__more">+{entries.length - CHIPS_PER_DAY}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
