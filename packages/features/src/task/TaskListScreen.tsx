import { useId, useMemo } from 'react';
import type { LocalDate, Task, TaskId, TaskList } from '@todolist/core';
import { addDays, compareTasks, daysFromToday, startOfWeek } from '@todolist/core';
import { EmptyState, useTranslation } from '@todolist/ui';
import { QuickAdd } from './QuickAdd';
import { TaskListRow } from './TaskListRow';
import './task-list.css';

/*
 * The flat, date-grouped list behind the sidebar's 今天 / 最近7天 shortcuts.
 *
 * This screen owns grouping and layout only. It receives an already-filtered
 * task set, renders the shared `TaskListRow` unchanged for every row, and
 * leaves creation to `QuickAdd` (which writes through the services in context
 * and bumps the shared revision itself).
 */

export type DueGroupKey = 'overdue' | 'today' | 'tomorrow' | 'this-week' | 'later' | 'undated';

export interface DueGroup {
  readonly key: DueGroupKey;
  readonly label: string;
  readonly tasks: readonly Task[];
}

/** Product order. Empty groups are dropped, never rendered as a blank header. */
const GROUP_ORDER: readonly DueGroupKey[] = ['overdue', 'today', 'tomorrow', 'this-week', 'later', 'undated'];

/** Message key per group; labels are resolved in the component (needs `t`). */
export const GROUP_LABEL_KEY = {
  overdue: 'list.groups.overdue',
  today: 'list.groups.today',
  tomorrow: 'list.groups.tomorrow',
  'this-week': 'list.groups.thisWeek',
  later: 'list.groups.later',
  undated: 'list.groups.undated',
} as const satisfies Record<DueGroupKey, string>;

/**
 * Which group a task's local due date belongs to.
 *
 * `lastDayOfWeek` is the distance in days from `today` to the current week's
 * Sunday (the app's Monday-first week — see `startOfWeek`). When today itself
 * is Sunday it is 0, so 本周内 is empty and anything past tomorrow is 之后.
 * All arithmetic comes from core's `daysFromToday`; nothing here re-derives
 * a date difference.
 */
export function dueGroupOf(
  task: Pick<Task, 'dueDate'>,
  today: LocalDate,
  lastDayOfWeek: number,
): DueGroupKey {
  if (task.dueDate === null) return 'undated';
  const diff = daysFromToday(task.dueDate, today);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= lastDayOfWeek) return 'this-week';
  return 'later';
}

/**
 * Pure grouping used by `TaskListScreen`.
 *
 * Tasks are bucketed by due date, each bucket is ordered with core's
 * `compareTasks` (open before done, then by due instant, then creation), and
 * empty buckets are omitted. The input array is never mutated.
 */
export function groupTasksByDue(
  tasks: readonly Task[],
  today: LocalDate,
  labelFor: (key: DueGroupKey) => string = (key) => GROUP_LABEL_KEY[key],
): readonly DueGroup[] {
  const lastDayOfWeek = daysFromToday(addDays(startOfWeek(today), 6), today);

  const buckets: Record<DueGroupKey, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    'this-week': [],
    later: [],
    undated: [],
  };
  for (const task of tasks) {
    buckets[dueGroupOf(task, today, lastDayOfWeek)].push(task);
  }

  const groups: DueGroup[] = [];
  for (const key of GROUP_ORDER) {
    const bucket = buckets[key];
    if (bucket.length === 0) continue;
    bucket.sort(compareTasks);
    groups.push({ key, label: labelFor(key), tasks: bucket });
  }
  return groups;
}

export interface TaskListScreenProps {
  tasks: readonly Task[];
  lists: readonly TaskList[];
  today: LocalDate;
  onOpenTask: (id: TaskId) => void;
  onToggle: (id: TaskId, source: 'checkbox' | 'row') => void;
  onDelete: (id: TaskId) => void;
  fresh: ReadonlySet<TaskId>;
  /** Optional: shows the QuickAdd box at the top when provided. */
  onCreate?: (title: string) => Promise<void>;
}

/**
 * Flat task list grouped by due date.
 *
 * `lists` is part of the screen's contract but no row needs it: `TaskListRow`
 * is deliberately presentational and resolve its display from the task alone.
 * Keeping the prop means the shell can pass the same list snapshot it already
 * holds without this screen silently changing shape later.
 */
export function TaskListScreen({
  tasks,
  today,
  onOpenTask,
  onToggle,
  onDelete,
  fresh,
  onCreate,
}: TaskListScreenProps) {
  const { t } = useTranslation('task');
  const groups = useMemo(
    () => groupTasksByDue(tasks, today, (key) => t(GROUP_LABEL_KEY[key])),
    [tasks, today, t],
  );
  const baseId = useId();

  return (
    <div className="flat-screen">
      {/*
       * QuickAdd is self-contained: it creates through the services in context
       * and refreshes via the shared revision, so this screen has nothing to
       * wire for a created task. `onCreate` is the capability gate that opts
       * this screen into capture.
       */}
      {onCreate ? <QuickAdd today={today} /> : null}

      {groups.length === 0 ? (
        <div className="flat-empty">
          <EmptyState message={t('list.empty')} />
        </div>
      ) : (
        groups.map((group) => {
          const headingId = `${baseId}-${group.key}`;
          return (
            <section
              key={group.key}
              className={`flat-group flat-group--${group.key}`}
              aria-labelledby={headingId}
            >
              <h2 className="flat-group__head" id={headingId}>
                {group.key === 'overdue' || group.key === 'today' ? (
                  <span className={`flat-group__dot flat-group__dot--${group.key}`} aria-hidden="true" />
                ) : null}
                <span className="flat-group__label">{group.label}</span>
                <span className="flat-group__count">{group.tasks.length}</span>
              </h2>
              <ul className="flat-group__list">
                {group.tasks.map((task) => (
                  <li key={task.id} className="flat-group__item">
                    <TaskListRow
                      task={task}
                      today={today}
                      onOpen={onOpenTask}
                      onToggle={onToggle}
                      onDelete={onDelete}
                      fresh={fresh.has(task.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
