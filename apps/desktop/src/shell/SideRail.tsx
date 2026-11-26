import type { ViewKind } from '@todolist/features';
import { useTranslation } from '@todolist/ui';
import { RailButton } from './RailButton';
import { ArchiveIcon, CalendarIcon, GearIcon, GridIcon, InboxIcon, RefreshIcon, SearchIcon } from './icons';

export interface SideRailProps {
  /** The view actually on screen — the highlight is derived from it, never stored. */
  view: ViewKind;
  onSelectView: (view: ViewKind) => void;
  /**
   * True when the quadrant view is showing the flat, date-grouped task list
   * rather than the 2×2 board. Together with `view` this decides which of the
   * two task icons is current.
   */
  taskListActive?: boolean;
  /** Switches the task surface to the flat date-grouped list. */
  onOpenTaskList?: () => void;
  /**
   * Switches the task surface to the 2×2 board. Distinct from
   * `onSelectView('quadrant')`: that keeps the sidebar's date filter, while
   * this clears it so the board is actually what appears.
   */
  onOpenQuadrants?: () => void;
  /** Opens the command-palette search overlay. */
  onOpenSearch?: () => void;
  /** Opens the backup/restore panel. */
  onOpenTransfer?: () => void;
  /** Opens the manual update check. */
  onOpenUpdate?: () => void;
  /** Opens the settings dialog (gear at the foot of the rail). */
  onOpenSettings?: () => void;
  /** True while the settings dialog is on screen. */
  settingsOpen?: boolean;
}

/** Calendar views whose name is worth appending to the rail's calendar label. */
// `as const` (not an annotated Record) keeps the values as key literals, so
// `t()` still type-checks the lookup instead of accepting any string.
const CALENDAR_VIEW_KEY = {
  month: 'views.month',
  week: 'views.week',
  day: 'views.day',
  agenda: 'views.agenda',
  'multi-day': 'views.multiDay',
  'multi-week': 'views.multiWeek',
  year: 'views.year',
} as const satisfies Partial<Record<ViewKind, string>>;

/**
 * The narrow icon rail. Purely navigation — it knows nothing about tasks.
 *
 * The highlight is derived from `view` plus `taskListActive`, never a second
 * `nav` state (the old `nav` could desync: `g w` changed the view while the
 * rail still lit the task icon). The task screen has two surfaces, and the
 * rail gives each its own icon and its own current state:
 *
 *   Tasks (inbox icon)    → flat, date-grouped list on the quadrant view
 *   Quadrants (grid icon) → the 2×2 board on the same view
 *   Calendar              → every calendar view
 *
 * Exactly one item is ever marked current.
 */
export function SideRail({
  view,
  onSelectView,
  taskListActive = false,
  onOpenTaskList,
  onOpenQuadrants,
  onOpenSearch,
  onOpenTransfer,
  onOpenUpdate,
  onOpenSettings,
  settingsOpen = false,
}: SideRailProps) {
  const { t } = useTranslation('shell');
  const onQuadrant = view === 'quadrant' && !taskListActive;
  const onTaskList = view === 'quadrant' && taskListActive;
  const onCalendar = view !== 'quadrant';
  const calendarViewKey: (typeof CALENDAR_VIEW_KEY)[keyof typeof CALENDAR_VIEW_KEY] | undefined =
    CALENDAR_VIEW_KEY[view as keyof typeof CALENDAR_VIEW_KEY];
  const calendarLabel = calendarViewKey
    ? t('nav.calendarWithView', { view: t(calendarViewKey) })
    : t('nav.calendar');

  return (
    <nav className="side-rail" aria-label={t('nav.main')}>
      <div className="side-rail__avatar" aria-hidden="true">
        <span>{t('nav.me')}</span>
      </div>

      <div className="side-rail__group">
        <RailButton
          label={t('nav.tasks')}
          active={onTaskList}
          onClick={() => {
            if (onOpenTaskList) onOpenTaskList();
            else onSelectView('quadrant');
          }}
        >
          <InboxIcon />
        </RailButton>
        <RailButton
          label={calendarLabel}
          active={onCalendar}
          onClick={() => onSelectView('month')}
        >
          <CalendarIcon />
        </RailButton>
        <RailButton
          label={t('nav.quadrant')}
          active={onQuadrant}
          onClick={() => {
            if (onOpenQuadrants) onOpenQuadrants();
            else onSelectView('quadrant');
          }}
        >
          <GridIcon />
        </RailButton>
        <RailButton label={t('nav.search')} shortcut="Ctrl+K" onClick={onOpenSearch}>
          <SearchIcon />
        </RailButton>
      </div>

      <div className="side-rail__group side-rail__group--bottom">
        <RailButton label={t('nav.backup')} onClick={onOpenTransfer}>
          <ArchiveIcon />
        </RailButton>
        <RailButton label={t('nav.checkUpdates')} onClick={onOpenUpdate}>
          <RefreshIcon />
        </RailButton>
        <RailButton
          label={t('settings.open')}
          className="side-rail__settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onOpenSettings}
        >
          <GearIcon />
        </RailButton>
      </div>
    </nav>
  );
}
