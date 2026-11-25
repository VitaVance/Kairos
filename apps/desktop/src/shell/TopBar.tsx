import { useCallback } from 'react';
import type { LocalDate } from '@todolist/core';
import { addDays, addMonths } from '@todolist/core';
import type { ViewKind } from '@todolist/features';
import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './icons';

export interface TopBarProps {
  title: string;
  view: ViewKind;
  cursor: LocalDate;
  onCursorChange: (date: LocalDate) => void;
  today: LocalDate;
  /** Opens a blank event at the cursor date. */
  onCreateEvent?: () => void;
  /** Weeks currently shown by the multi-week grid; paging steps by this. */
  weeksShown?: number;
  /** Days currently shown by the multi-day grid; paging steps by this. */
  daysShown?: number;
  /** Right-hand slot, e.g. the theme toggle. */
  actions?: ReactNode;
}

const WEEKLY_VIEWS: ReadonlySet<ViewKind> = new Set(['week', 'agenda']);

export function TopBar({
  title,
  view,
  cursor,
  onCursorChange,
  today,
  onCreateEvent,
  weeksShown = 3,
  daysShown = 3,
  actions,
}: TopBarProps) {
  // True for every view that shows a date range; the quadrant matrix does not,
  // so its prev/next arrows would be decorative — hide them rather than let
  // them silently jump to today (which is all they could do).
  const temporal = view !== 'quadrant';

  const step = useCallback(
    (dir: -1 | 1) => {
      // Each view steps by exactly what it displays, otherwise the arrow moves a
      // different distance than the grid visibly shifted and the cursor drifts
      // out of sync with the highlighted range.
      if (WEEKLY_VIEWS.has(view)) onCursorChange(addDays(cursor, dir * 7));
      else if (view === 'multi-week') onCursorChange(addDays(cursor, dir * weeksShown * 7));
      else if (view === 'multi-day') onCursorChange(addDays(cursor, dir * daysShown));
      else if (view === 'month') onCursorChange(addMonths(cursor, dir));
      else if (view === 'year') onCursorChange(addMonths(cursor, dir * 12));
      else onCursorChange(addDays(cursor, dir));
    },
    [view, cursor, onCursorChange, weeksShown, daysShown],
  );

  return (
    <header className="top-bar">
      <h1 className="top-bar__title" title={title}>
        {title}
      </h1>

      <div className="top-bar__actions">
        <button type="button" className="top-bar__add" aria-label="新建日程" onClick={onCreateEvent}>
          <PlusIcon />
        </button>

        {temporal ? (
          <div className="top-bar__nav">
            <button type="button" aria-label="上一个" onClick={() => step(-1)}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="top-bar__today" onClick={() => onCursorChange(today)}>
              今天
            </button>
            <button type="button" aria-label="下一个" onClick={() => step(1)}>
              <ChevronRightIcon />
            </button>
          </div>
        ) : null}

        {actions ?? null}
      </div>
    </header>
  );
}
