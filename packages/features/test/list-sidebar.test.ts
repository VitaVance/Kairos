import { describe, expect, it } from 'vitest';
import type { Instant, ListId, Task, TaskId } from '@todolist/core';
import { describeListDeletionBlock, isRealListMove } from '../src/lists/ListSidebar';

const NOW = '2026-09-06T08:00:00.000Z' as Instant;

function task(id: string, listId: string, status: Task['status'] = 'open'): Task {
  return {
    id: id as TaskId,
    listId: listId as ListId,
    title: `任务 ${id}`,
    notes: '',
    status,
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
  };
}

describe('isRealListMove', () => {
  const tasks = [task('T1', 'L1')];

  it('is false when the task is already in the target list', () => {
    expect(isRealListMove(tasks, 'T1' as TaskId, 'L1' as ListId)).toBe(false);
  });

  it('is true when the task belongs to another list', () => {
    expect(isRealListMove(tasks, 'T1' as TaskId, 'L2' as ListId)).toBe(true);
  });

  it('is false for an unknown task id', () => {
    expect(isRealListMove(tasks, 'ghost' as TaskId, 'L2' as ListId)).toBe(false);
  });
});

describe('describeListDeletionBlock', () => {
  it('returns null for an empty list', () => {
    expect(describeListDeletionBlock('工作', 0, 0)).toBeNull();
  });

  it('reports open-only counts', () => {
    const message = describeListDeletionBlock('工作', 2, 2);
    expect(message).toContain('还有 2 个未完成任务');
  });

  it('reports a completed-only list as still blocked', () => {
    const message = describeListDeletionBlock('工作', 0, 3);
    expect(message).toContain('还有 3 个已完成任务');
  });

  it('breaks out open vs done when both are present, and says how to proceed', () => {
    const message = describeListDeletionBlock('工作', 1, 4) ?? '';
    expect(message).toContain('4 个任务（其中 1 个未完成）');
    expect(message).toContain('任务不会被一并删除');
    expect(message).toContain('拖到其他清单');
  });
});
