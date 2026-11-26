import { describe, expect, it } from 'vitest';
import type { Instant, Task, TaskId } from '@todolist/core';
import { optimisticToggle, redoCompletion, undoCompletion } from '../src/data/useTasks';
import type { CompletionPort } from '../src/data/useTasks';

const NOW = '2026-09-06T08:00:00.000Z' as Instant;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as TaskId,
    listId: 'inbox' as Task['listId'],
    title: '写周报',
    notes: '',
    status: 'open',
    important: true,
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

describe('optimisticToggle', () => {
  it('marks an open task done immediately without waiting for a write', () => {
    const next = optimisticToggle(task(), NOW);
    expect(next.status).toBe('done');
    expect(next.completedAt).toBe(NOW);
  });

  it('reopens a done task and clears completedAt', () => {
    const done = task({ status: 'done', completedAt: NOW });
    const next = optimisticToggle(done, NOW);
    expect(next.status).toBe('open');
    expect(next.completedAt).toBeNull();
  });

  it('is a pure overlay: the source task is untouched and identity is preserved', () => {
    const base = task();
    const next = optimisticToggle(base, NOW);
    expect(base.status).toBe('open');
    expect(base.completedAt).toBeNull();
    expect(next.id).toBe(base.id);
    expect(next.title).toBe(base.title);
    expect(next.recurrence).toBe(base.recurrence);
  });
});

describe('optimistic toggle contract', () => {
  it('reconciliation can be modelled as: overlay wins until the snapshot matches', () => {
    const base = task();
    const optimistic = optimisticToggle(base, NOW);
    // The overlay is dropped once the loaded row reports the same state, which
    // is what `useTasks` does to avoid flashing the old status on slow reloads.
    const reloaded = { ...base, status: 'done' as const, completedAt: NOW };
    expect(reloaded.status).toBe(optimistic.status);
    expect(reloaded.completedAt).toBe(optimistic.completedAt);
  });

  it('rollback is simply discarding the overlay and restoring the base row', () => {
    const base = task();
    const optimistic = optimisticToggle(base, NOW);
    expect(optimistic.status).toBe('done');
    // A failed write returns the base row unchanged — the pre-toggle status.
    expect({ ...base }.status).toBe('open');
    expect(base.completedAt).toBeNull();
  });
});

/**
 * A recording fake for the three writes undo/redo may issue. `toggleDone`
 * flips a status in place so the fake behaves like the service for the paths
 * these tests exercise (the real detach/repair semantics are proven in core).
 */
