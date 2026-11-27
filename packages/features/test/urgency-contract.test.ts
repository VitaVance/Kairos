import { describe, expect, it } from 'vitest';
import type { Instant, LocalDate, Task } from '@todolist/core';
import { isUrgentByClock, quadrantOf, urgencyOf } from '@todolist/core';
import { dragVerdict } from '../src/quadrant/drag-verdict';
import { urgencyBadge } from '../src/quadrant/urgency-badge';

/**
 * A 路写了领域层（urgencyOf / quadrantOf / isUrgentByClock），
 * C 路写了表现层（badge / dragVerdict）。两边是独立写的，
 * 这里验证它们对同一批事实给出**同一套判断**。
 *
 * 如果哪天有人改了其中一边，这组测试会先响。
 */
const NOW = '2026-11-26T14:20:00.000Z' as Instant;

const TASK_ID = 't1' as Task['id'];
const LIST_ID = 'l1' as Task['listId'];
const CREATED = '2026-11-01T00:00:00.000Z' as Instant;

function task(over: Partial<Task>): Task {
  return {
    id: TASK_ID,
    listId: LIST_ID,
    title: 't',
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
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}

/**
 * 一个「精确到时刻」的任务。三个字段必须一起给：
 * `duePrecisionOf` 先看 `dueDate` 是否为空，再看 `allDay` ——
 * 只填 `dueAt` 会被读成「没有排期」。
 */
function timed(at: string, over: Partial<Task> = {}): Task {
  return task({
    dueDate: at.slice(0, 10) as LocalDate,
    dueAt: at as Instant,
    allDay: false,
    ...over,
  });
}

describe('urgency: 领域层与表现层必须同意', () => {
  it('a task that went overdue moves to the urgent column by itself', () => {
    // 昨天 10:00 到期，没有人碰过 urgent。
    const t = timed('2026-11-25T10:00:00.000Z', { important: true });

    expect(urgencyOf(t, NOW)).toBe('urgent');
    expect(quadrantOf(t, NOW)).toBe('urgent-important');
    // 没有时钟时回到纯用户口径 —— 它停在 important 那一格。
    expect(quadrantOf(t)).toBe('not-urgent-important');

    // 表现层：行上说「已过期」，而且拖不走。
    expect(urgencyBadge(t, urgencyOf(t, NOW), -1)).toEqual({ kind: 'clock', label: 'overdue' });
    expect(dragVerdict(isUrgentByClock(t, NOW))).toEqual({ allowed: false, reason: 'overdue' });
  });

  it('a task due in 12 hours stays out of Q1 but says so on the row', () => {
    const t = timed('2026-11-27T02:00:00.000Z', { important: true });

    expect(urgencyOf(t, NOW)).toBe('near');
    // ADR 0004 §4：near 不进 Q1，矩阵要小。
    expect(quadrantOf(t, NOW)).toBe('not-urgent-important');

    // 信号放在行上，不靠移动卡片。
    expect(urgencyBadge(t, urgencyOf(t, NOW), 1)).toEqual({ kind: 'due', label: 'dueTomorrow' });
    // 没到期就拖得走。
    expect(dragVerdict(isUrgentByClock(t, NOW))).toEqual({ allowed: true });
  });

  it('a user-flagged task with no deadline keeps its flag and can be moved', () => {
    const t = task({ important: true, urgent: true });

    expect(urgencyOf(t, NOW)).toBe('none');
    // 用户标的，时钟没有意见 —— 它还是 Q1。
    expect(quadrantOf(t, NOW)).toBe('urgent-important');
    // 但它不是「时间推上来的」，所以行上说「你标的紧急」。
    expect(isUrgentByClock(t, NOW)).toBe(false);
    expect(urgencyBadge(t, urgencyOf(t, NOW), null)).toEqual({ kind: 'user', label: 'whyUser' });
    expect(dragVerdict(isUrgentByClock(t, NOW))).toEqual({ allowed: true });
  });

  it('a completed overdue task is not urgent any more', () => {
    const t = timed('2026-11-25T10:00:00.000Z', { status: 'done', important: true });

    expect(urgencyOf(t, NOW)).toBe('none');
    expect(quadrantOf(t, NOW)).toBe('not-urgent-important');
    expect(urgencyBadge(t, urgencyOf(t, NOW), -1)).toEqual({ kind: 'none' });
  });

  it('a far-future task is quiet everywhere', () => {
    // 12-04 距 11-26 是 8 天，落在 far（3–14 天）里；再远就是 none。
    const t = timed('2026-12-04T10:00:00.000Z');

    expect(urgencyOf(t, NOW)).toBe('far');
    expect(quadrantOf(t, NOW)).toBe('unimportant');
    expect(urgencyBadge(t, urgencyOf(t, NOW), 8)).toEqual({ kind: 'none' });
    expect(dragVerdict(isUrgentByClock(t, NOW))).toEqual({ allowed: true });
  });
});
