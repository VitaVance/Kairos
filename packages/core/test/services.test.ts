import { beforeEach, describe, expect, it } from 'vitest';
import {
  EventService,
  ListNotEmptyError,
  ListService,
  ListValidationError,
  TaskService,
  TaskValidationError,
  localDateOf,
  startOfDay,
} from '../src/index.js';
import type { Instant, ListId, LocalDate, Recurrence, Task } from '../src/index.js';
import { makeHarness } from './helpers.js';

describe('ListService', () => {
  let h: ReturnType<typeof makeHarness>;
  let service: ListService;

  beforeEach(() => {
    h = makeHarness();
    service = new ListService(h.deps);
  });

  it('creates a list with a trimmed name and appended order', async () => {
    const a = await service.create({ name: '  工作  ', color: '#5b8def' });
    expect(a.name).toBe('工作');
    expect(a.order).toBe(0);

    const b = await service.create({ name: '生活', color: '#d99a3d' });
    expect(b.order).toBe(1);
  });

  it('rejects empty and duplicate names', async () => {
    await service.create({ name: '工作', color: '#5b8def' });
    await expect(service.create({ name: '  ', color: '#000000' })).rejects.toThrow(ListValidationError);
    await expect(service.create({ name: '工作', color: '#111111' })).rejects.toThrow('已存在');
  });

  it('renames and recolors, validating the hex format', async () => {
    const list = await service.create({ name: '工作', color: '#5b8def' });
    expect((await service.rename(list.id, '项目')).name).toBe('项目');
    expect((await service.recolor(list.id, '#123abc')).color).toBe('#123abc');
    await expect(service.recolor(list.id, 'red')).rejects.toThrow('颜色格式无效');
  });

  it('refuses to delete a list that still has tasks', async () => {
    const list = await service.create({ name: '工作', color: '#5b8def' });
    const tasks = new TaskService(h.deps);
    await tasks.createInbox('写周报', list.id);

    await expect(service.remove(list.id)).rejects.toThrow(ListNotEmptyError);

    await service.remove(list.id, { force: true });
    expect(await h.uow.lists.get(list.id)).toBeNull();
  });

  it('fails loudly for an unknown list', async () => {
    await expect(service.rename('nope' as ListId, 'x')).rejects.toThrow('清单不存在');
  });
});

describe('EventService', () => {
  let h: ReturnType<typeof makeHarness>;
  let service: EventService;

  beforeEach(() => {
    h = makeHarness();
    service = new EventService(h.deps);
  });

  const at = (s: string) => s as Instant;

  it('creates an event and lists it in range', async () => {
    await service.create({
      title: '  线上会议  ',
      startAt: at('2026-09-06T08:00:00Z'),
      endAt: at('2026-09-06T10:00:00Z'),
    });
    const found = await service.listBetween(at('2026-09-06T00:00:00Z'), at('2026-09-07T00:00:00Z'));
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('线上会议');
  });

  it('rejects an empty title and an inverted time range', async () => {
    await expect(
      service.create({ title: '  ', startAt: at('2026-09-06T08:00:00Z'), endAt: at('2026-09-06T09:00:00Z') }),
    ).rejects.toThrow('标题不能为空');
    await expect(
      service.create({ title: 'x', startAt: at('2026-09-06T10:00:00Z'), endAt: at('2026-09-06T09:00:00Z') }),
    ).rejects.toThrow('结束时间必须晚于开始时间');
  });

  it('reschedules and validates the new range', async () => {
    const e = await service.create({
      title: '评审',
      startAt: at('2026-09-06T08:00:00Z'),
      endAt: at('2026-09-06T09:00:00Z'),
    });
    const moved = await service.reschedule(e.id, at('2026-09-06T13:00:00Z'), at('2026-09-06T15:00:00Z'));
    expect(moved.startAt).toBe('2026-09-06T13:00:00Z');

    await expect(
      service.reschedule(e.id, at('2026-09-06T15:00:00Z'), at('2026-09-06T14:00:00Z')),
    ).rejects.toThrow('结束时间必须晚于开始时间');
  });

  it('removes an event and fails on unknown ids', async () => {
    const e = await service.create({
      title: '聚餐',
      startAt: at('2026-09-06T18:00:00Z'),
      endAt: at('2026-09-06T20:00:00Z'),
    });
    await service.remove(e.id);
    expect(await h.uow.events.get(e.id)).toBeNull();
    await expect(service.remove(e.id)).rejects.toThrow('日程不存在');
  });
});

describe('TaskService additions', () => {  it('updates notes, moves lists, and unschedules', async () => {
    const h = makeHarness();
    const lists = new ListService(h.deps);
    const work = await lists.create({ name: '工作', color: '#5b8def' });
    const life = await lists.create({ name: '生活', color: '#d99a3d' });
    const tasks = new TaskService(h.deps);

    const task = await tasks.createInbox('晨跑', work.id);
    expect((await tasks.updateNotes(task.id, '绕湖一圈')).notes).toBe('绕湖一圈');

    const moved = await tasks.moveToList(task.id, life.id);
    expect(moved.listId).toBe(life.id);

    await tasks.schedule(task.id, {
      kind: 'time',
      date: '2026-09-06' as LocalDate,
      time: '08:00',
    });
    const cleared = await tasks.unschedule(task.id);
    expect(cleared.dueAt).toBeNull();
    expect(cleared.dueDate).toBeNull();
  });

  it('rejects moving to a list that does not exist', async () => {
    const h = makeHarness();
    const work = await new ListService(h.deps).create({ name: '工作', color: '#5b8def' });
    const tasks = new TaskService(h.deps);
    const task = await tasks.createInbox('任务', work.id);
    await expect(tasks.moveToList(task.id, 'missing' as ListId)).rejects.toThrow('清单不存在');
  });
});

