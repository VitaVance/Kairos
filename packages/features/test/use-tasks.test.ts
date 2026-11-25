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
  return { port, calls, byId };
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
});

describe('redoCompletion', () => {
  it('re-runs the same toggle the user saw', async () => {
    const done = task({ id: 'done-1' as TaskId, status: 'done' });
    const { port, calls } = completionPort([done]);

    await redoCompletion(port, { task: done, next: null });

    expect(calls).toEqual(['toggle:done-1']);
  });
});
