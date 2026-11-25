import { describe, expect, it } from 'vitest';
import {
  ListService,
  TaskService,
  compareTasks,
  duePrecisionOf,
  endOfDay,
  endOfPeriod,
  instantAtLocal,
  isOverdue,
  localDateOf,
  startOfDay,
  taskToEntry,
} from '../src/index.js';
import type { DuePrecision, Instant, LocalDate, Task } from '../src/index.js';
import { makeHarness } from './helpers.js';

/**
 * Half-day scheduling precision: pure rules on `Task` values.
 *
 * The system zone varies with the machine running the suite, so every
 * expectation here is expressed through the same helpers (`startOfDay`,
 * `instantAtLocal`, `endOfDay`) the production code uses. A literal midnight
 * would make these tests pass only in UTC+0.
 */

const DATE = '2026-09-06' as LocalDate;
const T0 = '2026-09-06T00:00:00.000Z' as Instant;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    listId: 'list-1' as Task['listId'],
    title: '任务',
    notes: '',
    status: 'open',
    important: false,
    urgent: false,
    dueAt: null,
    dueDate: null,
    allDay: false,
    duePeriod: null,
    recurrence: null,
    completedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('duePrecisionOf', () => {
  it('derives all four precisions from the stored triplet', () => {
    const cases: [Partial<Task>, DuePrecision][] = [
      [{ dueDate: null, dueAt: null, allDay: false, duePeriod: null }, 'none'],
      [{ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: null }, 'day'],
      [{ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: 'morning' }, 'period'],
      [{ dueDate: DATE, dueAt: instantAtLocal(DATE, '14:30'), allDay: false, duePeriod: null }, 'time'],
    ];
    for (const [fields, expected] of cases) {
      expect(duePrecisionOf(task(fields))).toBe(expected);
    }
  });

  it('treats a date as authoritative and allDay as the day/instant switch', () => {
    // A stray dueAt on a dateless task is "no scheduling", not "time".
    expect(duePrecisionOf(task({ dueDate: null, dueAt: T0, allDay: false }))).toBe('none');
    // duePeriod is ignored when allDay is false: an exact time cannot be a bucket.
    expect(
      duePrecisionOf(
        task({ dueDate: DATE, dueAt: instantAtLocal(DATE, '09:00'), allDay: false, duePeriod: 'morning' }),
      ),
    ).toBe('time');
  });
});

describe('isOverdue — day precision', () => {
  const dayTask = task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: null });

  it('is not overdue at any minute of its own day, including 00:00:01', () => {
    const justAfterMidnight = startOfDay(DATE);
    expect(isOverdue(dayTask, justAfterMidnight)).toBe(false);
    expect(isOverdue(dayTask, instantAtLocal(DATE, '12:00'))).toBe(false);
    expect(isOverdue(dayTask, instantAtLocal(DATE, '23:59'))).toBe(false);
  });

  it('is overdue exactly when the next day starts', () => {
    const boundary = endOfDay(DATE);
    // The boundary is exclusive, so `now === boundary` has crossed it.
    expect(isOverdue(dayTask, boundary)).toBe(true);
    // One millisecond earlier is still within the day.
    const justBefore = new Date(Date.parse(boundary) - 1).toISOString() as Instant;
    expect(isOverdue(dayTask, justBefore)).toBe(false);
  });

  it('is never overdue when done', () => {
    expect(isOverdue({ ...dayTask, status: 'done' }, endOfDay(DATE))).toBe(false);
  });
});

describe('isOverdue — period precision', () => {
  const periodTask = (period: 'morning' | 'afternoon' | 'evening') =>
    task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: period });

  it('morning ends at noon', () => {
    const morning = periodTask('morning');
    expect(isOverdue(morning, instantAtLocal(DATE, '11:59'))).toBe(false);
    expect(isOverdue(morning, instantAtLocal(DATE, '12:00'))).toBe(true);
  });

  it('afternoon ends at 19:00', () => {
    const afternoon = periodTask('afternoon');
    expect(isOverdue(afternoon, instantAtLocal(DATE, '18:59'))).toBe(false);
    expect(isOverdue(afternoon, instantAtLocal(DATE, '19:00'))).toBe(true);
  });

  it('evening ends when the next day starts', () => {
    const evening = periodTask('evening');
    expect(isOverdue(evening, instantAtLocal(DATE, '23:59'))).toBe(false);
    expect(isOverdue(evening, endOfDay(DATE))).toBe(true);
  });

  it('exposes the same boundaries via endOfPeriod', () => {
    expect(endOfPeriod(DATE, 'morning')).toBe(instantAtLocal(DATE, '12:00'));
    expect(endOfPeriod(DATE, 'afternoon')).toBe(instantAtLocal(DATE, '19:00'));
    expect(endOfPeriod(DATE, 'evening')).toBe(endOfDay(DATE));
  });
});

describe('isOverdue — time precision keeps the old rule', () => {
  const timed = task({ dueDate: DATE, dueAt: instantAtLocal(DATE, '14:30'), allDay: false });

  it('is overdue strictly after the instant, not at it', () => {
    expect(isOverdue(timed, instantAtLocal(DATE, '14:29'))).toBe(false);
    expect(isOverdue(timed, instantAtLocal(DATE, '14:30'))).toBe(false);
    expect(isOverdue(timed, instantAtLocal(DATE, '14:31'))).toBe(true);
  });
});

