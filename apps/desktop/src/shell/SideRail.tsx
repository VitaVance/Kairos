import type { ViewKind } from '@todolist/features';
import { IconButton } from '@todolist/ui';
import { ArchiveIcon, CalendarIcon, GridIcon, HelpIcon, InboxIcon, RefreshIcon, SearchIcon } from './icons';

export interface SideRailProps {
  /** The view actually on screen — the highlight is derived from it, never stored. */
  view: ViewKind;
  onSelectView: (view: ViewKind) => void;
  /** Opens the command-palette search overlay. */
  onOpenSearch?: () => void;
  /** Opens the backup/restore panel. */
  onOpenTransfer?: () => void;
  /** Opens the manual update check. */
  onOpenUpdate?: () => void;
  /** Opens the keyboard shortcut reference. */
  onOpenHelp?: () => void;
}

/**
 * The narrow icon rail. Purely navigation — it knows nothing about tasks.
 *
 * The highlight is derived from the `view` that is actually on screen, never a
 * second `nav` state (the old `nav` could desync: `g w` changed the view while
 * the rail still lit 任务). 四象限 is the app's only task screen, so that icon
 * represents it; 日历 covers every calendar view. 任务 is the home entry into
 * the same task screen and, as in the design reference, is not itself a lit
 * destination — exactly one item is ever marked current.
 */
export function SideRail({
  view,
  onSelectView,
  onOpenSearch,
  onOpenTransfer,
  onOpenUpdate,
  onOpenHelp,
}: SideRailProps) {
  const onQuadrant = view === 'quadrant';
  const onCalendar = !onQuadrant;
  const CALENDAR_VIEW_LABEL: Partial<Record<ViewKind, string>> = {
    month: '月视图',
    week: '周视图',
    day: '日视图',
    agenda: '日程',
    'multi-day': '多日',
    'multi-week': '多周',
    year: '年视图',
  };
  const visibleViewLabel = CALENDAR_VIEW_LABEL[view];
  const calendarLabel = visibleViewLabel ? `日历（${visibleViewLabel}）` : '日历';

  return (
    <nav className="side-rail" aria-label="主导航">
      <div className="side-rail__avatar" aria-hidden="true">
        <span>我</span>
      </div>

      <div className="side-rail__group">
        <button
          type="button"
          className="side-rail__item"
          aria-label="任务"
          onClick={() => onSelectView('quadrant')}
        >
          <InboxIcon />
        </button>
        <button
          type="button"
          className={`side-rail__item${onCalendar ? ' side-rail__item--active' : ''}`}
          aria-label={calendarLabel}
          aria-current={onCalendar ? 'page' : undefined}
          onClick={() => onSelectView('month')}
        >
          <CalendarIcon />
        </button>
        <button
          type="button"
          className={`side-rail__item${onQuadrant ? ' side-rail__item--active' : ''}`}
          aria-label="四象限"
          aria-current={onQuadrant ? 'page' : undefined}
          onClick={() => onSelectView('quadrant')}
        >
          <GridIcon />
        </button>
        <button type="button" className="side-rail__item" aria-label="搜索" onClick={onOpenSearch}>
          <SearchIcon />
        </button>
      </div>

      <div className="side-rail__group side-rail__group--bottom">
        <IconButton label="备份与恢复" variant="quiet" onClick={onOpenTransfer}>
          <ArchiveIcon />
        </IconButton>
        <IconButton label="检查更新" variant="quiet" onClick={onOpenUpdate}>
          <RefreshIcon />
        </IconButton>
        <IconButton label="快捷键帮助" variant="quiet" className="side-rail__help" onClick={onOpenHelp}>
          <HelpIcon />
        </IconButton>
      </div>
    </nav>
  );
}
