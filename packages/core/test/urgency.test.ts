import { describe, expect, it } from 'vitest';
import {
  endOfDay,
  endOfPeriod,
  instantAtLocal,
  isOverdue,
  isUrgentByClock,
  quadrantOf,
  startOfDay,
  urgencyOf,
} from '../src/index.js';
import type { Instant, LocalDate, Task, Urgency } from '../src/index.js';

/**
 * ADR 0007 §2：紧急是时钟读数，不是存下来的标记。这里的测试走遍每一级，
 * 关键是在每条边界的前后各一秒各测一次。系统时区随机器而变，所以所有瞬间
 * 都经由生产代码用的同一批 helper 构造 —— 写死一个午夜只在 UTC+0 才过。
 */

const DATE = '2026-09-06' as LocalDate;
const T0 = startOfDay(DATE);

/** `base` 平移 `ms`，依旧走应用唯一的瞬间格式。 */
function plus(base: Instant, ms: number): Instant {
  return new Date(Date.parse(base) + ms).toISOString() as Instant;
}

const SECOND = 1_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    listId: 'list-1' as Task['listId'],
    title: '任务',
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
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const dayTask = (o: Partial<Task> = {}) =>
  task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: null, ...o });

const periodTask = (period: 'morning' | 'afternoon' | 'evening', o: Partial<Task> = {}) =>
  task({ dueDate: DATE, dueAt: startOfDay(DATE), allDay: true, duePeriod: period, ...o });

const timeTask = (time: string, o: Partial<Task> = {}) =>
  task({ dueDate: DATE, dueAt: instantAtLocal(DATE, time), allDay: false, ...o });

/** 单调性检查用的序号：时钟前进只允许收紧，不允许倒退。 */
const RANK: Record<Urgency, number> = { none: 0, far: 1, soon: 2, near: 3, urgent: 4 };

describe('urgencyOf —— 五级各自可达', () => {
  // 从 isOverdue 用的同一条边界量起：day 任务是次日本地午夜。所有采样都留在
  // 当天这一侧，这样 `none` 和 `far` 才是真实的读数。
  const deadline = endOfDay(DATE);

  it('reads none / far / soon / near / urgent as the clock closes in', () => {
    expect(urgencyOf(dayTask(), plus(deadline, -15 * DAY))).toBe('none');
    expect(urgencyOf(dayTask(), plus(deadline, -7 * DAY))).toBe('far');
    expect(urgencyOf(dayTask(), plus(deadline, -2 * DAY))).toBe('soon');
    expect(urgencyOf(dayTask(), plus(deadline, -HOUR))).toBe('near');
    expect(urgencyOf(dayTask(), plus(deadline, SECOND))).toBe('urgent');
  });

  it('is monotone: advancing the clock never loosens the rung', () => {
    const probes = [
      -15 * DAY,
      -14 * DAY,
      -14 * DAY + SECOND,
      -10 * DAY,
      -3 * DAY,
      -3 * DAY + SECOND,
      -DAY,
      -DAY + SECOND,
      -HOUR,
      -SECOND,
      0,
      SECOND,
    ].map((offset) => urgencyOf(dayTask(), plus(deadline, offset)));

    for (let i = 1; i < probes.length; i++) {
      expect(RANK[probes[i]!]).toBeGreaterThanOrEqual(RANK[probes[i - 1]!]);
    }
    // The ladder is not flat: it actually traverses every rung on the way in.
    expect(new Set(probes)).toEqual(new Set<Urgency>(['none', 'far', 'soon', 'near', 'urgent']));
  });

  it('is none for a done task and for anything without a date', () => {
    expect(urgencyOf(dayTask({ status: 'done' }), plus(deadline, SECOND))).toBe('none');
    expect(urgencyOf(task(), T0)).toBe('none');
    // A stray dueAt on a dateless row is "unscheduled", not a deadline
    // (same rule duePrecisionOf enforces).
    expect(urgencyOf(task({ dueAt: T0 }), plus(T0, HOUR))).toBe('none');
  });
});

