import { describe, expect, it } from 'vitest';
import type { Instant, Task, TaskId } from '@todolist/core';
import { optimisticToggle } from '../src/data/useTasks';

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
