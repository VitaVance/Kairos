import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDate } from '@todolist/core';
import { addDays, startOfWeek, todayLocal } from '@todolist/core';
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  Popover,
} from '@todolist/ui';
import { buildMonthGrid } from '../calendar/year-math';
import { trapTabKey } from './picker-nav';
import {
  WEEKDAY_SHORT,
  dayInMonth,
  dayOf,
  formatDayLabel,
  formatFriendlyDate,
  formatMonthHeading,
  monthKeyOf,
  nextMonday,
  shiftMonth,
} from './picker-math';
import type { MonthKey } from './picker-math';
import './pickers.css';

export interface DatePickerProps {
  /** Currently selected day, or null when unset. */
  value: LocalDate | null;
  /** Called with the chosen day. The popover closes after a pick. */
  onChange: (date: LocalDate) => void;
  /** When supplied, a 清除 action appears and unsets the date. */
  onClear?: () => void;
  /** Overridable for tests / deterministic renders. */
  today?: LocalDate;
  disabled?: boolean;
  /** Accessible name of the trigger button. */
  label: string;
  /** Placeholder shown when `value` is null. */
  placeholder?: string;
  /** Extra class on the trigger button. */
  className?: string;
}

const MONTHS_SHORT = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/**
 * Themeable date field: a friendly trigger that opens a Monday-first month
 * grid. The grid is `buildMonthGrid` from the year view, so there is exactly
 * one 6×7 grid builder in the app.
 *
 * Keyboard (while the popover is open):
 *   ←/→        previous / next day
 *   ↑/↓        previous / next week
 *   PageUp     previous month      PageDown  next month
 *   Home       Monday of this week End       Sunday of this week
 *   Enter      select the focused day
 *   Escape     close (handled by Popover)
 *   Tab        trapped inside the popover
 */
