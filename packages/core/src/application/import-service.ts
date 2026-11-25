import type { CalendarEvent, Instant, Task, TaskList } from '../domain/types.js';
import type { Clock, UnitOfWork } from '../ports/repository.js';

export interface BackupPayload {
  readonly tasks: readonly Task[];
  readonly lists: readonly TaskList[];
  readonly events: readonly CalendarEvent[];
}

export type ImportMode = 'replace' | 'merge';

export interface ImportOutcome {
  readonly addedLists: number;
  readonly addedTasks: number;
  readonly addedEvents: number;
  readonly updated: number;
  readonly skipped: number;
}

/**
 * Restores a backup. This is the one place that writes records with their
 * original ids, so a restored file stays referentially intact (a task still
 * points at the list it belonged to).
 *
 * `replace` empties the store first; `merge` keeps what exists and only adds
 * ids that are missing. Both are idempotent for a given backup: importing the
 * same file twice in `merge` mode adds nothing the second time.
 */
export class ImportService {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async apply(payload: BackupPayload, mode: ImportMode): Promise<ImportOutcome> {
    // Validate BEFORE touching storage. A `replace` import wipes everything
    // first, so any referential problem found mid-restore would leave the user
    // with a half-empty database. Fail here instead, with nothing changed.
    this.validate(payload);

    const now = this.deps.clock.now();
    const outcome = { addedLists: 0, addedTasks: 0, addedEvents: 0, updated: 0, skipped: 0 };

    if (mode === 'replace') {
      await this.wipe();
    }

    // Merge semantics: an id that already exists is UPDATED when the backup's
    // copy is newer, and skipped when it is not. The confirm dialog promises
    // "用较新的数据覆盖同 id 的现有记录" — this is what makes that true.
    const isNewer = (incoming: { updatedAt: string }, current: { updatedAt: string }) =>
      Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt);

    // Lists first: tasks reference list ids.
    const listsById = new Map((await this.deps.uow.lists.list()).map((l) => [l.id, l]));
    for (const list of payload.lists) {
      const current = listsById.get(list.id);
      if (!current) {
        await this.deps.uow.lists.restore(list);
        outcome.addedLists += 1;
      } else if (isNewer(list, current)) {
        await this.deps.uow.lists.update(list.id, list, now);
        outcome.updated += 1;
      } else {
        outcome.skipped += 1;
      }
    }

    const tasksById = new Map((await this.deps.uow.tasks.list()).map((t) => [t.id, t]));
    for (const task of payload.tasks) {
      const current = tasksById.get(task.id);
      if (!current) {
        await this.deps.uow.tasks.restore(task);
        outcome.addedTasks += 1;
      } else if (isNewer(task, current)) {
        await this.deps.uow.tasks.update(task.id, task, now);
        outcome.updated += 1;
      } else {
        outcome.skipped += 1;
      }
    }

    // Events are keyed by an all-time window: restore must not miss old ones.
    const eventsById = new Map(
      (await this.deps.uow.events.list({
        from: '0000-01-01T00:00:00.000Z' as Instant,
        to: '9999-12-31T23:59:59.999Z' as Instant,
      })).map((e) => [e.id, e]),
    );
    for (const event of payload.events) {
      const current = eventsById.get(event.id);
      if (!current) {
        await this.deps.uow.events.restore(event);
        outcome.addedEvents += 1;
      } else if (isNewer(event, current)) {
        await this.deps.uow.events.update(event.id, event, now);
        outcome.updated += 1;
      } else {
        outcome.skipped += 1;
      }
    }

    return outcome;
  }

  /**
   * Rejects a payload that cannot be restored faithfully: duplicate ids,
   * tasks or events pointing at a list the file does not contain, and
   * inverted time ranges. Throws with every problem listed, before any write.
   */
  private validate(payload: BackupPayload): void {
    const problems: string[] = [];

    const listIds = new Set<string>();
    for (const list of payload.lists) {
      if (listIds.has(list.id)) problems.push(`清单 id 重复: ${list.id}`);
      listIds.add(list.id);
    }

    const taskIds = new Set<string>();
    for (const task of payload.tasks) {
      if (taskIds.has(task.id)) problems.push(`任务 id 重复: ${task.id}`);
      taskIds.add(task.id);
      if (task.listId && !listIds.has(task.listId)) {
        problems.push(`任务「${task.title}」指向不存在的清单 ${task.listId}`);
      }
    }

    const eventIds = new Set<string>();
    for (const event of payload.events) {
      if (eventIds.has(event.id)) problems.push(`日程 id 重复: ${event.id}`);
      eventIds.add(event.id);
      if (event.listId && !listIds.has(event.listId)) {
        problems.push(`日程「${event.title}」指向不存在的清单 ${event.listId}`);
      }
      if (Date.parse(event.endAt) <= Date.parse(event.startAt)) {
        problems.push(`日程「${event.title}」结束时间不晚于开始时间`);
      }
    }

    if (problems.length > 0) {
      throw new ImportValidationError(problems);
    }
  }

  private async wipe(): Promise<void> {
    const tasks = await this.deps.uow.tasks.list();
    for (const task of tasks) await this.deps.uow.tasks.remove(task.id);

    const events = await this.deps.uow.events.list({
      from: '0000-01-01T00:00:00.000Z' as Instant,
      to: '9999-12-31T23:59:59.999Z' as Instant,
    });
    for (const event of events) await this.deps.uow.events.remove(event.id);

    const lists = await this.deps.uow.lists.list();
    for (const list of lists) await this.deps.uow.lists.remove(list.id);
  }
}

export class ImportValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`备份文件无法导入：${problems.join('；')}`);
    this.name = 'ImportValidationError';
  }
}