describe('urgencyOf — each precision uses isOverdue’s boundary', () => {
  it('day: flips one second either side of next midnight', () => {
    const boundary = endOfDay(DATE);
    expect(urgencyOf(dayTask(), plus(boundary, -SECOND))).toBe('near');
    expect(urgencyOf(dayTask(), boundary)).toBe('urgent');
  });

  it('period: flips on endOfPeriod, not on the fabricated midnight', () => {
    const boundary = endOfPeriod(DATE, 'morning'); // 12:00
    // At 00:00:01 of its own day the task is nowhere near late.
    expect(urgencyOf(periodTask('morning'), plus(startOfDay(DATE), SECOND))).toBe('near');
    expect(urgencyOf(periodTask('morning'), plus(boundary, -SECOND))).toBe('near');
    expect(urgencyOf(periodTask('morning'), boundary)).toBe('urgent');
  });

  it('time: overdue strictly after dueAt, not at it', () => {
    const due = instantAtLocal(DATE, '14:30');
    expect(urgencyOf(timeTask('14:30'), plus(due, -SECOND))).toBe('near');
    expect(urgencyOf(timeTask('14:30'), due)).toBe('near');
    expect(urgencyOf(timeTask('14:30'), plus(due, SECOND))).toBe('urgent');
  });

  it('agrees with isOverdue on the urgent rung for every precision', () => {
    const cases: Task[] = [dayTask(), periodTask('afternoon'), timeTask('09:00')];
    const probes = [
      plus(startOfDay(DATE), -DAY),
      startOfDay(DATE),
      instantAtLocal(DATE, '09:00'),
      instantAtLocal(DATE, '19:00'),
      endOfDay(DATE),
      plus(endOfDay(DATE), DAY),
    ];
    for (const t of cases) {
      for (const now of probes) {
        expect(urgencyOf(t, now) === 'urgent').toBe(isOverdue(t, now));
      }
    }
  });
});

describe('quadrantOf — clock-optional', () => {
  it('without now it is exactly the old two-flag reading', () => {
    // Regression guard: existing call sites (list filtering, drag targets) ask
    // "where did the user put it" and must not start seeing an overdue task
    // in Q1 just because the calendar moved.
    const overdue = dayTask({ important: false, urgent: false });
    const farFuture = dayTask({ dueDate: '2099-01-01' as LocalDate });

    expect(quadrantOf({ important: true, urgent: true })).toBe('urgent-important');
    expect(quadrantOf({ important: true, urgent: false })).toBe('not-urgent-important');
    expect(quadrantOf({ important: false, urgent: true })).toBe('urgent-not-important');
    expect(quadrantOf({ important: false, urgent: false })).toBe('unimportant');
    expect(quadrantOf(overdue)).toBe('unimportant');
    expect(quadrantOf(farFuture)).toBe('unimportant');
  });

  it('with now, an overdue unflagged task enters urgent-not-important', () => {
    const overdue = dayTask({ important: false, urgent: false });
    expect(quadrantOf(overdue, plus(endOfDay(DATE), SECOND))).toBe('urgent-not-important');
  });

  it('with now, an important overdue task enters urgent-important', () => {
    const overdue = dayTask({ important: true, urgent: false });
    expect(quadrantOf(overdue, plus(endOfDay(DATE), SECOND))).toBe('urgent-important');
  });

  it('with now, a task due within 24h is still not in a urgent quadrant', () => {
    const soon = dayTask({ important: true, urgent: false });
    const withinADay = plus(endOfDay(DATE), -HOUR);
    expect(urgencyOf(soon, withinADay)).toBe('near');
    expect(quadrantOf(soon, withinADay)).toBe('not-urgent-important');

    const unimportantSoon = dayTask({ important: false, urgent: false });
    expect(quadrantOf(unimportantSoon, withinADay)).toBe('unimportant');
  });
});

describe('isUrgentByClock — the drag-rule input', () => {
  it('is true only when time, not the user, put it in Q1', () => {
    const justOver = plus(endOfDay(DATE), SECOND);
    expect(isUrgentByClock(dayTask(), justOver)).toBe(true);
    // The user already flagged it: its urgency is theirs, not the clock's.
    expect(isUrgentByClock(dayTask({ urgent: true }), justOver)).toBe(false);
    // Not yet overdue: no clock urgency at all.
    expect(isUrgentByClock(dayTask(), plus(endOfDay(DATE), -SECOND))).toBe(false);
    // A user-flagged task that is not overdue is also not clock-driven.
    expect(isUrgentByClock(dayTask({ urgent: true }), plus(endOfDay(DATE), -HOUR))).toBe(false);
  });
});
