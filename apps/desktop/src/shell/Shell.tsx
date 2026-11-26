import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEntry, LocalDate, TaskId } from '@todolist/core';
import { addDays, daysFromToday, startOfWeek, todayLocal } from '@todolist/core';
import {
  DataTransferPanel,
  DayView,
  EventEditor,
  ListSidebar,
  MonthView,
  MultiDayView,
  MultiWeekView,
  QuadrantScreen,
  QuickEventComposer,
  ReminderBanner,
  SearchPanel,
  SettingsDialog,
  ShortcutHelp,
  TaskDetailPanel,
  TaskListScreen,
  TimelineView,
  UndoProvider,
  ViewSwitcher,
  WeekView,
  YearView,
  formatMonthDay,
  formatMonthName,
  formatMonthYear,
  useAppServices,
  useBumpRevision,
  useLists,
  useShortcuts,
  useTasks,
  useToast,
  useUndo,
  isEditableTarget,
  listLabel,
} from '@todolist/features';
import type {
  BackupData,
  MergeMode,
  Notifier,
  SidebarFilter,
  SlotAnchor,
  UpdateChecker,
  ViewKind,
} from '@todolist/features';
import type { ImportService } from '@todolist/core';
import { i18n, useTranslation } from '@todolist/ui';
import { SideRail } from './SideRail';
import { UpdatePanel } from './UpdatePanel';
import { TopBar } from './TopBar';
import { ErrorBoundary, useGlobalErrorHandler } from './ErrorBoundary';
import type { GlobalErrorEvent } from './ErrorBoundary';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { useAppearance, watchSystemTheme } from './theme';
import { useReminders } from './useReminders';
import { createListsApi } from '../composition';

/**
 * The running app's version, injected at build time by vite.config.ts from
 * `tauri.conf.json`. This is the same token the update checker compares
 * against, so the 关于 pane and the updater can never disagree about what is
 * installed.
 */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION;

export interface ShellProps {
  today?: LocalDate;
  /** Restores a backup file; supplied by the composition root. */
  onImport?: ImportService;
  /** Deletes every task, list and event; supplied by the composition root. */
  onResetData?: (() => Promise<void>) | null;
  /** Native OS toast channel; omitted means banner-only (tests, browsers). */
  notifier?: Notifier;
  /** Update check; omitted in browser dev. */
  updateChecker?: UpdateChecker | null;
  /** Release feed this build checks against; empty means "not configured". */
  updateEndpoint?: string;
}

/**
 * App shell — the wiring layer.
 *
 * Every panel is a self-contained feature component; this file decides which
 * one is visible, what the cursor date is, and routes cross-cutting intents
 * (open detail, create event, open search) between them. It owns no business
 * rules: those live in the services behind each screen.
 */
export function Shell({
  today = todayLocal(),
  onImport,
  onResetData,
  notifier,
  updateChecker,
  updateEndpoint = '',
}: ShellProps) {
  return (
    <ErrorBoundary>
      <UndoProvider>
        <ShellBody
          today={today}
          onImport={onImport}
          onResetData={onResetData}
          notifier={notifier}
          updateChecker={updateChecker}
          updateEndpoint={updateEndpoint}
        />
      </UndoProvider>
    </ErrorBoundary>
  );
}

/**
 * Async failures do not reach `ErrorBoundary` — a rejected promise or a throw
 * inside a timer bypasses React's render path entirely and would otherwise be
 * silent. This logs them and shows the toast channel so the user is not left
 * with an action that appeared to work.
 */
function asyncErrorHandler(notify: (message: string) => void) {
  return (event: GlobalErrorEvent): void => {
    const detail = event.error instanceof Error ? event.error.message : String(event.error ?? '未知错误');
    console.error(`[shell] 未捕获的异步错误 (${event.source})`, event.error);
    // `i18n.getFixedT` rather than the hook: this handler is created outside
    // React's render tree and must read the language current at failure time.
    notify(i18n.getFixedT(null, 'errors')('async.failed', { detail }));
  };
}

