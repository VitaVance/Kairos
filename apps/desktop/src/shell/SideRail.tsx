import type { ViewKind } from '@todolist/features';
import { IconButton, useTranslation } from '@todolist/ui';
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
 * The highlight is derived from the `view` that is actually on screen, never a
 * second `nav` state (the old `nav` could desync: `g w` changed the view while
 * the rail still lit the task icon). The quadrants are the app's only task
 * screen, so that icon represents it; the calendar icon covers every calendar
 * view. The task icon is the home entry into the same task screen and, as in
 * the design reference, is not itself a lit destination — exactly one item is
 * ever marked current.
 */
export function SideRail({
  view,
  onSelectView,
  onOpenSearch,
  onOpenTransfer,
  onOpenUpdate,
  onOpenHelp,
}: SideRailProps) {
  const { t } = useTranslation('shell');
  const onQuadrant = view === 'quadrant';
  const onCalendar = !onQuadrant;
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
        <button
          type="button"
          className="side-rail__item"
          aria-label={t('nav.tasks')}
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
          aria-label={t('nav.quadrant')}
          aria-current={onQuadrant ? 'page' : undefined}
          onClick={() => onSelectView('quadrant')}
        >
          <GridIcon />
        </button>
        <button type="button" className="side-rail__item" aria-label={t('nav.search')} onClick={onOpenSearch}>
          <SearchIcon />
        </button>
      </div>

      <div className="side-rail__group side-rail__group--bottom">
        <IconButton label={t('nav.backup')} variant="quiet" onClick={onOpenTransfer}>
          <ArchiveIcon />
        </IconButton>
        <IconButton label={t('nav.checkUpdates')} variant="quiet" onClick={onOpenUpdate}>
          <RefreshIcon />
        </IconButton>
        <IconButton label={t('nav.shortcuts')} variant="quiet" className="side-rail__help" onClick={onOpenHelp}>
          <HelpIcon />
        </IconButton>
      </div>
    </nav>
  );
}
