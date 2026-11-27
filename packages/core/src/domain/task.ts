import type { DuePeriod, Instant, LocalDate, Quadrant, Task } from './types.js';
import { endOfDay, instantAtLocal } from '../shared/date.js';

const DAY_MS = 86_400_000;

/**
 * 任务当前所处的象限 —— 派生值，从不落库。
 *
 * 同一个函数回答两个问题，可选的时钟就是把它们分开的那条线。
 * 不传 `now` 时答「用户把它放在哪」：只看两个布尔值，别的不看。
 * 传了 `now` 时答「它此刻算什么」：一件过期的事不管用户有没有勾，
 * 一律算紧急（ADR 0007 §1）。
 *
 * 两种读法下 `near` 都刻意不进 Q1：矩阵只有在 Q1 够小时才有用，
 * 「明天到期」是行上的信号，不是挪卡片进 Q1 的理由（ADR 0007 §2）。
 */
export function quadrantOf(task: Pick<Task, 'important' | 'urgent'>): Quadrant;
export function quadrantOf(task: Task, now?: Instant): Quadrant;
export function quadrantOf(
  task: Pick<Task, 'important' | 'urgent'> | Task,
  now?: Instant,
): Quadrant {
  // `'status' in task` 与上面的重载一一对应：只有完整的 Task 才回答得了
  // 时钟问题，光有一对布尔值不能假装自己答过了。
  const urgent =
    task.urgent ||
    (now !== undefined && 'status' in task && urgencyOf(task, now) === 'urgent');
  if (task.important && urgent) return 'urgent-important';
  if (task.important) return 'not-urgent-important';
  if (urgent) return 'urgent-not-important';
  return 'unimportant';
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  'urgent-important': '重要且紧急',
  'not-urgent-important': '重要不紧急',
  'urgent-not-important': '不重要但紧急',
  unimportant: '不重要不紧急',
};

/**
 * How precisely a task is scheduled.
 *
 * This is derived, never stored: the three scheduling fields already determine
 * it, and persisting a second answer to the same question is how the two get
 * out of sync (the same reasoning that keeps the quadrant out of the database;
 * see docs/adr/0003-local-first-persistence.md). Any code that needs to tell
 * "a whole day" from "a half-day bucket" must ask this function instead of
 * reading `allDay` — `allDay` is true for both.
 */
export type DuePrecision = 'none' | 'day' | 'period' | 'time';

export function duePrecisionOf(
  task: Pick<Task, 'dueDate' | 'dueAt' | 'allDay' | 'duePeriod'>,
): DuePrecision {
  if (task.dueDate === null) return 'none';
  if (!task.allDay) return 'time';
  return task.duePeriod === null ? 'day' : 'period';
}

/**
 * Exclusive end of a half-day bucket on `date`.
 *
 * Boundaries are the start of the next bucket, matching the Todoist wording
 * the product borrowed ("in the morning" = before noon): morning ends at
 * 12:00, afternoon at 19:00, evening at the start of the next day. Fixed
 * constants on purpose — there is no user setting for these; see the design
 * doc §5.7.
 */
export function endOfPeriod(date: LocalDate, period: DuePeriod): Instant {
  switch (period) {
    case 'morning':
      return instantAtLocal(date, '12:00');
    case 'afternoon':
      return instantAtLocal(date, '19:00');
    case 'evening':
      return endOfDay(date);
  }
}

/**
 * True when a task is past due and still open.
 *
 * The comparison is per precision because `dueAt` is not the task's deadline
 * for day and period tasks — it is the (fabricated) local midnight that keeps
 * them on the calendar. Comparing `now` to it would mark a "today" task overdue
 * at 00:00:01 of its own day, and a "this morning" task overdue before the
 * morning ends.
 *
 *   - `time`   — strictly after `dueAt`. At the exact instant it is due the
 *                task is not yet late, which is also the pre-existing rule.
 *   - `day`    — at or after the next local midnight (`endOfDay` is exclusive).
 *   - `period` — at or after `endOfPeriod()`.
 */
export function isOverdue(task: Task, now: Instant): boolean {
  if (task.status === 'done' || task.dueAt === null) return false;

  const nowMs = Date.parse(now);
  switch (duePrecisionOf(task)) {
    case 'time':
      return Date.parse(task.dueAt) < nowMs;
    case 'day':
      // A row with no dueDate but a dueAt predates the scheduling invariants;
      // fall back to instant comparison rather than calling it never-overdue.
      return Date.parse(task.dueDate === null ? task.dueAt : endOfDay(task.dueDate)) <= nowMs;
    case 'period':
      return (
        Date.parse(
          task.dueDate === null || task.duePeriod === null
            ? task.dueAt
            : endOfPeriod(task.dueDate, task.duePeriod),
        ) <= nowMs
      );
    case 'none':
      return false;
  }
}

