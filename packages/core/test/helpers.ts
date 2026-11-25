import { CalendarService } from '../src/application/calendar-service.js';
import { TaskService } from '../src/application/task-service.js';
import type {
  CalendarEvent,
  EventId,
  Instant,
  ListId,
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

  const deps = {
    uow,
    clock: { now: () => now },
    ids: {
      task: () => `t${++seq}` as TaskId,
      list: () => `l${++seq}` as ListId,
      event: () => `e${++seq}` as EventId,
    },
  };

  return { uow, taskService, calendarService, deps, lists, tasks, events, now };
}

export { makeHarness };
