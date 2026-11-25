import { beforeEach, describe, expect, it } from 'vitest';
import type { EventId, Instant, ListId, LocalDate, TaskId } from '@todolist/core';
import {
  EntityNotFoundError,
  InvalidEntityError,
  MemoryUnitOfWork,
} from '../src/index.js';
import type { IdGenerator } from '@todolist/core';

const T0 = '2026-09-06T08:00:00.000Z' as Instant;
const T1 = '2026-09-06T09:30:00.000Z' as Instant;

/** Deterministic ids so assertions can name them. */
function sequentialIds(): IdGenerator {
  let task = 0;
  let list = 0;
  let event = 0;
  return {
    task: () => `task-${++task}` as TaskId,
    list: () => `list-${++list}` as ListId,
    event: () => `event-${++event}` as EventId,
  };
}

describe('MemoryUnitOfWork', () => {
  let uow: MemoryUnitOfWork;

  beforeEach(() => {
    uow = new MemoryUnitOfWork(sequentialIds());
  });

  it('works with no constructor arguments', async () => {
    const bare = new MemoryUnitOfWork();
    const list = await bare.lists.create({ name: '收集箱', color: '#dd7366' }, T0);
    expect(list.id).toMatch(/^l_/);
  });

  describe('tasks', () => {
    it('round trips create → list → get → update → remove', async () => {
      const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, T0);
      const created = await uow.tasks.create(
        {
          title: '制定营销策略',
          listId: list.id,
          notes: '先做用户访谈',
          important: true,
          urgent: true,
          dueAt: '2026-09-06T09:00:00.000Z' as Instant,
          dueDate: '2026-09-06' as LocalDate,
          allDay: false,
        },
        T0,
      );

      expect(created).toMatchObject({
        id: 'task-1',
        title: '制定营销策略',
        status: 'open',
        important: true,
        urgent: true,
        completedAt: null,
        createdAt: T0,
        updatedAt: T0,
      });

      const listed = await uow.tasks.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(created);

      const fetched = await uow.tasks.get(created.id);
      expect(fetched).toEqual(created);

      const updated = await uow.tasks.update(created.id, { title: '制定 Q4 营销策略' }, T1);
      expect(updated.title).toBe('制定 Q4 营销策略');
      expect(updated.updatedAt).toBe(T1);
      // Partial patch must leave every other field untouched.
      expect(updated.notes).toBe('先做用户访谈');
      expect(updated.important).toBe(true);
      expect(updated.dueAt).toBe('2026-09-06T09:00:00.000Z');
      expect(updated.createdAt).toBe(T0);

      await uow.tasks.remove(created.id);
      expect(await uow.tasks.get(created.id)).toBeNull();
      expect(await uow.tasks.list()).toHaveLength(0);
    });

    it('applies defaults for optional create fields', async () => {
      const list = await uow.lists.create({ name: '收集箱', color: '#dd7366' }, T0);
      const task = await uow.tasks.create({ title: '拿快递', listId: list.id }, T0);
      expect(task).toMatchObject({
        notes: '',
        status: 'open',
        important: false,
        urgent: false,
        dueAt: null,
        dueDate: null,
        allDay: false,
        recurrence: null,
        completedAt: null,
      });
    });

    it('filters by listId and status', async () => {
      const a = await uow.lists.create({ name: '工作', color: '#5b8def' }, T0);
      const b = await uow.lists.create({ name: '生活', color: '#d99a3d' }, T0);
      const one = await uow.tasks.create({ title: '任务一', listId: a.id }, T0);
      await uow.tasks.create({ title: '任务二', listId: b.id }, T0);
      const three = await uow.tasks.create({ title: '任务三', listId: a.id }, T0);
      await uow.tasks.update(three.id, { status: 'done', completedAt: T1 }, T1);

      const byList = await uow.tasks.list({ listId: a.id });
      expect(byList.map((t) => t.title)).toEqual(['任务一', '任务三']);

      const byStatus = await uow.tasks.list({ status: 'done' });
      expect(byStatus.map((t) => t.id)).toEqual([three.id]);

      const both = await uow.tasks.list({ listId: a.id, status: 'open' });
      expect(both.map((t) => t.id)).toEqual([one.id]);
    });

    it('treats an empty patch as a no-op (updatedAt untouched)', async () => {
      const list = await uow.lists.create({ name: '收集箱', color: '#dd7366' }, T0);
      const task = await uow.tasks.create({ title: '整理音乐播放列表', listId: list.id }, T0);
      const patched = await uow.tasks.update(task.id, {}, T1);
      expect(patched).toEqual(task);
      expect(patched.updatedAt).toBe(T0);
    });

    it('skips undefined keys in a patch', async () => {
      const list = await uow.lists.create({ name: '收集箱', color: '#dd7366' }, T0);
      const task = await uow.tasks.create({ title: '原题', listId: list.id }, T0);
      const patched = await uow.tasks.update(task.id, { title: undefined, notes: '补充' }, T1);
      expect(patched.title).toBe('原题');
      expect(patched.notes).toBe('补充');
      expect(patched.updatedAt).toBe(T1);
    });

    it('throws EntityNotFoundError when updating a missing task', async () => {
      await expect(
        uow.tasks.update('nope' as TaskId, { title: 'x' }, T1),
      ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('returns null (not an error) when getting a missing task', async () => {
      await expect(uow.tasks.get('nope' as TaskId)).resolves.toBeNull();
    });

    it('remove is idempotent for a missing task', async () => {
      await expect(uow.tasks.remove('nope' as TaskId)).resolves.toBeUndefined();
    });

    it('requires a listId', async () => {
      await expect(
        uow.tasks.create({ title: '孤儿任务' } as never, T0),
      ).rejects.toBeInstanceOf(InvalidEntityError);
    });

    it('defaults recurrence to null and round-trips a rule', async () => {
      const list = await uow.lists.create({ name: '收集箱', color: '#dd7366' }, T0);
      const task = await uow.tasks.create({ title: '晨跑', listId: list.id }, T0);
      expect(task.recurrence).toBeNull();

      const rule = { frequency: 'weekly', interval: 2, weekdays: [0, 2], until: null } as const;
      const updated = await uow.tasks.update(task.id, { recurrence: { ...rule, weekdays: [0, 2] } }, T1);
      expect(updated.recurrence).toEqual(rule);
      expect(updated.updatedAt).toBe(T1);

      // Other fields are untouched, and `createdAt` never moves.
      expect(updated.title).toBe('晨跑');
      expect(updated.createdAt).toBe(T0);

      const cleared = await uow.tasks.update(task.id, { recurrence: null }, T1);
      expect(cleared.recurrence).toBeNull();
    });
  });

  describe('lists', () => {
    it('round trips create → list → get → update → remove', async () => {
      const created = await uow.lists.create({ name: '学习', color: '#8b79c9' }, T0);
      expect(created).toMatchObject({
        id: 'list-1',
        name: '学习',
        color: '#8b79c9',
        order: 0,
        archived: false,
        createdAt: T0,
        updatedAt: T0,
      });

      const second = await uow.lists.create({ name: '生活', color: '#d99a3d' }, T0);
      expect(second.order).toBe(1);
      expect(await uow.lists.list()).toHaveLength(2);
      expect(await uow.lists.get(created.id)).toEqual(created);

      const renamed = await uow.lists.update(created.id, { name: '深度学习' }, T1);
      expect(renamed.name).toBe('深度学习');
      expect(renamed.color).toBe('#8b79c9');
      expect(renamed.updatedAt).toBe(T1);

      await uow.lists.remove(created.id);
      expect(await uow.lists.get(created.id)).toBeNull();
      expect(await uow.lists.list()).toHaveLength(1);
    });

    it('honours an explicit order', async () => {
      const list = await uow.lists.create({ name: '工作', color: '#5b8def', order: 42 }, T0);
      expect(list.order).toBe(42);
    });

    it('throws when updating a missing list', async () => {
      await expect(
        uow.lists.update('nope' as ListId, { name: 'x' }, T1),
      ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe('events', () => {
    it('round trips create → list → get → update → remove', async () => {
      const list = await uow.lists.create({ name: '工作', color: '#5b8def' }, T0);
      const created = await uow.events.create(
        {
          title: '产品评审',
          listId: list.id,
          notes: '带原型稿',
          startAt: '2026-09-06T13:00:00.000Z' as Instant,
          endAt: '2026-09-06T16:00:00.000Z' as Instant,
        },
        T0,
      );
      expect(created).toMatchObject({
        id: 'event-1',
        listId: list.id,
        notes: '带原型稿',
        allDay: false,
        createdAt: T0,
      });

      expect(await uow.events.list()).toHaveLength(1);
      expect(await uow.events.get(created.id)).toEqual(created);

      const moved = await uow.events.update(
        created.id,
        { startAt: '2026-09-06T14:00:00.000Z' as Instant, endAt: '2026-09-06T17:00:00.000Z' as Instant },
        T1,
      );
      expect(moved.startAt).toBe('2026-09-06T14:00:00.000Z');
      expect(moved.title).toBe('产品评审');
      expect(moved.updatedAt).toBe(T1);

      await uow.events.remove(created.id);
      expect(await uow.events.get(created.id)).toBeNull();
      expect(await uow.events.list()).toHaveLength(0);
    });

    it('allows a null listId', async () => {
      const event = await uow.events.create(
        {
          title: '线上会议',
          startAt: '2026-09-06T08:00:00.000Z' as Instant,
          endAt: '2026-09-06T10:00:00.000Z' as Instant,
        },
        T0,
      );
      expect(event.listId).toBeNull();
    });

    it('filters by half-open [from, to) overlap window', async () => {
      await uow.events.create(
        { title: '上午', startAt: '2026-09-06T08:00:00.000Z' as Instant, endAt: '2026-09-06T10:00:00.000Z' as Instant },
        T0,
      );
      const afternoon = await uow.events.create(
        { title: '下午', startAt: '2026-09-06T14:00:00.000Z' as Instant, endAt: '2026-09-06T16:00:00.000Z' as Instant },
        T0,
      );

      const inWindow = await uow.events.list({
        from: '2026-09-06T13:00:00.000Z' as Instant,
        to: '2026-09-06T17:00:00.000Z' as Instant,
      });
      expect(inWindow.map((e) => e.id)).toEqual([afternoon.id]);
    });

    it('throws when updating a missing event', async () => {
      await expect(
        uow.events.update('nope' as EventId, { title: 'x' }, T1),
      ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });
});
