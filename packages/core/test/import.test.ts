import { describe, expect, it } from 'vitest';
import { ImportService, ImportValidationError, ListService, TaskService } from '../src/index.js';
import type { CalendarEvent, Instant, Task, TaskList } from '../src/index.js';
import { makeHarness } from './helpers.js';

const NOW = '2026-09-06T02:00:00.000Z' as Instant;

function task(id: string, listId: string, overrides: Partial<Task> = {}): Task {
  return {
    id: id as Task['id'],
    listId: listId as Task['listId'],
    title: `任务 ${id}`,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function list(id: string): TaskList {
  return {
    id: id as TaskList['id'],
    name: `清单 ${id}`,
    color: '#5b8def',
    order: 0,
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('ImportService', () => {
  it('restores records verbatim, keeping ids and list references', async () => {
    const h = makeHarness();
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });

    const outcome = await service.apply(
      { lists: [list('L1')], tasks: [task('T1', 'L1')], events: [] },
      'replace',
    );

    expect(outcome.addedLists).toBe(1);
    expect(outcome.addedTasks).toBe(1);
    const restored = await h.uow.tasks.get('T1' as Task['id']);
    expect(restored?.listId).toBe('L1');
  });

  it('rejects a payload whose tasks point at a missing list, before writing anything', async () => {
    const h = makeHarness();
    const existing = await new ListService(h.deps).create({ name: '工作', color: '#5b8def' });
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });

    await expect(
      service.apply({ lists: [], tasks: [task('T1', 'GHOST')], events: [] }, 'replace'),
    ).rejects.toThrow(ImportValidationError);

    // The pre-existing data must be untouched: validation runs before wipe.
    expect(await h.uow.lists.get(existing.id)).not.toBeNull();
  });

  it('leaves existing tasks untouched when a replace payload is dangling', async () => {
    const h = makeHarness();
    const list = await new ListService(h.deps).create({ name: '工作', color: '#5b8def' });
    const tasks = new TaskService(h.deps);
    const existing = await tasks.createInbox('原有任务', list.id);

    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });
    await expect(
      service.apply({ lists: [], tasks: [task('T1', 'GHOST')], events: [] }, 'replace'),
    ).rejects.toThrow(ImportValidationError);

    // Data-loss guard: a replace that fails validation must not have wiped.
    expect(await h.uow.tasks.get(existing.id)).not.toBeNull();
  });

  it('rejects duplicate ids and inverted event ranges', async () => {
    const h = makeHarness();
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });
    const badEvent: CalendarEvent = {
      id: 'E1' as CalendarEvent['id'],
      listId: null,
      title: '倒序',
      notes: '',
      startAt: '2026-09-06T10:00:00.000Z' as Instant,
      endAt: '2026-09-06T09:00:00.000Z' as Instant,
      allDay: false,
      createdAt: NOW,
      updatedAt: NOW,
    };

    await expect(
      service.apply(
        { lists: [list('L1')], tasks: [task('T1', 'L1'), task('T1', 'L1')], events: [badEvent] },
        'merge',
      ),
    ).rejects.toThrow(/id 重复|结束时间/);
  });

  it('merge adds missing ids and updates newer copies', async () => {
    const h = makeHarness();
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });
    await service.apply({ lists: [list('L1')], tasks: [task('T1', 'L1')], events: [] }, 'merge');

    // A newer copy of T1 plus a brand-new T2.
    const newer = task('T1', 'L1', {
      title: '改过的标题',
      updatedAt: '2026-09-07T00:00:00.000Z' as Instant,
    });
    const outcome = await service.apply(
      { lists: [list('L1')], tasks: [newer, task('T2', 'L1')], events: [] },
      'merge',
    );

    expect(outcome.addedTasks).toBe(1);
    expect(outcome.updated).toBe(1);
    expect((await h.uow.tasks.get('T1' as Task['id']))?.title).toBe('改过的标题');
  });

  it('merge skips an older or equal copy', async () => {
    const h = makeHarness();
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });
    await service.apply(
      { lists: [list('L1')], tasks: [task('T1', 'L1', { title: '新', updatedAt: '2026-09-07T00:00:00.000Z' as Instant })], events: [] },
      'merge',
    );

    const older = task('T1', 'L1', { title: '旧', updatedAt: NOW });
    const outcome = await service.apply({ lists: [list('L1')], tasks: [older], events: [] }, 'merge');

    expect(outcome.updated).toBe(0);
    expect((await h.uow.tasks.get('T1' as Task['id']))?.title).toBe('新');
  });

  it('replace clears everything first', async () => {
    const h = makeHarness();
    const lists = new ListService(h.deps);
    const old = await lists.create({ name: '旧清单', color: '#d99a3d' });
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });

    await service.apply({ lists: [list('L9')], tasks: [], events: [] }, 'replace');

    expect(await h.uow.lists.get(old.id)).toBeNull();
    expect(await h.uow.lists.get('L9' as TaskList['id'])).not.toBeNull();
  });

  it('is idempotent when the same file is merged twice', async () => {
    const h = makeHarness();
    const service = new ImportService({ uow: h.uow, clock: h.deps.clock });
    const payload = { lists: [list('L1')], tasks: [task('T1', 'L1')], events: [] };

    await service.apply(payload, 'merge');
    const second = await service.apply(payload, 'merge');

    expect(second.addedTasks).toBe(0);
    expect(second.addedLists).toBe(0);
    expect((await h.uow.tasks.list()).length).toBe(1);
  });
});