function completionPort(rows: Task[]) {
  const calls: string[] = [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  let spawned = 0;
  const port: CompletionPort = {
    async listAll() {
      return [...byId.values()];
    },
    async toggleDone(id: TaskId) {
      calls.push(`toggle:${id}`);
      const task = byId.get(id)!;
      const next: Task = { ...task, status: task.status === 'done' ? 'open' : 'done' };
      byId.set(id, next);
      return { task: next, next: null };
    },
    async remove(id: TaskId) {
      calls.push(`remove:${id}`);
      byId.delete(id);
    },
  };
  /**
   * Same surface, but a completion of a recurring row spawns a fresh open row
   * (new id every time), like the real `TaskService`. The two fakes are kept
   * apart so the in-place contract above stays provable on its own.
   */
  const detachingPort: CompletionPort = {
    async listAll() {
      return [...byId.values()];
    },
    async toggleDone(id: TaskId) {
      calls.push(`toggle:${id}`);
      const current = byId.get(id)!;
      const next: Task = { ...current, status: current.status === 'done' ? 'open' : 'done' };
      byId.set(id, next);
      if (next.status !== 'done' || next.recurrence === null) return { task: next, next: null };
      const row = task({ id: `spawn-${++spawned}` as TaskId, dueDate: '2026-09-18' as Task['dueDate'] });
      byId.set(row.id, row);
      return { task: next, next: row };
    },
    async remove(id: TaskId) {
      calls.push(`remove:${id}`);
      byId.delete(id);
    },
  };
  return { port, detachingPort, calls, byId };
}

describe('undoCompletion', () => {
  it('deletes the spawned occurrence and reopens the completed row', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done', completedAt: NOW });
    const spawned = task({ id: 'next-1' as TaskId });
    const { port, calls, byId } = completionPort([done, spawned]);

    await undoCompletion(port, { task: done, next: spawned });

    expect(calls).toEqual(['remove:next-1', 'toggle:done-1']);
    expect(byId.has('next-1' as TaskId)).toBe(false);
  });

  it('only reopens when the completion had no next occurrence', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const { port, calls } = completionPort([done]);

    await undoCompletion(port, { task: done, next: null });

    expect(calls).toEqual(['toggle:done-1']);
  });

  it('skips the delete when the user already removed the spawned row', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const spawned = task({ id: 'next-1' as TaskId });
    const { port, calls } = completionPort([done]);

    await undoCompletion(port, { task: done, next: spawned });

    expect(calls).toEqual(['toggle:done-1']);
  });

  it('leaves a spawned row the user has renamed or rescheduled', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const spawned = task({ id: 'next-1' as TaskId, title: '每周五：复盘一周' });
    const edited = { ...task({ id: 'next-1' as TaskId }), title: '复盘（新名字）' };
    const { port, calls, byId } = completionPort([done, edited]);

    await undoCompletion(port, { task: done, next: spawned });

    expect(calls).toEqual(['toggle:done-1']);
    expect(byId.has('next-1' as TaskId)).toBe(true);
  });

  it('leaves a spawned row whose time of day the user changed', async () => {
    // The detail panel edits `dueAt` in place; the date and title stay put, so
    // a title+date guard would delete the user's edit.
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const spawned = task({
      id: 'next-1' as TaskId,
      dueDate: '2026-09-18' as Task['dueDate'],
      dueAt: '2026-09-18T01:00:00.000Z' as Instant,
    });
    const edited = { ...spawned, dueAt: '2026-09-18T02:00:00.000Z' as Instant };
    const { port, calls, byId } = completionPort([done, edited]);

    await undoCompletion(port, { task: done, next: spawned });

    expect(calls).toEqual(['toggle:done-1']);
    expect(byId.get('next-1' as TaskId)).toBe(edited);
  });

  it('leaves a spawned row moved to another list or given notes', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const spawned = task({ id: 'next-1' as TaskId, important: true, urgent: true });
    for (const edit of [
      { listId: 'other' as Task['listId'] },
      { notes: '带上发票' },
      { important: false },
      { urgent: false },
      { duePeriod: 'evening' as const },
      { recurrence: { frequency: 'monthly' as const, interval: 1, monthDay: 9 } },
    ]) {
      const edited = { ...spawned, ...edit };
      const { port, calls } = completionPort([done, edited]);
      await undoCompletion(port, { task: done, next: spawned });
      expect(calls, JSON.stringify(edit)).toEqual(['toggle:done-1']);
    }
  });

  it('deletes the occurrence when only the rule serialization differs', async () => {
    // Two rules that mean the same thing must compare equal, or a harmless
    // re-save of the rule would block the delete forever.
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const spawned = task({
      id: 'next-1' as TaskId,
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [4 as const, 1 as const] },
    });
    const resaved = {
      ...spawned,
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [1 as const, 4 as const] },
    };
    const { port, calls } = completionPort([done, resaved]);

    await undoCompletion(port, { task: done, next: spawned });

    expect(calls).toEqual(['remove:next-1', 'toggle:done-1']);
  });
});

describe('redoCompletion', () => {
  it('re-runs the same toggle the user saw', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const { port, calls } = completionPort([done]);

    await redoCompletion(port, { task: done, next: null });

    expect(calls).toEqual(['toggle:done-1']);
  });

  it('returns the write it performed, with any newly spawned row', async () => {
    // A redo runs from the state undo left behind: the row is open again.
    const reopened = task({
      id: 'done-1' as TaskId,
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [4] },
    });
    const { detachingPort } = completionPort([reopened]);

    const replayed = await redoCompletion(detachingPort, { task: reopened, next: null });

    expect(replayed.task.status).toBe('done');
    expect(replayed.next?.id).toBe('spawn-1');
  });
});

describe('undo/redo round trip on a recurring completion', () => {
  it('undo → redo → undo deletes the row the redo spawned, leaving one open copy', async () => {
    const original = task({
      id: 'task-1' as TaskId,
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [4] },
    });
    const { detachingPort, byId } = completionPort([original]);
    const open = () => [...byId.values()].filter((row) => row.status === 'open');

    // The user's click: the completed row, plus the occurrence it spawned.
    const first = await detachingPort.toggleDone(original.id);
    expect(open().map((row) => row.id)).toEqual(['spawn-1']);

    // Undo → redo → undo. Each step must hand back what *it* wrote; replaying
    // the original `first` on the second undo would look for `spawn-1` (already
    // deleted) and leave the redo's `spawn-2` behind as a second open copy.
    let recorded = first;
    recorded = await undoCompletion(detachingPort, recorded);
    expect(open().map((row) => row.id)).toEqual(['task-1']);

    recorded = await redoCompletion(detachingPort, recorded);
    expect(recorded.next?.id).toBe('spawn-2');
    expect(open().map((row) => row.id)).toEqual(['spawn-2']);

    recorded = await undoCompletion(detachingPort, recorded);
    // Back to exactly the state before the click: one open row, no leftovers.
    expect([...byId.keys()]).toEqual(['task-1']);
    expect(open().map((row) => row.id)).toEqual(['task-1']);
  });
});
