import { describe, expect, it } from 'vitest';
import { CalendarService } from '../src/application/calendar-service.js';
import { TaskService } from '../src/application/task-service.js';
import { quadrantOf } from '../src/domain/task.js';
import type {
  CalendarEvent,
  EventId,
  Instant,
  ListId,
  LocalDate,
  NewEvent,
  NewList,
  NewTask,
  Task,
  TaskId,
  TaskList,
  TaskPatch,
  UnitOfWork,
} from '../src/index.js';

/** Tiny in-memory adapter — proves the ports are actually swappable. */
function makeHarness() {
  const lists: TaskList[] = [];
  const tasks: Task[] = [];
  const events: CalendarEvent[] = [];
  let seq = 0;
  const now = '2026-09-06T02:00:00.000Z' as Instant;

  const uow: UnitOfWork = {
    lists: {
      async list() {
        return lists;
      },
      async get(id: ListId) {
        return lists.find((l) => l.id === id) ?? null;
      },
      async create(input: NewList, at: Instant) {
        const list: TaskList = {
          id: `l${++seq}` as ListId,
          name: input.name,
          color: input.color,
          order: input.order ?? lists.length,
          archived: false,
          createdAt: at,
          updatedAt: at,
        };
        lists.push(list);
        return list;
      },
      async restore(list: TaskList) { lists.push(list); return list; },
      async update(id: ListId, patch: Partial<Omit<TaskList, 'id' | 'createdAt'>>, at: Instant) {
        const i = lists.findIndex((l) => l.id === id);
        lists[i] = { ...lists[i]!, ...patch, updatedAt: at };
        return lists[i]!;
      },
      async remove(id: ListId) {
        const i = lists.findIndex((l) => l.id === id);
        if (i >= 0) lists.splice(i, 1);
      },
    },
    tasks: {
      async list(filter) {
        return tasks.filter(
          (t) =>
            (filter?.listId === undefined || t.listId === filter.listId) &&
            (filter?.status === undefined || t.status === filter.status),
        );
      },
      async get(id: TaskId) {
        return tasks.find((t) => t.id === id) ?? null;
      },
      async create(input: NewTask, at: Instant) {
        const task: Task = {
          id: `t${++seq}` as TaskId,
          listId: input.listId ?? ('l1' as ListId),
          title: input.title,
          notes: input.notes ?? '',
          status: 'open',
          important: input.important ?? false,
          urgent: input.urgent ?? false,
          dueAt: input.dueAt ?? null,
          dueDate: input.dueDate ?? null,
          allDay: input.allDay ?? false,
          duePeriod: input.duePeriod ?? null,
          recurrence: input.recurrence ?? null,
          completedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        tasks.push(task);
        return task;
      },
      async restore(task: Task) { tasks.push(task); return task; },
      async update(id: TaskId, patch: TaskPatch, at: Instant) {
        const i = tasks.findIndex((t) => t.id === id);
        tasks[i] = { ...tasks[i]!, ...patch, updatedAt: at };
        return tasks[i]!;
      },
      async remove(id: TaskId) {
        const i = tasks.findIndex((t) => t.id === id);
        if (i >= 0) tasks.splice(i, 1);
      },
    },
    events: {
      async list() {
        return events;
      },
      async get(id: EventId) {
        return events.find((e) => e.id === id) ?? null;
      },
      async create(input: NewEvent, at: Instant) {
        const event: CalendarEvent = {
          id: `e${++seq}` as EventId,
          listId: input.listId ?? null,
          title: input.title,
          notes: input.notes ?? '',
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay ?? false,
          createdAt: at,
          updatedAt: at,
        };
        events.push(event);
        return event;
      },
      async restore(event: CalendarEvent) { events.push(event); return event; },
      async update(id: EventId, patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>, at: Instant) {
        const i = events.findIndex((e) => e.id === id);
        events[i] = { ...events[i]!, ...patch, updatedAt: at };
        return events[i]!;
      },
      async remove(id: EventId) {
        const i = events.findIndex((e) => e.id === id);
        if (i >= 0) events.splice(i, 1);
      },
    },
  };

  const taskService = new TaskService({
    uow,
    clock: { now: () => now },
    ids: {
      task: () => `t${++seq}` as TaskId,
      list: () => `l${++seq}` as ListId,
      event: () => `e${++seq}` as EventId,
    },
  });
  const calendarService = new CalendarService({ uow });

  return { uow, taskService, calendarService, lists, tasks, events, now };
}

describe('TaskService', () => {
  it('creates an inbox task in the first list and rejects empty titles', async () => {
    const h = makeHarness();
    const list = await h.uow.lists.create({ name: '收集箱', color: '#999' }, h.now);

    const task = await h.taskService.createInbox('  晨跑  ', list.id);
    expect(task.title).toBe('晨跑');
    expect(task.status).toBe('open');
    await expect(h.taskService.createInbox('   ', list.id)).rejects.toThrow('不能为空');
  });

  it('moves a task between quadrants by flipping its axes', async () => {
    const h = makeHarness();
    const list = await h.uow.lists.create({ name: '工作', color: '#5b5bd6' }, h.now);
    const task = await h.taskService.createInbox('制定营销策略', list.id);

    const moved = await h.taskService.moveToQuadrant(task.id, 'urgent-important');
    expect(quadrantOf(moved)).toBe('urgent-important');

    const moved2 = await h.taskService.moveToQuadrant(task.id, 'not-urgent-important');
    expect(quadrantOf(moved2)).toBe('not-urgent-important');
  });

  it('toggles done and back, stamping completedAt', async () => {
    const h = makeHarness();
    const list = await h.uow.lists.create({ name: '生活', color: '#6b8a5e' }, h.now);
    const task = await h.taskService.createInbox('拿快递', list.id);

    const done = await h.taskService.toggleDone(task.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBe(h.now);

    const reopened = await h.taskService.toggleDone(task.id);
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
  });

  it('fails loudly when the task does not exist', async () => {
    const h = makeHarness();
    await expect(h.taskService.toggleDone('nope' as TaskId)).rejects.toThrow('任务不存在');
  });
});

describe('CalendarService', () => {
  it('merges scheduled tasks and events into one entry stream', async () => {
    const h = makeHarness();
    const list = await h.uow.lists.create({ name: '工作', color: '#4a6d8c' }, h.now);
    const task = await h.taskService.createInbox('产品评审', list.id);
    await h.taskService.schedule(task.id, {
      kind: 'time',
      date: '2026-09-06' as LocalDate,
      time: '13:00',
    });
    await h.uow.events.create(
      { title: '线上会议', startAt: '2026-09-06T08:00:00.000Z' as Instant, endAt: '2026-09-06T10:00:00.000Z' as Instant },
      h.now,
    );

    const day = await h.calendarService.entriesForDay('2026-09-06' as LocalDate);
    expect(day).toHaveLength(2);
    // Ordering is by start instant, so pick out the sources rather than
    // assuming the task's local wall clock lands before the UTC event.
    expect(day.find((e) => e.source === 'event')!.title).toBe('线上会议');
    const taskEntry = day.find((e) => e.source === 'task')!;
    expect(taskEntry.color).toBe('#4a6d8c');
    expect(taskEntry.allDay).toBe(false);
  });

  it('builds a 6x7 month grid starting on Monday', async () => {
    const h = makeHarness();
    const grid = h.calendarService.monthGrid('2026-09-06' as LocalDate);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-09-01 is a Tuesday → grid starts Monday 2026-08-31
    expect(grid.weeks[0]![0]).toBe('2026-08-31');
    expect(grid.weeks[0]![6]).toBe('2026-09-06');
  });

  it('returns the Monday-first week for a date', () => {
    const h = makeHarness();
    const days = h.calendarService.weekDays('2026-09-06' as LocalDate);
    expect(days[0]).toBe('2026-08-31');
    expect(days[6]).toBe('2026-09-06');
  });
});

describe('domain rules', () => {
  it('derives quadrants from the two axes', () => {
    expect(quadrantOf({ important: true, urgent: true })).toBe('urgent-important');
    expect(quadrantOf({ important: true, urgent: false })).toBe('not-urgent-important');
    expect(quadrantOf({ important: false, urgent: true })).toBe('urgent-not-important');
    expect(quadrantOf({ important: false, urgent: false })).toBe('unimportant');
  });
});