export function DatePicker({
  value,
  onChange,
  onClear,
  today: todayProp,
  disabled = false,
  label,
  placeholder = '设置日期',
  className = '',
}: DatePickerProps) {
  const today = todayProp ?? todayLocal();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<MonthKey>(() => monthKeyOf(value ?? today));
  const [focusDate, setFocusDate] = useState<LocalDate>(() => value ?? today);
  const [jumping, setJumping] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const select = (date: LocalDate) => {
    setOpen(false);
    onChange(date);
  };

  // Opening resets the view to the selected day (or today) and focuses it.
  useEffect(() => {
    if (!open) return;
    const start = value ?? today;
    setFocusDate(start);
    setViewMonth(monthKeyOf(start));
    setJumping(false);
  }, [open, value, today]);

  // The focused day button follows the roving `focusDate`, including when a
  // month change moved the focus target into a fresh grid. Skipped while the
  // year/month jump panel is open; returning to the grid restores focus.
  useEffect(() => {
    if (!open || jumping) return;
    dayRefs.current.get(focusDate)?.focus();
  }, [open, focusDate, viewMonth, jumping]);

  const grid = useMemo(() => buildMonthGrid(viewMonth.year, viewMonth.month), [viewMonth]);

  const moveFocus = (next: LocalDate) => {
    setFocusDate(next);
    const key = monthKeyOf(next);
    if (key.year !== viewMonth.year || key.month !== viewMonth.month) setViewMonth(key);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        moveFocus(addDays(focusDate, -1));
        break;
      case 'ArrowRight':
        moveFocus(addDays(focusDate, 1));
        break;
      case 'ArrowUp':
        moveFocus(addDays(focusDate, -7));
        break;
      case 'ArrowDown':
        moveFocus(addDays(focusDate, 7));
        break;
      case 'PageUp': {
        event.preventDefault();
        const next = shiftMonth(monthKeyOf(focusDate), -1);
        moveFocus(dayInMonth(next, dayOf(focusDate)));
        return;
      }
      case 'PageDown': {
        event.preventDefault();
        const next = shiftMonth(monthKeyOf(focusDate), 1);
        moveFocus(dayInMonth(next, dayOf(focusDate)));
        return;
      }
      case 'Home':
        moveFocus(startOfWeek(focusDate));
        break;
      case 'End':
        moveFocus(addDays(startOfWeek(focusDate), 6));
        break;
      // Enter / Space intentionally fall through to the focused day button's
      // native click, so a keypress selects exactly once.
      default:
        return;
    }
    event.preventDefault();
  };

  const stepMonth = (delta: number) => {
    const next = shiftMonth(viewMonth, delta);
    setViewMonth(next);
    // Keep the roving focus point inside the month the arrows navigate to, so
    // the grid never renders without a tabbable day.
    setFocusDate((prev) => dayInMonth(next, dayOf(prev)));
  };

  const stepYear = (delta: number) => {
    const next = { year: viewMonth.year + delta, month: viewMonth.month };
    setViewMonth(next);
    setFocusDate((prev) => dayInMonth(next, dayOf(prev)));
  };

  const triggerText = value === null ? placeholder : formatFriendlyDate(value, today);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`tk-picker-trigger${value === null ? ' tk-picker-trigger--empty' : ''} ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarIcon size={14} />
        <span className="tk-picker-trigger__text">{triggerText}</span>
      </button>

      <Popover open={open} onClose={close} anchorRef={triggerRef} width={286}>
        <div className="tk-cal" onKeyDown={trapTabKey}>
          <div className="tk-cal__head">
            <IconButton label="上个月" variant="quiet" onClick={() => stepMonth(-1)}>
              <ChevronLeftIcon size={16} />
            </IconButton>
            <button
              type="button"
              className="tk-cal__heading"
              aria-expanded={jumping}
              onClick={() => setJumping((v) => !v)}
            >
              {formatMonthHeading(viewMonth)}
              <ChevronDownIcon size={14} />
            </button>
            <IconButton label="下个月" variant="quiet" onClick={() => stepMonth(1)}>
              <ChevronRightIcon size={16} />
            </IconButton>
          </div>

          {jumping ? (
            <div className="tk-cal__jump">
              <div className="tk-cal__jump-year">
                <IconButton label="上一年" variant="quiet" onClick={() => stepYear(-1)}>
                  <ChevronLeftIcon size={16} />
                </IconButton>
                <span className="tk-cal__jump-label" aria-live="polite">
                  {viewMonth.year}年
                </span>
                <IconButton label="下一年" variant="quiet" onClick={() => stepYear(1)}>
                  <ChevronRightIcon size={16} />
                </IconButton>
              </div>
              <div className="tk-cal__jump-months" role="group" aria-label="选择月份">
                {MONTHS_SHORT.map((name, index) => {
                  const month = index + 1;
                  const active = month === viewMonth.month;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`tk-cal__jump-month${active ? ' tk-cal__jump-month--active' : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        const next = { year: viewMonth.year, month };
                        setViewMonth(next);
                        setFocusDate((prev) => dayInMonth(next, dayOf(prev)));
                        setJumping(false);
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className="tk-cal__grid"
              role="grid"
              aria-label={formatMonthHeading(viewMonth)}
              onKeyDown={onGridKeyDown}
            >
              <div className="tk-cal__weekdays" role="row">
                {WEEKDAY_SHORT.map((name) => (
                  <span key={name} className="tk-cal__weekday" role="columnheader" aria-label={`星期${name}`}>
                    {name}
                  </span>
                ))}
              </div>

              {grid.weeks.map((week) => (
                <div className="tk-cal__week" role="row" key={week[0]?.date}>
                  {week.map((cell) => {
                    const isSelected = value === cell.date;
                    const isToday = cell.date === today;
                    const isFocus = cell.date === focusDate;
                    const classes = [
                      'tk-cal__day',
                      cell.inMonth ? '' : 'tk-cal__day--outside',
                      isToday ? 'tk-cal__day--today' : '',
                      isSelected ? 'tk-cal__day--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={cell.date}
                        ref={(el) => {
                          if (el) dayRefs.current.set(cell.date, el);
                          else dayRefs.current.delete(cell.date);
                        }}
                        type="button"
                        role="gridcell"
                        tabIndex={isFocus ? 0 : -1}
                        className={classes}
                        aria-selected={isSelected}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={formatDayLabel(cell.date)}
                        onClick={() => select(cell.date)}
                      >
                        {dayOf(cell.date)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="tk-cal__quick">
            <button type="button" className="tk-cal__chip" onClick={() => select(today)}>
              今天
            </button>
            <button type="button" className="tk-cal__chip" onClick={() => select(addDays(today, 1))}>
              明天
            </button>
            <button type="button" className="tk-cal__chip" onClick={() => select(nextMonday(today))}>
              下周一
            </button>
          </div>

          {onClear ? (
            <div className="tk-cal__foot">
              <button
                type="button"
                className="tk-cal__clear"
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
              >
                清除
              </button>
            </div>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
