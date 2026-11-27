import type { Task, Urgency } from '@todolist/core';

/**
 * Which urgency badge a row should show, if any.
 *
 * ADR 0007 决策 5：行上必须能区分「我决定的」和「时间决定的」。
 *
 * 这两件事在数据上都是"紧急"，但对用户的意义完全不同：
 *
 *   - 用户标的  → 他昨天决定这件事要紧。想改主意，拖走就行。
 *   - 时间推的  → 他没有做任何决定，是日期到了。拖不走，只能做或改期。
 *
 * 如果都画成同一个红色的「紧急」，用户会以为系统在替他说什么，而实际上
 * 有一半是他自己说的。
 */
export type UrgencyBadge =
  | { kind: 'none' }
  | { kind: 'user'; label: 'whyUser' }
  | { kind: 'clock'; label: 'overdue' }
  | { kind: 'due'; label: 'dueSoon' | 'dueTomorrow' };

export function urgencyBadge(
  task: Pick<Task, 'urgent' | 'status'>,
  urgency: Urgency,
  daysUntilDue: number | null,
): UrgencyBadge {
  if (task.status === 'done') return { kind: 'none' };

  // The clock's verdict wins the "overdue" wording, because that is the state
  // the row is actually in. A user flag on an overdue task is still shown —
  // as the *user's* badge — only when the clock has nothing to say.
  if (urgency === 'urgent') return { kind: 'clock', label: 'overdue' };
  if (task.urgent) return { kind: 'user', label: 'whyUser' };

  // `near` deliberately does not enter Q1 (ADR 0004 §4 keeps Q1 small), so the
  // urgency has to be legible from the row instead of from the card it sits in.
  if (urgency === 'near') {
    return daysUntilDue === 0
      ? { kind: 'due', label: 'dueSoon' }
      : { kind: 'due', label: 'dueTomorrow' };
  }
  return { kind: 'none' };
}
