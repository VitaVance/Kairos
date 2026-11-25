import { describe, expect, it } from 'vitest';
import type { Instant, ListId, Task, TaskId } from '@todolist/core';
import { i18n, initI18n } from '@todolist/ui';
import { describeListDeletionBlock, isRealListMove } from '../src/lists/ListSidebar';

// The catalog keys are asserted through the real runtime, so a missing `lists`
// namespace or a typo in a key fails here rather than rendering a raw key.
initI18n('en');
const enT = i18n.getFixedT('en', 'lists');

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
    expect(describeListDeletionBlock(enT, 'Work', 0, 0)).toBeNull();
  });

  it('reports open-only counts', () => {
    const message = describeListDeletionBlock(enT, 'Work', 2, 2);
    expect(message).toContain('still has 2 open tasks');
  });

  it('reports a completed-only list as still blocked', () => {
    const message = describeListDeletionBlock(enT, 'Work', 0, 3);
    expect(message).toContain('still has 3 completed tasks');
  });

  it('breaks out open vs done when both are present, and says how to proceed', () => {
    const message = describeListDeletionBlock(enT, 'Work', 1, 4) ?? '';
    expect(message).toContain('still has 4 tasks (1 open)');
    expect(message).toContain("aren't deleted with the list");
    expect(message).toContain('drag them to another list');
  });
});

describe('describeListDeletionBlock (zh-CN)', () => {
  it('renders the Chinese copy when the runtime is switched', () => {
    const zhT = i18n.getFixedT('zh-CN', 'lists');
    expect(describeListDeletionBlock(zhT, '工作', 1, 4) ?? '').toContain(
      '「工作」下还有 4 个任务（其中 1 个未完成）',
    );
  });
});