/**
 * 任务离截止还有多久，五级读数。
 *
 * 每一级回答的都是「还剩多少时间」，而不是「用户挑了哪个粒度」。
 * 单看 `dueAt` 答不了：day / period 任务的 `dueAt` 是伪造的本地午夜
 * （见 `isOverdue`），拿它减 `now` 会把「今天到期」的事在 00:00:01 就
 * 判成迟到。所以剩余时间一律从 `isOverdue` 用的那条边界量起 ——
 * day 用 `endOfDay`，period 用 `endOfPeriod`，time 用 `dueAt` 本身 ——
 * 读数与过期标记因此永远对得上，不会各算一套（`calendar.ts:58` 警告的
 * 正是那个「两个可能打架」的地方）。
 *
 * 阈值取闭区间上界（≤ 24h 算 `near`），与 `design/v2/data.js` 已用
 * 16 条断言验证过的阶梯一致；随着 `now` 前进只会收紧、不会跳变或漏档，
 * 所以整条刻度是单调的。
 *
 * 已完成的任务不管日期都读 `none`：它不是还要去处理的东西。
 */
export type Urgency = 'none' | 'far' | 'soon' | 'near' | 'urgent';

const HOUR_MS = 3_600_000;
const NEAR_WINDOW_MS = 24 * HOUR_MS;
const SOON_WINDOW_MS = 3 * 24 * HOUR_MS;
const FAR_WINDOW_MS = 14 * 24 * HOUR_MS;

/**
 * 任务调度窗口结束的那个瞬间（毫秒时间戳）。
 *
 * 逐条镜像 `isOverdue` 的边界选择（day → `endOfDay`，period → `endOfPeriod`，
 * time → `dueAt`）。特意在这里重写而没让 `isOverdue` 反过来调它，是为了
 * 不动它那套 `<` / `<=` 比较 —— 这就是同一条边界被复用，不是第二套。
 * 前提：`dueAt` 非空。
 */
function deadlineMs(task: Task): number {
  switch (duePrecisionOf(task)) {
    case 'time':
      return Date.parse(task.dueAt!);
    case 'period':
      return Date.parse(
        task.dueDate === null || task.duePeriod === null
          ? task.dueAt!
          : endOfPeriod(task.dueDate, task.duePeriod),
      );
    default:
      // day，外加「有 dueAt 却没 dueDate」的老数据：退回存下来的瞬间。
      return Date.parse(task.dueDate === null ? task.dueAt! : endOfDay(task.dueDate));
  }
}

export function urgencyOf(task: Task, now: Instant): Urgency {
  // 没有日期（精度 `none`）就是「读不出时间」，和已完成一样。
  // 没排期的行可能残留一个 dueAt，不能凭它编出一个截止时间。
  if (task.status === 'done' || duePrecisionOf(task) === 'none') return 'none';

  // `urgent` 这一级直接问 `isOverdue` 而不是自己再比一遍：它掌握着每种
  // 精度各自的 `<` / `<=` 拆分，边界必须精确到毫秒才对得上，否则板上和
  // 行上的提醒会互相打架。
  if (isOverdue(task, now)) return 'urgent';

  const left = deadlineMs(task) - Date.parse(now);
  if (left <= NEAR_WINDOW_MS) return 'near';
  if (left <= SOON_WINDOW_MS) return 'soon';
  if (left <= FAR_WINDOW_MS) return 'far';
  return 'none';
}

/**
 * 这件任务是否因时间而紧急（而非用户手标）。
 *
 * 这是拖拽判定的唯一依据（ADR 0007 §3）：把这种任务拖到别的象限要被拒绝 ——
 * 一件已经过期的事不能被声明为「不紧急」，用户真正能做的只有做掉它，
 * 或者给它一个新日期。
 */
export function isUrgentByClock(task: Task, now: Instant): boolean {
  return urgencyOf(task, now) === 'urgent' && !task.urgent;
}

/** Days between a local date and "today" (negative = in the past). */
export function daysFromToday(date: LocalDate, today: LocalDate): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/**
 * Display order for the half-day buckets. `null` (a whole day, or a task with
 * an exact time) sorts last, so an unspecified bucket never jumps ahead of a
 * chosen one that falls on the same day.
 */
const PERIOD_RANK: Record<DuePeriod, number> = { morning: 0, afternoon: 1, evening: 2 };
const NO_PERIOD_RANK = 3;

/**
 * Stable ordering used by every list surface: open before done, then by
 * due date, then by half-day bucket, then by creation. Pure so views can rely
 * on one definition.
 *
 * The period tiebreak only applies when the instants are equal — which is the
 * normal case for all-day and period tasks, since both store local midnight.
 * Time-precision tasks have distinct instants and keep their wall-clock order.
 * `duePeriod` is `null` for time tasks, so they rank last within a tie, which
 * is harmless: only an identical instant can tie with them.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  const aDue = a.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.dueAt);
  const bDue = b.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;
  const aPeriod = a.duePeriod === null ? NO_PERIOD_RANK : PERIOD_RANK[a.duePeriod];
  const bPeriod = b.duePeriod === null ? NO_PERIOD_RANK : PERIOD_RANK[b.duePeriod];
  if (aPeriod !== bPeriod) return aPeriod - bPeriod;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}
