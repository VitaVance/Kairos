import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ReminderBanner,
  SearchPanel,
  ShortcutHelp,
  TaskDetailPanel,
  TaskListScreen,
  TimelineView,
  UndoProvider,
  ViewSwitcher,
  WeekView,
  YearView,
  useAppServices,
  useBumpRevision,
  useLists,
  useShortcuts,
  useTasks,
  useToast,
  useUndo,
  isEditableTarget,
} from '@todolist/features';
import type {
  BackupData,
  MergeMode,
  Notifier,
  SidebarFilter,
  UpdateChecker,
  ViewKind,
} from '@todolist/features';
import type { ImportService } from '@todolist/core';
import { SideRail } from './SideRail';
import { UpdatePanel } from './UpdatePanel';
import { TopBar } from './TopBar';
import { ErrorBoundary, useGlobalErrorHandler } from './ErrorBoundary';
import type { GlobalErrorEvent } from './ErrorBoundary';
import { ThemeToggle } from './ThemeToggle';
import { useReminders } from './useReminders';
import { createListsApi } from '../composition';

export interface ShellProps {
  today?: LocalDate;
  /** Restores a backup file; supplied by the composition root. */
  onImport?: ImportService;
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
    notify(`操作失败：${detail}`);
  };
}

function ShellBody({
  today,
  onImport,
  notifier,
  updateChecker,
  updateEndpoint,
}: {
  today: LocalDate;
  onImport?: ImportService;
  notifier?: Notifier;
  updateChecker?: UpdateChecker | null;
  updateEndpoint: string;
}) {
  const [view, setView] = useState<ViewKind>('quadrant');
  const [cursor, setCursor] = useState<LocalDate>(today);
  const [openTaskId, setOpenTaskId] = useState<TaskId | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'all' });
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
  // Density of the multi-week / multi-day views, mirrored here so the header
  // title can name the span actually on screen (it changes inside the view).
  const [weeksShown, setWeeksShown] = useState<2 | 3 | 4>(3);
  const [daysShown, setDaysShown] = useState<3 | 5 | 7>(3);

  const services = useAppServices();
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
  // filter stays on the quadrant. The window is computed with core's day
  // arithmetic so no raw `LocalDate` string is ever compared here: today is
  // offset 0 and recent is the inclusive span 0…6.
  const flatView = filter.kind === 'today' || filter.kind === 'recent';
  const flatTasks = useMemo(() => {
    if (filter.kind !== 'today' && filter.kind !== 'recent') return [];
    const lastOffset = filter.kind === 'today' ? 0 : 6;
    const lastDay = addDays(today, lastOffset);
    return (tasks ?? []).filter((task) => {
      if (task.dueDate === null) return false;
      return daysFromToday(task.dueDate, today) >= 0 && daysFromToday(task.dueDate, lastDay) <= 0;
    });
  }, [filter.kind, tasks, today]);

  const removeTask = useCallback(
    (id: TaskId) => {
      void services.tasks
        .remove(id)
        .then(bump)
        .catch((error: unknown) => {
          console.error('删除任务失败', error);
          toast('删除任务失败，请重试');
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
      if (filter.kind === 'today') return '今天';
      if (filter.kind === 'recent') return '最近7天';
      if (filter.kind === 'list') {
        return lists.find((l) => l.id === filter.listId)?.name ?? '清单';
      }
      return '四象限';
    }

    const thisYear = new Date().getFullYear();
    const yearSuffix = (y: string) => (y === String(thisYear) ? '' : ` ${y}`);
    const [y] = cursor.split('-');

    if (view === 'year') return y ?? cursor.slice(0, 4);

    // A multi-week span routinely straddles a month boundary (a 3-week window
    // starting Nov 23 ends in December), so naming it after the cursor's month
    // is simply wrong. Name the range by the weeks actually on screen.
    if (view === 'multi-week') {
      const first = startOfWeek(cursor);
      const last = addDays(first, weeksShown * 7 - 1);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      if (a === b) return `${Number(first.slice(5, 7))}月${yearSuffix(first.slice(0, 4))}`;
      return `${Number(a.slice(5, 7))}月 – ${Number(b.slice(5, 7))}月${yearSuffix(b.slice(0, 4))}`;
    }

    if (view === 'multi-day') {
      const first = cursor;
      const last = addDays(cursor, daysShown - 1);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      if (a !== b) {
        return `${Number(a.slice(5, 7))}月${Number(first.slice(8))}日 – ${Number(b.slice(5, 7))}月${Number(last.slice(8))}日`;
      }
      return `${Number(a.slice(5, 7))}月${Number(first.slice(8))}日 – ${Number(last.slice(8))}日`;
    }

    // Week and agenda are both Monday-first 7-day spans. Name the actual day
    // range: just "11月" is untrue for a 7-day window and leaves the user
    // unable to tell which week is on screen.
    if (view === 'week' || view === 'agenda') {
      const first = startOfWeek(cursor);
      const last = addDays(first, 6);
      const a = first.slice(0, 7);
      const b = last.slice(0, 7);
      const sameMonth = a === b;
      const d1 = Number(first.slice(8));
      const d2 = Number(last.slice(8));
      if (sameMonth) {
        return `${Number(first.slice(5, 7))}月${d1}日 – ${d2}日${yearSuffix(first.slice(0, 4))}`;
      }
      return `${Number(a.slice(5, 7))}月${d1}日 – ${Number(b.slice(5, 7))}月${d2}日${yearSuffix(b.slice(0, 4))}`;
    }

    // Day view shows exactly one date; name that date, not merely its month.
    if (view === 'day') {
      return `${Number(cursor.slice(5, 7))}月${Number(cursor.slice(8))}日${yearSuffix(cursor.slice(0, 4))}`;
    }

    return `${Number(cursor.slice(5, 7))}月${yearSuffix(y ?? cursor.slice(0, 4))}`;
  }, [view, cursor, filter, lists, weeksShown, daysShown]);

  const onSelectView = useCallback((next: ViewKind) => {
    setView(next);
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

  const openTask = useCallback((id: string) => setOpenTaskId(id as TaskId), []);

  /**
   * One routing rule for a calendar entry across every calendar view: a task
   * opens the detail panel, a standalone event opens the event editor.
   */
  const openEntry = useCallback((entry: CalendarEntry) => {
    if (entry.source === 'task') setOpenTaskId(entry.id as TaskId);
    else setEditingEntry(entry);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useShortcuts({
    'mod+z': () => void undo(),
    'mod+shift+z': () => void redo(),
    // `ShortcutHelp` only self-binds `?` when it owns its open state; this shell
    // drives it controlled, so the binding has to live here or the advertised
    // key would do nothing.
    '?': () => {
      if (isEditableTarget(document.activeElement)) return;
      setHelpOpen((open) => !open);
    },
    // No `mod+n`: this shell has no global task-capture surface (capture lives
    // in each quadrant's inline field), so advertising 新建任务 would lie. Bind
    // it once a shared capture overlay exists.
    'g q': () => onSelectView('quadrant'),
    'g m': () => onSelectView('month'),
    'g w': () => onSelectView('week'),
    'g d': () => onSelectView('day'),
    'g a': () => onSelectView('agenda'),
  });

  return (
    <div className="app-shell">
      <SideRail
        view={view}
        onSelectView={onSelectView}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenTransfer={() => setTransferOpen(true)}
        onOpenUpdate={() => setUpdateOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
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
          actions={<ThemeToggle />}
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
              onCreateAt={(d, t) => openCreateEvent(d, t)}
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
              onCreateAt={(t: string) => openCreateEvent(cursor, t)}
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
              onCreateAt={(d, t) => openCreateEvent(d, t)}
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
          cta={{ label: '新建日程', onClick: () => openCreateEvent(cursor) }}
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

      <UpdatePanel
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        checker={updateChecker ?? null}
        endpoint={updateEndpoint}
      />

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

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
      />
    </div>
  );
}
