import { describe, expect, it } from 'vitest';
import type { Instant } from '@todolist/core';
import { nextIntoQ1 } from '../src/quadrant/next-into-q1';

/**
 * 「下一件进 Q1」是这一版唯一一个"预告"。
 *
 * 卡片移动只有在用户盯着的那一刻才看得见。他离开十分钟回来，某件事已经
 * 悄悄从 Q2 掉进 Q1 —— 提前说出来比事后补动画有用。
 */
describe('nextIntoQ1', () => {
  const now = '2026-11-26T14:20:00.000Z' as Instant;
  const i = (t: string) => t as Instant;

  const task = (
    id: string,
    dueAt: Instant | null,
    status: 'open' | 'done' = 'open',
  ): { id: string; status: 'open' | 'done'; dueAt: Instant | null } => ({
    id,
    status,
    dueAt,
  });

  it('picks the nearest future deadline', () => {
    const tasks = [task('a', i('2026-11-26T18:00:00.000Z')), task('b', i('2026-11-26T16:00:00.000Z'))];
    const r = nextIntoQ1(tasks, (t) => t.dueAt, now);
    expect(r?.task.id).toBe('b');
    expect(r?.at).toBe('2026-11-26T16:00:00.000Z');
  });

  it('ignores tasks that are already overdue', () => {
    // An overdue task is not a prediction — it is a current fact, and it is
    // already in the urgent column.
    const tasks = [task('late', i('2026-11-25T10:00:00.000Z'))];
    expect(nextIntoQ1(tasks, (t) => t.dueAt, now)).toBeNull();
  });

  it('ignores the deadline exactly at `now`', () => {
    expect(nextIntoQ1([task('edge', now)], (t) => t.dueAt, now)).toBeNull();
  });

  it('ignores completed tasks', () => {
    expect(
      nextIntoQ1([task('done', i('2026-11-26T16:00:00.000Z'), 'done')], (t) => t.dueAt, now),
    ).toBeNull();
  });

  it('ignores tasks with no deadline', () => {
    expect(nextIntoQ1([task('inbox', null)], (t) => t.dueAt, now)).toBeNull();
  });

  it('returns null when there is nothing to predict', () => {
    const none: ReturnType<typeof task>[] = [];
    expect(nextIntoQ1(none, (t) => t.dueAt, now)).toBeNull();
  });

  it('uses the caller deadline, so day and period precision work too', () => {
    // A `day` task's own `dueAt` is the fabricated local midnight; its real
    // deadline is the end of that day. The caller supplies that boundary.
    const tasks = [task('day', i('2026-11-26T00:00:00.000Z'))];
    const r = nextIntoQ1(tasks, () => i('2026-11-27T00:00:00.000Z'), now);
    expect(r?.task.id).toBe('day');
    expect(r?.at).toBe('2026-11-27T00:00:00.000Z');
  });
});
