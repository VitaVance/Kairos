import { useMemo } from 'react';
import type { LocalDate } from '@todolist/core';
import { useTranslation } from '@todolist/ui';
import { useRangeEntries } from '../data/useCalendarEntries';
import { buildYear, heatByDay, heatStep, HEAT_BUCKETS } from './year-math';
import { formatFullDate, formatMonthName, formatMonthYear, weekdayLabels } from './time-math';
import './calendar.css';

export interface YearViewProps {
  cursor: LocalDate;
  today: LocalDate;
  /**
   * Open a month — emitted with the first of that month, so the shell can
   * switch to month view at that date.
   */
  onOpenDay?: (date: LocalDate) => void;
}

/**
 * Twelve mini month grids in one responsive, container-queried grid.
 *
 * Each day is a whole-cell heat tile, GitHub-contribution style: its fill
 * steps from `--tl-heat-1` (a quiet day) through `--tl-heat-4` (very busy),
 * with the numeral on top. A day with no entries carries no fill at all, so
 * an empty calendar and a quiet one never look alike. The month cards are a
 * density map, not a planner. Clicking (or
 * Enter/Space on) a month card opens it. Column count
 * (12 → 6 → 4 → 3) follows the *container* width, so the view reflows
 * correctly inside the shell instead of keying off the window.
 */
export function YearView({ cursor, today, onOpenDay }: YearViewProps) {
  const { t } = useTranslation('calendar');
  // Recomputed per render against the live locale so a switch relabels the
  // strip; narrow labels repeat, so it is keyed by index below.
  const weekdays = weekdayLabels('narrow');
  const year = Number(cursor.slice(0, 4));
  const months = useMemo(() => buildYear(year), [year]);
  const { data, loading, error } = useRangeEntries(
    `${year}-01-01` as LocalDate,
    `${year}-12-31` as LocalDate,
  );
  const heat = useMemo(() => heatByDay(data ?? [], year), [data, year]);

  const status =
    loading && !data
      ? t('loading')
      : error
        ? t('loadFailed', { message: error.message })
        : data && data.length === 0
          ? t('year.empty')
          : '';

  return (
    <div className="yrv">
      <div className="yrv__meta">
        <span className="yrv__year">{year}</span>
        {/*
         * The legend is the only key to the colour ramp, so it is a real list:
         * one filled swatch per step, labelled with the *entry count* that
         * step stands for. Both swatch and label come from `HEAT_BUCKETS`, the
         * same source the cells classify by, so the two can never drift.
         */}
        <ul className="yrv__legend" aria-label={t('year.legendAria')}>
          {HEAT_BUCKETS.map(({ step, label }) => (
            <li key={step} className="yrv__legend-item">
              <span
                className={`yrv__legend-swatch yrv__legend-swatch--h${step}`}
                aria-hidden="true"
              />
              <span className="yrv__legend-label">{t('year.legendEntries', { range: label })}</span>
            </li>
          ))}
        </ul>
        <span className="yrv__status" role="status">
          {status}
        </span>
      </div>

      <div className="yrv__container">
        <div className="yrv__grid">
          {months.map((month) => {
            const monthName = formatMonthName(month.month);
            const monthLabel = formatMonthYear(year, month.month);
            const firstOfMonth = `${year}-${String(month.month).padStart(2, '0')}-01` as LocalDate;
            const open = () => onOpenDay?.(firstOfMonth);
            return (
              // The whole card opens the month; the name button is the single
              // keyboard-reachable activator (cards themselves are not focusable
              // to avoid a redundant second tab stop per month).
              <div
                className="yrv__month"
                role="group"
                aria-label={monthLabel}
                key={month.key}
                onClick={open}
              >
                <div className="yrv__monthhead">
                  <button
                    type="button"
                    className="yrv__monthname"
                    aria-label={t('year.openMonth', { month: monthLabel })}
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                  >
                    {monthName}
                  </button>
                </div>
                <div className="yrv__mini" role="grid" aria-label={monthLabel}>
                  <div className="yrv__weekdays" aria-hidden="true">
                    {weekdays.map((d, i) => (
                      <span key={i} className="yrv__weekday">
                        {d}
                      </span>
                    ))}
                  </div>
                  {month.weeks.map((week) => (
                    <div className="yrv__week" role="row" key={week[0]?.date}>
                      {week.map((cell) => {
                        const count = cell.inMonth ? (heat.get(cell.date) ?? 0) : 0;
                        const step = heatStep(count);
                        const isToday = cell.date === today;
                        return (
                          <div
                            className={`yrv__cell${cell.inMonth ? '' : ' yrv__cell--out'}${
                              step > 0 ? ` yrv__cell--h${step}` : ''
                            }${isToday ? ' yrv__cell--today' : ''}`}
                            role="gridcell"
                            key={cell.date}
                            aria-label={
                              cell.inMonth
                                ? count > 0
                                  ? t('year.dayCount', {
                                      date: formatFullDate(cell.date),
                                      entries: count,
                                    })
                                  : t('year.dayEmpty', { date: formatFullDate(cell.date) })
                                : undefined
                            }
                          >
                            <span className="yrv__daynum">{Number(cell.date.slice(8))}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
