import { describe, expect, it } from 'vitest';
import type { Instant, ListId, LocalDate, Task, TaskId } from '@todolist/core';
import { endOfDay, instantAtLocal, localDateOf, startOfDay } from '@todolist/core';
import type { ReminderItem } from '../src/reminders/ReminderScheduler.js';
import {
  ReminderState,
  computeUpcoming,
  reminderAnchorOf,
  reminderKey,
} from '../src/reminders/ReminderScheduler.js';

/**
 * Reminder anchoring for the new day / period precisions.
 *
 * Times are built with the production helpers (`startOfDay`, `instantAtLocal`,
 * `endOfDay`) rather than literal ISO strings or UTC midnight, so these tests
 * exercise the same wall-clock conversion the app uses. Nothing here calls the
 * real clock: `now` is always passed in, which is the point of the pure design.
 */

const D = (date: string) => date as LocalDate;
const DAY = D('2026-11-25');
const NEXT_DAY = D('2026-11-26');
const WINDOW = 10;

const baseTask: Task = {
  id: 'task-1' as TaskId,
  listId: 'list-1' as ListId,
  title: '写周报',
  notes: '',
  status: 'open',
  important: false,
  urgent: false,
  dueAt: startOfDay(DAY),
  dueDate: DAY,
  allDay: true,
  duePeriod: null,
  recurrence: null,
  completedAt: null,
  createdAt: startOfDay(DAY),
  updatedAt: startOfDay(DAY),
};

/** A whole-day task: stores local midnight in `dueAt`, but means "some day". */
const dayTask = (overrides: Partial<Task> = {}): Task => ({ ...baseTask, ...overrides });

/**
 * A half-day task. `startOfDay` is deliberate: it is exactly what TaskService
 * writes, so the anchor must not be read back from it.
 */
const periodTask = (period: Task['duePeriod'], overrides: Partial<Task> = {}): Task =>
  dayTask({ duePeriod: period, ...overrides });

/** An exact-time task: `allDay` false, `dueAt` is the real instant. */
const timeTask = (date: LocalDate, hhmm: string): Task =>
  dayTask({ dueAt: instantAtLocal(date, hhmm), dueDate: date, allDay: false, duePeriod: null });

const at = (date: LocalDate, hhmm: string): Instant => instantAtLocal(date, hhmm);

const idsOf = (items: readonly ReminderItem[]) => items.map((item) => item.id);

describe('reminderAnchorOf', () => {
  it('maps day to 09:00 and never to the stored midnight', () => {
    const found = reminderAnchorOf(dayTask());
    expect(found).toEqual({
      anchor: at(DAY, '09:00'),
      granularity: 'day',
      date: DAY,
      period: null,
    });
    expect(found?.anchor).not.toBe(baseTask.dueAt);
  });

  it('maps each half-day bucket to the Todoist hours', () => {
    expect(reminderAnchorOf(periodTask('morning'))?.anchor).toBe(at(DAY, '09:00'));
    expect(reminderAnchorOf(periodTask('afternoon'))?.anchor).toBe(at(DAY, '12:00'));
    expect(reminderAnchorOf(periodTask('evening'))?.anchor).toBe(at(DAY, '19:00'));
    expect(reminderAnchorOf(periodTask('morning'))?.granularity).toBe('period');
    expect(reminderAnchorOf(periodTask('evening'))?.period).toBe('evening');
  });

  it('uses dueAt itself for an exact-time task', () => {
    expect(reminderAnchorOf(timeTask(DAY, '14:30'))).toEqual({
      anchor: at(DAY, '14:30'),
      granularity: 'time',
      date: null,
      period: null,
    });
  });

  it('returns null for a task with no date', () => {
    expect(reminderAnchorOf({ dueDate: null, dueAt: null, allDay: false, duePeriod: null })).toBe(
      null,
    );
  });
});

describe('day tasks', () => {
  it('does not fire at 00:00 of their own day (the regression)', () => {
    // Stored dueAt IS this instant, which is why the old code fired here.
    expect(computeUpcoming([dayTask()], [], startOfDay(DAY), WINDOW)).toEqual([]);
  });

  it('fires at 09:00, then stays quiet for the rest of the same day', () => {
    const state = new ReminderState({ tasks: [dayTask()], events: [], windowMinutes: WINDOW });

    expect(state.tick(at(DAY, '09:00'))).toHaveLength(1);
    // Same instant again: the ledger already has the key.
    expect(state.tick(at(DAY, '09:00'))).toEqual([]);
    // A later tick the same day is inside the catch-up window but must not
    // re-announce, or the banner would return every 30 seconds.
    expect(state.tick(at(DAY, '11:00'))).toEqual([]);
  });

  it('fires once when first seen at 15:00, past its anchor', () => {
    const [item, ...rest] = computeUpcoming([dayTask()], [], at(DAY, '15:00'), WINDOW);
    expect(rest).toEqual([]);
    expect(item?.minutesUntil).toBe(-360);
    expect(item?.reminderDate).toBe(DAY);
    expect(item?.dueAt).toBe(at(DAY, '09:00'));
  });

  it('does not re-fire on a later tick the same day after that late catch-up', () => {
    const state = new ReminderState({ tasks: [dayTask()], events: [], windowMinutes: WINDOW });
    expect(state.tick(at(DAY, '15:00'))).toHaveLength(1);
    expect(state.tick(at(DAY, '15:30'))).toEqual([]);
    expect(state.tick(at(DAY, '21:00'))).toEqual([]);
  });

  it('stops being eligible at local midnight', () => {
    expect(computeUpcoming([dayTask()], [], endOfDay(DAY), WINDOW)).toEqual([]);
  });

  it('fires again on the next local day once the task rolls forward, with a new key', () => {
    const state = new ReminderState({ tasks: [dayTask()], events: [], windowMinutes: WINDOW });
    expect(state.tick(at(DAY, '15:00'))).toHaveLength(1);

    // A task left behind on DAY stays silent on DAY+1 — it is simply overdue;
    // re-announcing it would nag. The recurrence path (rollForward) is what
    // moves dueDate/dueAt to the next occurrence, and that must remind again.
    // The date-based key is what makes the next occurrence a *new* reminder.
    state.setSources(
      [dayTask({ dueDate: NEXT_DAY, dueAt: startOfDay(NEXT_DAY) })],
      [],
    );
    const nextDay = state.tick(at(NEXT_DAY, '09:00'));
    expect(nextDay).toHaveLength(1);
    expect(nextDay[0]?.reminderDate).toBe(NEXT_DAY);
    expect(reminderKey(nextDay[0]!)).toBe(`task:task-1:${NEXT_DAY}`);
    expect(reminderKey(nextDay[0]!)).not.toBe(`task:task-1:${DAY}`);
  });

  it('never re-announces a past day task on the following day', () => {
    const state = new ReminderState({ tasks: [dayTask()], events: [], windowMinutes: WINDOW });
    expect(state.tick(at(DAY, '15:00'))).toHaveLength(1);
    state.clear();
    expect(state.tick(at(NEXT_DAY, '09:00'))).toEqual([]);
  });
});

