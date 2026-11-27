import type { Instant, Task } from '@todolist/core';

/**
 * 今天接下来最近的一次「某件事将因过期而变紧急」。
 *
 * 为什么需要这个：卡片移动只有在用户盯着看的那一秒才看得见。一个人早上
 * 打开板子，看到的是此刻的状态；他离开十分钟回来，某件事已经悄悄从 Q2
 * 掉进 Q1，而他不会注意到。提前说出来，比事后补一个动画有用。
 *
 * 返回 `null` 有两种情况，都是正常的：今天没有会过期的事，或者已经全都过期了
 * （那时它们已经在 Q1 里，再"预告"没有意义）。
 *
 * 形状上只要求 `status`，不要求整条 `Task` —— 调用方传什么任务都行，
 * 测试也不必伪造一个完整的 Task。
 */
export interface NextIntoQ1<T> {
  task: T;
  /** 它将在这一刻变为紧急。 */
  at: Instant;
}

export function nextIntoQ1<T extends Pick<Task, 'status'>>(
  tasks: readonly T[],
  deadlineOf: (task: T) => Instant | null,
  now: Instant,
): NextIntoQ1<T> | null {
  const nowMs = Date.parse(now);
  let best: NextIntoQ1<T> | null = null;
  let bestMs = Number.POSITIVE_INFINITY;

  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const at = deadlineOf(task);
    if (at === null) continue;
    const atMs = Date.parse(at);
    // Strictly in the future: an already-overdue task is not a prediction,
    // it is a current fact, and it is already sitting in the urgent column.
    if (!Number.isFinite(atMs) || atMs <= nowMs) continue;
    if (atMs < bestMs) {
      bestMs = atMs;
      best = { task, at };
    }
  }
  return best;
}