describe('compareTasks — period ordering within a day', () => {
  const at = (title: string, period: Task['duePeriod'], createdAt = T0): Task =>
    task({
      title,
      dueDate: DATE,
      dueAt: startOfDay(DATE),
      allDay: true,
      duePeriod: period,
      createdAt,
      updatedAt: createdAt,
    });

  it('orders morning < afternoon < evening < (no period)', () => {
    const unsorted = [at('d', null), at('c', 'evening'), at('a', 'morning'), at('b', 'afternoon')];
    expect([...unsorted].sort(compareTasks).map((t) => t.title)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not disturb the existing instant/creation ordering', () => {
    const early = task({ title: 'early', dueDate: DATE, dueAt: instantAtLocal(DATE, '08:00') });
    const late = task({ title: 'late', dueDate: DATE, dueAt: instantAtLocal(DATE, '17:00') });
    const day = at('day', null);
    const order = [late, day, early].sort(compareTasks).map((t) => t.title);
    // Day/period tasks sit at local midnight, so they come before both times.
    expect(order).toEqual(['day', 'early', 'late']);
  });
});

describe('taskToEntry — precision → calendar placement', () => {
  const color = '#5b8def';

  it('puts day tasks in the all-day strip with no period', () => {
    const entry = taskToEntry(
      task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: null }),
      color,
    );
    expect(entry).not.toBeNull();
    expect(entry!.allDay).toBe(true);
    expect(entry!.period).toBeNull();
    expect(entry!.startAt).toBe(startOfDay(DATE));
    // Exclusive next-midnight end, matching isOverdue's boundary.
    expect(entry!.endAt).toBe(endOfDay(DATE));
  });

  it('puts period tasks in the all-day strip and carries the period through', () => {
    const entry = taskToEntry(
      task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: 'morning' }),
      color,
    );
    expect(entry!.allDay).toBe(true);
    expect(entry!.period).toBe('morning');
    expect(entry!.startAt).toBe(startOfDay(DATE));
    expect(entry!.endAt).toBe(endOfDay(DATE));
  });

  it('puts time tasks on the grid', () => {
    const dueAt = instantAtLocal(DATE, '14:30');
    const entry = taskToEntry(task({ dueDate: DATE, dueAt, allDay: false }), color);
    expect(entry!.allDay).toBe(false);
    expect(entry!.period).toBeNull();
    expect(entry!.startAt).toBe(dueAt);
    expect(entry!.endAt).toBe(dueAt);
  });

  it('returns null for an unscheduled task', () => {
    expect(taskToEntry(task(), color)).toBeNull();
  });
});

describe('TaskService.schedule — discriminated union', () => {
  async function setup() {
    const h = makeHarness();
    const list = await new ListService(h.deps).create({ name: '工作', color: '#5b8def' });
    const tasks = new TaskService(h.deps);
    const created = await tasks.createInbox('写周报', list.id);
    return { h, tasks, id: created.id };
  }

  it('none clears every scheduling field', async () => {
    const { tasks, id } = await setup();
    await tasks.schedule(id, { kind: 'period', date: DATE, period: 'morning' });
    const cleared = await tasks.schedule(id, { kind: 'none' });
    expect(cleared).toMatchObject({ dueAt: null, dueDate: null, allDay: false, duePeriod: null });
  });

  it('day writes midnight + allDay and clears any previous period', async () => {
    const { tasks, id } = await setup();
    await tasks.schedule(id, { kind: 'period', date: DATE, period: 'evening' });
    const day = await tasks.schedule(id, { kind: 'day', date: DATE });
    expect(day).toMatchObject({
      dueAt: startOfDay(DATE),
      dueDate: DATE,
      allDay: true,
      duePeriod: null,
    });
    expect(duePrecisionOf(day)).toBe('day');
  });

  it('period writes midnight + allDay + the bucket', async () => {
    const { tasks, id } = await setup();
    const period = await tasks.schedule(id, { kind: 'period', date: DATE, period: 'afternoon' });
    expect(period).toMatchObject({
      dueAt: startOfDay(DATE),
      dueDate: DATE,
      allDay: true,
      duePeriod: 'afternoon',
    });
    expect(duePrecisionOf(period)).toBe('period');
  });

  it('time writes the zone-bound instant, allDay false and no period', async () => {
    const { tasks, id } = await setup();
    await tasks.schedule(id, { kind: 'period', date: DATE, period: 'morning' });
    const timed = await tasks.schedule(id, { kind: 'time', date: DATE, time: '14:30' });
    expect(timed.dueAt).toBe(instantAtLocal(DATE, '14:30'));
    expect(timed.dueDate).toBe(DATE);
    expect(timed.allDay).toBe(false);
    expect(timed.duePeriod).toBeNull();
    expect(duePrecisionOf(timed)).toBe('time');
    // The local date of the stored instant is the date that was asked for.
    expect(localDateOf(timed.dueAt!)).toBe(DATE);
  });

  it('rejects a malformed HH:MM instead of storing an invalid instant', async () => {
    const { tasks, id } = await setup();
    await expect(tasks.schedule(id, { kind: 'time', date: DATE, time: '25:99' })).rejects.toThrow();
  });

  it('unschedule also clears duePeriod', async () => {
    const { tasks, id } = await setup();
    await tasks.schedule(id, { kind: 'period', date: DATE, period: 'morning' });
    const cleared = await tasks.unschedule(id);
    expect(cleared.duePeriod).toBeNull();
    expect(cleared.dueAt).toBeNull();
  });
});