describe('TaskService recurrence', () => {
  // makeHarness pins the clock to 2026-09-06T02:00:00Z, which is 2026-09-06 in
  // every westward-or-equal zone and 2026-09-06 10:00 in Asia/Shanghai.
  const TODAY = '2026-09-06' as LocalDate;

  async function setup() {
    const h = makeHarness();
    const work = await new ListService(h.deps).create({ name: '工作', color: '#5b8def' });
    const tasks = new TaskService(h.deps);
    const task = await tasks.createInbox('写周报', work.id);
    return { h, tasks, task };
  }

  const dueTask = (base: Task, date: LocalDate, time = '09:00'): Task => ({
    ...base,
    dueDate: date,
    dueAt: `${date}T${time}:00.000Z` as Instant,
    allDay: false,
  });

  it('creates tasks without a recurrence', async () => {
    const { task } = await setup();
    expect(task.recurrence).toBeNull();
  });

  it('sets and clears the rule, rejecting a malformed one', async () => {
    const { tasks, task } = await setup();
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [0] };

    const set = await tasks.setRecurrence(task.id, rule);
    expect(set.recurrence).toEqual(rule);

    const cleared = await tasks.setRecurrence(task.id, null);
    expect(cleared.recurrence).toBeNull();

    await expect(
      tasks.setRecurrence(task.id, { frequency: 'weekly', interval: 1, weekdays: [] } as unknown as Recurrence),
    ).rejects.toThrow(TaskValidationError);
  });

  it('rolls a completed recurring task forward to the next occurrence', async () => {
    const { h, tasks, task } = await setup();
    const due = dueTask(task, TODAY);

    await tasks.setRecurrence(task.id, { frequency: 'daily', interval: 1 });
    // Mirror the scheduled task into the harness, then complete it.
    await h.uow.tasks.update(task.id, { dueDate: due.dueDate, dueAt: due.dueAt, allDay: false }, h.now);

    const rolled = await tasks.toggleDone(task.id);

    // Completing does NOT mark it done; it advances the date.
    expect(rolled.status).toBe('open');
    expect(rolled.completedAt).toBeNull();
    expect(rolled.dueDate).toBe('2026-09-07');
    // The wall-clock offset from local midnight is preserved.
    expect(localDateOf(rolled.dueAt!)).toBe('2026-09-07');
    expect(rolled.recurrence).toEqual({ frequency: 'daily', interval: 1 });

    // A fresh completion advances again.
    const next = await tasks.toggleDone(task.id);
    expect(next.dueDate).toBe('2026-09-08');
  });

  it('catches an overdue daily task up to today in one completion', async () => {
    const { h, tasks, task } = await setup();
    await tasks.setRecurrence(task.id, { frequency: 'daily', interval: 1 });
    // Scheduled a month ago; the harness clock is 2026-09-06.
    const stale = dueTask(task, '2026-08-01' as LocalDate);
    await h.uow.tasks.update(task.id, { dueDate: stale.dueDate, dueAt: stale.dueAt }, h.now);

    const rolled = await tasks.toggleDone(task.id);
    expect(rolled.dueDate).toBe(TODAY);
    expect(rolled.status).toBe('open');
  });

  it('advances an all-day recurring task to local midnight of the next day', async () => {
    const { h, tasks, task } = await setup();
    await tasks.setRecurrence(task.id, { frequency: 'daily', interval: 1 });
    await h.uow.tasks.update(
      task.id,
      { dueDate: TODAY, dueAt: startOfDay(TODAY), allDay: true },
      h.now,
    );

    const rolled = await tasks.toggleDone(task.id);
    expect(rolled.dueDate).toBe('2026-09-07');
    expect(rolled.dueAt).toBe(startOfDay('2026-09-07' as LocalDate));
  });

  it('leaves an exhausted series completed instead of looping', async () => {
    const { h, tasks, task } = await setup();
    // The only occurrence is today; `until` makes tomorrow out of range.
    await tasks.setRecurrence(task.id, { frequency: 'daily', interval: 1, until: TODAY });
    await h.uow.tasks.update(
      task.id,
      { dueDate: TODAY, dueAt: startOfDay(TODAY), allDay: true },
      h.now,
    );

    const done = await tasks.toggleDone(task.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBe(h.now);
    // Reopening still works.
    const reopened = await tasks.toggleDone(task.id);
    expect(reopened.status).toBe('open');
  });

  it('completes normally when the stored rule is malformed', async () => {
    const { h, tasks, task } = await setup();
    // Bypass the service guard to simulate a corrupt row.
    await h.uow.tasks.update(
      task.id,
      {
        dueDate: TODAY,
        dueAt: startOfDay(TODAY),
        allDay: true,
        recurrence: { frequency: 'weekly', interval: 0, weekdays: [] } as unknown as Recurrence,
      },
      h.now,
    );

    const done = await tasks.toggleDone(task.id);
    expect(done.status).toBe('done');
    expect(done.dueDate).toBe(TODAY);
  });

  it('advances a monthly rule by month, skipping short months', async () => {
    const { h, tasks, task } = await setup();
    await tasks.setRecurrence(task.id, { frequency: 'monthly', interval: 1, monthDay: 31 });
    // 2026-09-30 is "today"; there is no Sep 31, so the next occurrence is Oct 31.
    await h.uow.tasks.update(
      task.id,
      { dueDate: '2026-09-30' as LocalDate, dueAt: startOfDay('2026-09-30' as LocalDate), allDay: true },
      h.now,
    );

    const rolled = await tasks.toggleDone(task.id);
    expect(rolled.dueDate).toBe('2026-10-31');
  });
});
