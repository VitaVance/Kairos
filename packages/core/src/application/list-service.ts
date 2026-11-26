import type { Instant, ListId, NewEvent, NewList, TaskList } from '../domain/types.js';
import type { CalendarEvent, EventId } from '../domain/types.js';
import type { Clock, IdGenerator, UnitOfWork } from '../ports/repository.js';

/**
 * List use cases. Kept separate from TaskService because list lifecycle has
 * its own rules (ordering, deletion safety) and changing one should never
 * require touching the other — Interface Segregation at the service level.
 */
export class ListService {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; ids: IdGenerator },
  ) {}

  async listAll(): Promise<readonly TaskList[]> {
    return [...(await this.deps.uow.lists.list())].sort((a, b) => a.order - b.order);
  }

  async create(input: NewList): Promise<TaskList> {
    const name = input.name.trim();
    if (name.length === 0) throw new ListValidationError('清单名称不能为空');
    const existing = await this.deps.uow.lists.list();
    if (existing.some((l) => l.name === name && !l.archived)) {
      throw new ListValidationError(`清单已存在: ${name}`);
    }
    const order = input.order ?? existing.length;
    return this.deps.uow.lists.create({ ...input, name, order }, this.deps.clock.now());
  }

  async rename(id: ListId, name: string): Promise<TaskList> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new ListValidationError('清单名称不能为空');
    await this.require(id);
    return this.deps.uow.lists.update(id, { name: trimmed }, this.deps.clock.now());
  }

  async recolor(id: ListId, color: string): Promise<TaskList> {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new ListValidationError(`颜色格式无效: ${color}`);
    }
    await this.require(id);
    return this.deps.uow.lists.update(id, { color }, this.deps.clock.now());
  }

  async reorder(id: ListId, order: number): Promise<TaskList> {
    await this.require(id);
    return this.deps.uow.lists.update(id, { order }, this.deps.clock.now());
  }

  /**
   * Deletes a list. Refuses while it still holds tasks unless `force` is set —
   * an implicit cascade would silently destroy the user's work.
   */
  async remove(id: ListId, options: { force?: boolean } = {}): Promise<void> {
    await this.require(id);
    const tasks = await this.deps.uow.tasks.list({ listId: id });
    if (tasks.length > 0 && !options.force) {
      throw new ListNotEmptyError(id, tasks.length);
    }
    await this.deps.uow.lists.remove(id);
  }

  private async require(id: ListId): Promise<TaskList> {
    const list = await this.deps.uow.lists.get(id);
    if (!list) throw new ListValidationError(`清单不存在: ${id}`);
    return list;
  }
}

/**
 * Event use cases. Events are calendar-only (they are not tasks), so this is
 * the write side that CalendarService deliberately does not have.
 */
export class EventService {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; ids: IdGenerator },
  ) {}

  async listBetween(from: Instant, to: Instant): Promise<readonly CalendarEvent[]> {
    return this.deps.uow.events.list({ from, to });
  }

  /**
   * One event by id.
   *
   * The event inspector edits fields in place, so it needs the full stored row —
   * `CalendarEntry` is a view projection and cannot represent every field. The
   * repository already had `get()`; this only exposes it.
   */
  async get(id: EventId): Promise<CalendarEvent | null> {
    return this.deps.uow.events.get(id);
  }

  async create(input: NewEvent): Promise<CalendarEvent> {
    const title = input.title.trim();
    if (title.length === 0) throw new EventValidationError('日程标题不能为空');
    if (Date.parse(input.endAt) <= Date.parse(input.startAt)) {
      throw new EventValidationError('结束时间必须晚于开始时间');
    }
    return this.deps.uow.events.create({ ...input, title }, this.deps.clock.now());
  }

  async update(
    id: EventId,
    patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>,
  ): Promise<CalendarEvent> {
    const current = await this.deps.uow.events.get(id);
    if (!current) throw new EventValidationError(`日程不存在: ${id}`);
    const startAt = patch.startAt ?? current.startAt;
    const endAt = patch.endAt ?? current.endAt;
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new EventValidationError('结束时间必须晚于开始时间');
    }
    return this.deps.uow.events.update(id, patch, this.deps.clock.now());
  }

  async reschedule(id: EventId, startAt: Instant, endAt: Instant): Promise<CalendarEvent> {
    return this.update(id, { startAt, endAt });
  }

  async remove(id: EventId): Promise<void> {
    const current = await this.deps.uow.events.get(id);
    if (!current) throw new EventValidationError(`日程不存在: ${id}`);
    await this.deps.uow.events.remove(id);
  }
}

export class ListValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListValidationError';
  }
}

export class ListNotEmptyError extends Error {
  constructor(
    readonly id: ListId,
    readonly taskCount: number,
  ) {
    super(`清单仍有 ${taskCount} 个任务`);
    this.name = 'ListNotEmptyError';
  }
}

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}
