import { beforeAll, describe, expect, it } from 'vitest';
import type { Instant, LocalDate, Task, TaskId } from '@todolist/core';
import { initI18n } from '@todolist/ui';
import { dueGroupOf, groupTasksByDue } from '../src/task/TaskListScreen';

const EN = 'en';

beforeAll(() => {
  initI18n(EN);
});

const NOW = '2026-09-09T08:00:00.000Z' as Instant;

function task(id: string, dueDate: LocalDate | null, overrides: Partial<Task> = {}): Task {
  return {
    id: id as TaskId,
    listId: 'inbox' as Task['listId'],
    title: `任务 ${id}`,
    notes: '',
    status: 'open',
    important: false,
    urgent: false,
    dueAt: null,
    dueDate,
    allDay: false,
    duePeriod: null,
    recurrence: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// 2026-09-09 is a Wednesday, so the current Monday-first week runs 09-07 → 09-13.
const WEDNESDAY = '2026-09-09' as LocalDate;

describe('dueGroupOf', () => {
  it('buckets each date relative to today', () => {
    expect(dueGroupOf({ dueDate: '2026-09-08' as LocalDate }, WEDNESDAY, 4)).toBe('overdue');
    expect(dueGroupOf({ dueDate: '2026-08-01' as LocalDate }, WEDNESDAY, 4)).toBe('overdue');
    expect(dueGroupOf({ dueDate: WEDNESDAY }, WEDNESDAY, 4)).toBe('today');
    expect(dueGroupOf({ dueDate: '2026-09-10' as LocalDate }, WEDNESDAY, 4)).toBe('tomorrow');
    expect(dueGroupOf({ dueDate: '2026-09-11' as LocalDate }, WEDNESDAY, 4)).toBe('this-week');
    expect(dueGroupOf({ dueDate: '2026-09-13' as LocalDate }, WEDNESDAY, 4)).toBe('this-week');
    expect(dueGroupOf({ dueDate: '2026-09-14' as LocalDate }, WEDNESDAY, 4)).toBe('later');
    expect(dueGroupOf({ dueDate: null }, WEDNESDAY, 4)).toBe('undated');
  });

  it('treats today as the week end when today is Sunday', () => {
    // 2026-09-06 is a Sunday; the current week has no days left, so the
    // day after tomorrow falls outside 本周内.
    const sunday = '2026-09-06' as LocalDate;
    expect(dueGroupOf({ dueDate: '2026-09-07' as LocalDate }, sunday, 0)).toBe('tomorrow');
    expect(dueGroupOf({ dueDate: '2026-09-08' as LocalDate }, sunday, 0)).toBe('later');
  });
});

describe('groupTasksByDue', () => {
  it('emits groups in product order and omits empty ones', () => {
    const tasks = [
      task('later', '2026-09-20' as LocalDate),
      task('today', WEDNESDAY),
      task('undated', null),
      task('overdue', '2026-09-01' as LocalDate),
      task('tomorrow', '2026-09-10' as LocalDate),
      task('week', '2026-09-12' as LocalDate),
    ];
    const groups = groupTasksByDue(tasks, WEDNESDAY);
    expect(groups.map((g) => g.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'this-week',
      'later',
      'undated',
    ]);
    // `groupTasksByDue` is pure: with no formatter it emits the catalog keys.
    // The screen passes a `t`-backed formatter (covered by the UI).
    expect(groups.map((g) => g.label)).toEqual([
      'list.groups.overdue',
      'list.groups.today',
      'list.groups.tomorrow',
      'list.groups.thisWeek',
      'list.groups.later',
      'list.groups.undated',
    ]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([
      ['overdue'],
      ['today'],
      ['tomorrow'],
      ['week'],
      ['later'],
      ['undated'],
    ]);
  });

  it('drops a group with no tasks instead of rendering an empty header', () => {
    const groups = groupTasksByDue([task('a', WEDNESDAY)], WEDNESDAY);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('today');
  });

  it('returns no groups for no tasks', () => {
    expect(groupTasksByDue([], WEDNESDAY)).toEqual([]);
  });

  it('orders within a group with compareTasks: open before done, then due, then created', () => {
    const tasks = [
      task('done', WEDNESDAY, { status: 'done', dueAt: '2026-09-09T01:00:00Z' as Instant }),
      task('late-open', WEDNESDAY, { dueAt: '2026-09-09T18:00:00Z' as Instant }),
      task('early-open', WEDNESDAY, { dueAt: '2026-09-09T09:00:00Z' as Instant }),
      task('undated-in-group', WEDNESDAY),
    ];
    const [group] = groupTasksByDue(tasks, WEDNESDAY);
    expect(group?.tasks.map((t) => t.id)).toEqual([
      'early-open',
      'late-open',
      'undated-in-group',
      'done',
    ]);
  });

  it('does not mutate the caller’s array', () => {
    const tasks = [task('b', '2026-09-20' as LocalDate), task('a', WEDNESDAY)];
    const before = tasks.map((t) => t.id);
    groupTasksByDue(tasks, WEDNESDAY);
    expect(tasks.map((t) => t.id)).toEqual(before);
  });
});
