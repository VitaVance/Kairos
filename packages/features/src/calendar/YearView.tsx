import { useMemo } from 'react';
import type { LocalDate } from '@todolist/core';
import { useRangeEntries } from '../data/useCalendarEntries';
import { buildYear, heatByDay, MAX_HEAT } from './year-math';
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

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * The heat scale, spelled out. `MAX_HEAT` dots per step; the label states how
 * many entries that many dots means. Kept next to the grid so the legend can
 * never drift from `heatLevel`.
 */
const LEGEND: readonly { level: number; label: string }[] = [
  { level: 0, label: '无' },
  { level: 1, label: '1' },
  { level: 2, label: '2' },
  { level: 3, label: '3' },
  { level: 4, label: '4+' },
];

/**
 * Twelve mini month grids in one responsive, container-queried grid.
 *
 * Each day carries a 0–4 dot heat strip for its entry count instead of
 * rendering the entries themselves: the year is a density map, not a planner.
 * Clicking (or Enter/Space on) a month card opens it. Column count
 * (12 → 6 → 4 → 3) follows the *container* width, so the view reflows
 * correctly inside the shell instead of keying off the window.
 */
export function YearView({ cursor, today, onOpenDay }: YearViewProps) {
  const year = Number(cursor.slice(0, 4));
  const months = useMemo(() => buildYear(year), [year]);
  const { data, loading, error } = useRangeEntries(
    `${year}-01-01` as LocalDate,
    `${year}-12-31` as LocalDate,
  );
  const heat = useMemo(() => heatByDay(data ?? [], year), [data, year]);

  const status = loading && !data ? '加载中…' : error ? `日程加载失败：${error.message}` : data && data.length === 0 ? '这一年还没有安排' : '';

  return (
    <div className="yrv">
      <div className="yrv__meta">
        <span className="yrv__year">{year}</span>
        {/*
         * A real legend, not a decoration. The dots encode entry count as
         * 0–4, which is not guessable from "少…多" alone — the previous version
         * was `aria-hidden`, so it was invisible to screen readers *and*
         * unexplained to everyone else while still looking like a control.
         * Each item now states the count it represents.
         */}
        <ul className="yrv__legend" aria-label="日程密度图例">
          {LEGEND.map(({ level, label }) => (
            <li key={level} className="yrv__legend-item">
              <span className="yrv__legend-dots" aria-hidden="true">
                {Array.from({ length: MAX_HEAT }, (_, i) => (
                  <i key={i} className={`yrv__dot${i < level ? ' yrv__dot--on' : ''}`} />
                ))}
              </span>
              <span className="yrv__legend-label">{label}</span>
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
            const monthName = `${month.month}月`;
            const firstOfMonth = `${year}-${String(month.month).padStart(2, '0')}-01` as LocalDate;
            const open = () => onOpenDay?.(firstOfMonth);
            return (
              // The whole card opens the month; the name button is the single
              // keyboard-reachable activator (cards themselves are not focusable
              // to avoid a redundant second tab stop per month).
              <div
                className="yrv__month"
                role="group"
                aria-label={`${year}年${monthName}`}
                key={month.key}
                onClick={open}
              >
                <div className="yrv__monthhead">
                  <button
                    type="button"
                    className="yrv__monthname"
                    aria-label={`打开${year}年${monthName}月视图`}
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                  >
                    {monthName}
                  </button>
                </div>
                <div className="yrv__mini" role="grid" aria-label={`${year}年${monthName}日历`}>
                  <div className="yrv__weekdays" aria-hidden="true">
                    {WEEKDAYS.map((d) => (
                      <span key={d} className="yrv__weekday">
                        {d}
                      </span>
                    ))}
                  </div>
                  {month.weeks.map((week) => (
                    <div className="yrv__week" role="row" key={week[0]?.date}>
                      {week.map((cell) => {
                        const level = cell.inMonth ? (heat.get(cell.date) ?? 0) : 0;
                        const isToday = cell.date === today;
                        return (
                          <div
                            className={`yrv__cell${cell.inMonth ? '' : ' yrv__cell--out'}${
                              isToday ? ' yrv__cell--today' : ''
                            }`}
                            role="gridcell"
                            key={cell.date}
                            aria-label={
                              cell.inMonth
                                ? `${Number(cell.date.slice(8))}日${level > 0 ? `，${level} 项` : ''}`
                                : undefined
                            }
                          >
                            <span className="yrv__daynum">{Number(cell.date.slice(8))}</span>
                            {level > 0 ? (
                              <span className="yrv__heat" aria-hidden="true">
                                {Array.from({ length: MAX_HEAT }, (_, i) => (
                                  <i
                                    key={i}
                                    className={`yrv__dot${i < level ? ' yrv__dot--on' : ''}`}
                                  />
                                ))}
                              </span>
                            ) : null}
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