function ShellBody({
  today,
  onImport,
  onResetData,
  notifier,
  updateChecker,
  updateEndpoint,
}: {
  today: LocalDate;
  onImport?: ImportService;
  onResetData?: (() => Promise<void>) | null;
  notifier?: Notifier;
  updateChecker?: UpdateChecker | null;
  updateEndpoint: string;
}) {
  const [view, setView] = useState<ViewKind>('quadrant');
  const [cursor, setCursor] = useState<LocalDate>(today);
  const [openTaskId, setOpenTaskId] = useState<TaskId | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'all' });
  // The rail's Tasks icon selects the flat, date-grouped list independently of
  // the sidebar's quick filters: with no filter the list shows every task,
  // grouped by due date (overdue / today / … / undated).
  const [taskListMode, setTaskListMode] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [editor, setEditor] = useState<{
    open: boolean;
    date: LocalDate;
    time?: string;
    /** End "HH:MM" when the editor was opened from a drag selection. */
    endTime?: string;
  }>({
    open: false,
    date: today,
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Quick composer raised by a slot click on the time grids. The full editor
  // dialog stays behind the top bar's 新建日程 button and an entry click.
  const [quick, setQuick] = useState<{
    open: boolean;
    date: LocalDate;
    time?: string;
    anchor: SlotAnchor | null;
  }>({ open: false, date: today, anchor: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Escape returns focus to whatever was focused when the help sheet opened.
  const helpInvokerRef = useRef<HTMLElement | null>(null);
  const openHelp = useCallback(() => {
    helpInvokerRef.current = document.activeElement as HTMLElement | null;
    setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpInvokerRef.current?.focus?.();
    helpInvokerRef.current = null;
  }, []);
  // Same focus-return contract for 设置: it is reachable from the top bar and
  // from `mod+,`, and the opener must get focus back on close.
  const settingsInvokerRef = useRef<HTMLElement | null>(null);
  const openSettings = useCallback(() => {
    settingsInvokerRef.current = document.activeElement as HTMLElement | null;
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    settingsInvokerRef.current?.focus?.();
    settingsInvokerRef.current = null;
  }, []);
  // Density of the multi-week / multi-day views, mirrored here so the header
  // title can name the span actually on screen (it changes inside the view).
  const [weeksShown, setWeeksShown] = useState<2 | 3 | 4>(3);
  const [daysShown, setDaysShown] = useState<3 | 5 | 7>(3);

  const services = useAppServices();
  const { t } = useTranslation('shell');
  const appearance = useAppearance();
  // Hydrating the appearance store on first read applies both axes; keep the
  // OS light/dark subscription alive while the shell is mounted.
  useEffect(() => watchSystemTheme(), []);
  const lists = useLists();
  const bump = useBumpRevision();
  const { undo, redo } = useUndo();
  const toast = useToast();
  useGlobalErrorHandler(asyncErrorHandler(toast));
  const { data: tasks, toggleDone, fresh } = useTasks();
  const listsApi = useMemo(() => createListsApi(services), [services]);
  const reminders = useReminders(notifier);

  const activeListId = filter.kind === 'list' ? filter.listId : null;

  // The sidebar's 今天 / 最近7天 shortcuts render a flat list; every other
  // filter stays on the quadrant. The rail's Tasks icon is the other way into
  // that flat screen, with the whole task set and no date window. The window is
  // computed with core's day arithmetic so no raw `LocalDate` string is ever
  // compared here: today is offset 0 and recent is the inclusive span 0…6.
  const flatView = taskListMode || filter.kind === 'today' || filter.kind === 'recent';
  const flatTasks = useMemo(() => {
    if (taskListMode) return tasks ?? [];
    if (filter.kind !== 'today' && filter.kind !== 'recent') return [];
    const lastOffset = filter.kind === 'today' ? 0 : 6;
    const lastDay = addDays(today, lastOffset);
    return (tasks ?? []).filter((task) => {
      if (task.dueDate === null) return false;
      return daysFromToday(task.dueDate, today) >= 0 && daysFromToday(task.dueDate, lastDay) <= 0;
    });
  }, [taskListMode, filter.kind, tasks, today]);

  const removeTask = useCallback(
    (id: TaskId) => {
      void services.tasks
        .remove(id)
        .then(bump)
        .catch((error: unknown) => {
          console.error('删除任务失败', error);
          toast(i18n.getFixedT(null, 'errors')('task.deleteFailed'));
        });
    },
    [bump, services, toast],
  );

  const selectedTask = useMemo(
    () => (openTaskId ? ((tasks ?? []).find((t) => t.id === openTaskId) ?? null) : null),
    [openTaskId, tasks],
  );

  const title = useMemo(() => {
    if (view === 'quadrant') {
      if (filter.kind === 'today') return t('filter.today');
      if (filter.kind === 'recent') return t('filter.recent');
      if (filter.kind === 'list') {
        const list = lists.find((l) => l.id === filter.listId);
        if (!list) return t('filter.list');
        // `listLabel` resolves the system inbox from the `lists` catalog; the
        // `t` in this component is bound to `shell`, so calling it with
        // `quadrant.inbox` would not type-check — and would be the wrong
        // namespace even if it did.
        return listLabel(list);
      }
      // The flat list opened from the rail's Tasks icon, not the 2×2 board.
      if (taskListMode) return t('nav.tasks');
      return t('filter.quadrant');
    }

    const thisYear = new Date().getFullYear();
    const yearSuffix = (y: string) => (y === String(thisYear) ? '' : ` ${y}`);
    const [y] = cursor.split('-');
    /**
     * Titles are built through `Intl` rather than by slicing the ISO string.
     * `11月25日 – 11月27日` was assembled from `cursor.slice(5, 7)` etc., which
     * only ever reads correctly in Chinese; in English the same expression
     * produced a string no `Intl` formatter would have produced, and the year
     * suffix logic assumed a space-delimited date.
     */
    const monthName = (date: string) => formatMonthName(Number(date.slice(5, 7)));
    const monthYear = (date: string) => formatMonthYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
    const monthDay = (date: string) => formatMonthDay(date);

    if (view === 'year') return y ?? cursor.slice(0, 4);

    // A multi-week span routinely straddles a month boundary (a 3-week window
    // starting Nov 23 ends in December), so naming it after the cursor's month
    // is simply wrong. Name the range by the weeks actually on screen.
    if (view === 'multi-week') {
      const first = startOfWeek(cursor);
      const last = addDays(first, weeksShown * 7 - 1);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      if (a === b) return `${monthYear(first)}${yearSuffix(first.slice(0, 4))}`;
      return `${monthName(first)} – ${monthYear(last)}${yearSuffix(last.slice(0, 4))}`;
    }

    if (view === 'multi-day') {
      const first = cursor;
      const last = addDays(cursor, daysShown - 1);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      if (a !== b) return `${monthDay(first)} – ${monthDay(last)}`;
      return `${monthName(first)} ${Number(first.slice(8))} – ${Number(last.slice(8))}`;
    }

    // Week and agenda are both Monday-first 7-day spans. Name the actual day
    // range: just "11月" is untrue for a 7-day window and leaves the user
    // unable to tell which week is on screen.
    if (view === 'week' || view === 'agenda') {
      const first = startOfWeek(cursor);
      const last = addDays(first, 6);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      if (a === b) return `${monthName(first)} ${Number(first.slice(8))} – ${Number(last.slice(8))}${yearSuffix(first.slice(0, 4))}`;
      return `${monthDay(first)} – ${monthDay(last)}${yearSuffix(last.slice(0, 4))}`;
    }

    // Day view shows exactly one date; name that date, not merely its month.
    if (view === 'day') {
      return `${monthDay(cursor)}${yearSuffix(cursor.slice(0, 4))}`;
    }

    return `${monthYear(cursor)}${yearSuffix(y ?? cursor.slice(0, 4))}`;
  }, [view, cursor, filter, taskListMode, lists, weeksShown, daysShown, t]);

  /**
   * Rail navigation. Selecting a calendar/quadrant view leaves the rail's flat
   * list; the sidebar's list filters also leave it so the two task surfaces
   * cannot disagree about what is on screen.
   */
  const onSelectView = useCallback((next: ViewKind) => {
    setTaskListMode(false);
    setView(next);
  }, []);

  const openTaskList = useCallback(() => {
    setFilter({ kind: 'all' });
    setTaskListMode(true);
    setView('quadrant');
  }, []);

  /**
   * The 2×2 board. Clearing the date filter matters: `filter.kind === 'today'`
   * would otherwise keep `TaskListScreen` on screen under the quadrants icon.
   */
  const openQuadrants = useCallback(() => {
    setFilter({ kind: 'all' });
    setTaskListMode(false);
    setView('quadrant');
  }, []);

  const openCreateEvent = useCallback(
    (date: LocalDate, time?: string) => setEditor({ open: true, date, time }),
    [],
  );

  /** Drag selection: opens the editor seeded with a start and end. */
  const openCreateRange = useCallback(
    (date: LocalDate, start: string, end: string) =>
      setEditor({ open: true, date, time: start, endTime: end }),
    [],
  );

  /**
   * An empty-slot click on the day / week / multi-day grids opens the quick
   * composer instead of the full dialog. The dialog remains the editor for an
   * existing entry and the top bar's 新建日程 action.
   */
  const openQuickEvent = useCallback(
    (date: LocalDate, time: string, anchor: SlotAnchor) =>
      setQuick({ open: true, date, time, anchor }),
    [],
  );
  /**
   * The Ctrl+N entry: same capture bar, no click point to anchor to.
   *
   * The bar centres itself when `anchor` is null (`QuickEventComposer` branches
   * on it), and the default time is the next whole hour rather than a fixed
   * 09:00 — that default is what makes the bar usable without touching a
   * single field.
   */
  const openCaptureBar = useCallback(() => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const hh = String(nextHour.getHours()).padStart(2, '0');
    // Past 23:00 the next whole hour is tomorrow 00:00; the date must follow
    // the clock or the event lands an hour in the past.
    const target =
      nextHour.getDate() !== now.getDate()
        ? (addDays(cursor, 1) as LocalDate)
        : cursor;
    setQuick({ open: true, date: target, time: `${hh}:00`, anchor: null });
  }, [cursor]);
  const closeQuickEvent = useCallback(() => {
    setQuick((q) => ({ ...q, open: false }));
    // The composer writes straight through the events service, so refresh the
    // views once it closes (a cancelled composer is a no-op refetch).
    bump();
  }, [bump]);

  const openTask = useCallback((id: string) => setOpenTaskId(id as TaskId), []);

  /**
   * One routing rule for a calendar entry across every calendar view: a task
   * opens the detail panel, a standalone event opens the event editor.
   */
  const openEntry = useCallback((entry: CalendarEntry) => {
    if (entry.source === 'task') setOpenTaskId(entry.id as TaskId);
    else setEditingEntry(entry);
  }, []);

  /**
   * Every shell shortcut in one map, so the shared hook (editable-field guard,
   * Escape, sequence handling) is the only keyboard path. When search reopens
   * from inside the palette, focus the input it already has instead of
   * restarting its state.
   */
  const shortcuts = useMemo<Record<string, () => void>>(() => {
    const openSearch = () => {
      if (!searchOpen) {
        setSearchOpen(true);
        return;
      }
      const input = document.querySelector<HTMLInputElement>('.search-panel .tl-field__input');
      if (input) {
        input.focus();
        input.select();
      } else {
        setSearchOpen(true);
      }
    };
    return {
      // `mod+f` also has to preventDefault inside the shared hook — otherwise
      // the WebView's own find-in-page bar would open over the app.
      'mod+f': openSearch,
      'mod+k': openSearch,
      'mod+z': () => void undo(),
      'mod+shift+z': () => void redo(),
      // `ShortcutHelp` only self-binds `?` when it owns its open state; this
      // shell drives it controlled, so the binding has to live here or the
      // advertised key would do nothing.
      '?': () => {
        if (isEditableTarget(document.activeElement)) return;
        if (helpOpen) closeHelp();
        else openHelp();
      },
      // `mod+,` opens 设置. While a text field has focus the shared hook yields
      // to it (the chord is not in its typing allowlist), so editing is never
      // interrupted — open it from anywhere else.
      'mod+,': () => {
        if (settingsOpen) closeSettings();
        else openSettings();
      },
      // `mod+n` opens the event capture bar. This binding was deliberately
      // withheld until a shared capture surface existed ("Bind it once a shared
      // capture overlay exists") — the bar in QuickEventComposer is that
      // surface, so the note is now honoured rather than contradicted.
      // Unlike Notion/Things, `mod+n` here means "new event", not "new task":
      // tasks are captured inline in their quadrant, events have no inline
      // equivalent on the calendar grid.
      'mod+n': openCaptureBar,
      // No `mod+s`: the app autosaves through the service layer, so there is
      // nothing to save — a binding here would be a no-op dressed as an action.
      'g q': () => onSelectView('quadrant'),
      'g m': () => onSelectView('month'),
      'g w': () => onSelectView('week'),
      'g d': () => onSelectView('day'),
      'g a': () => onSelectView('agenda'),
    };
  }, [closeHelp, closeSettings, cursor, helpOpen, onSelectView, openCaptureBar, openHelp, openSettings, redo, searchOpen, settingsOpen, undo]);

  useShortcuts(shortcuts);

  return (
    <div className="app-shell">
      <SideRail
        view={view}
        onSelectView={onSelectView}
        taskListActive={view === 'quadrant' && flatView}
        onOpenTaskList={openTaskList}
        onOpenQuadrants={openQuadrants}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenTransfer={() => setTransferOpen(true)}
        onOpenUpdate={() => setUpdateOpen(true)}
        onOpenSettings={openSettings}
        settingsOpen={settingsOpen}
      />

      <ListSidebar
        lists={lists}
        tasks={tasks ?? []}
        selectedListId={activeListId}
        today={today}
        onSelect={(next) => {
          setFilter(next);
          onSelectView('quadrant');
        }}
        api={listsApi}
        onChanged={bump}
        /**
         * The sidebar owns drop handling; giving it the service lets it make a
         * same-list drop a true no-op and register an undo command. The shell
         * used to call `moveToList(...).then(bump)` directly, which silently
         * rewrote the task even when it stayed in the same list and left
         * failures as unhandled rejections.
         */
        moveTask={(taskId, listId) => services.tasks.moveToList(taskId, listId)}
      />

      <div className="app-main">
        <TopBar
          title={title}
          view={view}
          cursor={cursor}
          onCursorChange={setCursor}
          today={today}
          onCreateEvent={() => openCreateEvent(cursor)}
          weeksShown={weeksShown}
          daysShown={daysShown}
          actions={
            <div className="top-bar__prefs">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          }
        />

        {/*
         * Calendar views are full-height with their own scrollbar; letting the
         * content area scroll too nested two scrollers (see app.css).
         */}
        <main className="app-content" data-fill={view !== 'quadrant' ? 'true' : undefined}>
          {reminders.items.length > 0 ? (
            <ReminderBanner
              items={reminders.items}
              onComplete={(item) => {
                if (item.kind === 'task') {
                  toggleDone(item.id as TaskId, item.title);
                }
                // Drop only the reminder that was completed/snoozed: clearing
                // the whole banner hid unrelated reminders that were still due.
                reminders.dismissOne(item);
              }}
              onSnooze={(item) => reminders.dismissOne(item)}
              onDismiss={reminders.dismiss}
            />
          ) : null}

          {view === 'quadrant' && flatView && (
            <TaskListScreen
              tasks={flatTasks}
              lists={lists}
              today={today}
              onOpenTask={setOpenTaskId}
              onToggle={(id) => {
                const task = (tasks ?? []).find((t) => t.id === id);
                toggleDone(id, task?.title ?? '');
              }}
              onDelete={removeTask}
              fresh={fresh}
            />
          )}
          {view === 'quadrant' && !flatView && (
            <QuadrantScreen
              lists={lists}
              today={today}
              onOpenTask={(id) => setOpenTaskId(id)}
              listId={activeListId}
            />
          )}
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              today={today}
              onDayClick={setCursor}
              onOpenDay={(date) => {
                setCursor(date);
                onSelectView('day');
              }}
              onCreateAt={(d) => openCreateEvent(d)}
              onOpenEntry={openEntry}
            />
          )}
          {view === 'week' && (
            <WeekView
              cursor={cursor}
              today={today}
              onCreateSlot={openQuickEvent}
              onCreateRange={(d, s, e) => openCreateRange(d, s, e)}
              onOpenEntry={openEntry}
              onOpenDay={(date) => {
                setCursor(date);
                onSelectView('day');
              }}
            />
          )}
          {view === 'day' && (
            <DayView
              cursor={cursor}
              today={today}
              onCreateSlot={(t, anchor) => openQuickEvent(cursor, t, anchor)}
              onCreateRange={(s, e) => openCreateRange(cursor, s, e)}
              onOpenEntry={openEntry}
            />
          )}
          {view === 'agenda' && <TimelineView cursor={cursor} today={today} />}
          {view === 'multi-day' && (
            <MultiDayView
              cursor={cursor}
              today={today}
              span={daysShown}
              onSpanChange={setDaysShown}
              onCreateSlot={openQuickEvent}
              onCreateRange={(d, s, e) => openCreateRange(d, s, e)}
              onOpenEntry={openEntry}
              onOpenDay={(date) => {
                setCursor(date);
                onSelectView('day');
              }}
            />
          )}
          {view === 'multi-week' && (
            <MultiWeekView
              cursor={cursor}
              today={today}
              weeks={weeksShown}
              onWeeksChange={setWeeksShown}
              onOpenEntry={openEntry}
              onOpenWeek={(date) => {
                setCursor(date);
                onSelectView('week');
              }}
              onOpenDay={(date) => {
                setCursor(date);
                onSelectView('day');
              }}
            />
          )}
          {view === 'year' && (
            <YearView
              cursor={cursor}
              today={today}
              onOpenDay={(date) => {
                setCursor(date);
                onSelectView('month');
              }}
            />
          )}
        </main>

        <ViewSwitcher
          value={view}
          onChange={onSelectView}
          variant="pill"
          cta={{ label: t('topBar.newEvent'), onClick: () => openCreateEvent(cursor) }}
        />
      </div>

      {selectedTask ? (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          lists={lists}
          onClose={() => setOpenTaskId(null)}
        />
      ) : null}

      <EventEditor
        open={editor.open || editingEntry !== null}
        defaultDate={editor.date}
        defaultStart={editor.time}
        defaultEnd={editor.endTime}
        entry={editingEntry}
        onClose={() => {
          setEditor((e) => ({ ...e, open: false }));
          setEditingEntry(null);
          bump();
        }}
      />

      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} onOpenTask={openTask} />

      <QuickEventComposer
        open={quick.open}
        date={quick.date}
        time={quick.time}
        anchor={quick.anchor}
        today={today}
        lists={lists}
        onClose={closeQuickEvent}
        onCreated={bump}
      />

      <UpdatePanel
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        checker={updateChecker ?? null}
        endpoint={updateEndpoint}
      />

      <ShortcutHelp open={helpOpen} onClose={closeHelp} />

      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        mode={appearance.mode}
        palette={appearance.palette}
        onModeChange={appearance.setMode}
        onPaletteChange={appearance.setPalette}
        version={APP_VERSION}
      />

      <DataTransferPanel
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onApply={
          onImport
            ? async (data: BackupData, mode: MergeMode) => {
                await onImport.apply({ tasks: data.tasks, lists: data.lists, events: data.events }, mode);
                bump();
              }
            : null
        }
        onReset={
          onResetData
            ? async () => {
                await onResetData();
                bump();
              }
            : null
        }
      />
    </div>
  );
}