describe('period tasks', () => {
  it('morning fires at 09:00, not before', () => {
    expect(computeUpcoming([periodTask('morning')], [], at(DAY, '08:00'), WINDOW)).toEqual([]);
    expect(computeUpcoming([periodTask('morning')], [], at(DAY, '08:50'), 5)).toEqual([]);
    const [item] = computeUpcoming([periodTask('morning')], [], at(DAY, '09:00'), WINDOW);
    expect(item?.period).toBe('morning');
    expect(item?.minutesUntil).toBe(0);
  });

  it('afternoon fires at 12:00, not before', () => {
    expect(computeUpcoming([periodTask('afternoon')], [], at(DAY, '11:00'), WINDOW)).toEqual([]);
    const [item] = computeUpcoming([periodTask('afternoon')], [], at(DAY, '12:00'), WINDOW);
    expect(item?.dueAt).toBe(at(DAY, '12:00'));
    expect(item?.period).toBe('afternoon');
  });

  it('evening fires at 19:00, not before', () => {
    expect(computeUpcoming([periodTask('evening')], [], at(DAY, '18:00'), WINDOW)).toEqual([]);
    const [item] = computeUpcoming([periodTask('evening')], [], at(DAY, '19:00'), WINDOW);
    expect(item?.dueAt).toBe(at(DAY, '19:00'));
    expect(item?.period).toBe('evening');
  });

  it('catches up when first seen after its anchor, then announces once that day', () => {
    // 17:00 is well past the 12:00 anchor and past the afternoon's overdue
    // boundary, yet still inside the day. The catch-up window is the day, not
    // the bucket, so the reminder still announces — and only once.
    const state = new ReminderState({
      tasks: [periodTask('afternoon')],
      events: [],
      windowMinutes: WINDOW,
    });
    expect(state.tick(at(DAY, '17:00'))).toHaveLength(1);
    expect(state.tick(at(DAY, '18:00'))).toEqual([]);
  });

  it('uses a date-based key so ticks cannot re-fire it', () => {
    const [item] = computeUpcoming([periodTask('morning')], [], at(DAY, '10:00'), WINDOW);
    expect(item).toBeDefined();
    expect(reminderKey(item!)).toBe(`task:task-1:${DAY}`);
  });
});

describe('exact-time tasks', () => {
  it('does not fire when observed after dueAt (no catch-up)', () => {
    const task = timeTask(DAY, '14:30');
    expect(computeUpcoming([task], [], at(DAY, '14:31'), WINDOW)).toEqual([]);
    expect(computeUpcoming([task], [], at(DAY, '16:00'), WINDOW)).toEqual([]);
  });

  it('fires inside the window as before, with an instant-based key', () => {
    const task = timeTask(DAY, '14:30');
    const [item] = computeUpcoming([task], [], at(DAY, '14:25'), WINDOW);
    expect(item?.minutesUntil).toBe(5);
    expect(item?.allDay).toBe(false);
    expect(item?.reminderDate).toBeNull();
    expect(reminderKey(item!)).toBe(`task:task-1:${at(DAY, '14:30')}`);
  });

  it('still fires exactly at dueAt (inclusive lower edge)', () => {
    const [item] = computeUpcoming([timeTask(DAY, '14:30')], [], at(DAY, '14:30'), WINDOW);
    expect(item?.minutesUntil).toBe(0);
  });
});

describe('mixed day', () => {
  it('a day task and an exact-time task do not collide and stay ordered by anchor', () => {
    const tasks = [dayTask({ id: 'task-day' as TaskId }), timeTask(DAY, '14:30')];
    const items = computeUpcoming(tasks, [], at(DAY, '14:25'), WINDOW);
    expect(idsOf(items)).toEqual(['task-day', 'task-1']);
    expect(items.map((item) => item.minutesUntil)).toEqual([-325, 5]);
  });

  it('the local date of an anchor round-trips through localDateOf', () => {
    const found = reminderAnchorOf(periodTask('evening'));
    expect(found).not.toBeNull();
    expect(localDateOf(found!.anchor)).toBe(DAY);
  });
});
