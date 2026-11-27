/**
 * Why a drag of this task is allowed or refused.
 *
 * ADR 0007 决策 3：ADR 0004 没有解决的一处矛盾。
 *
 * 一旦「过期」由时钟派生，把一件过期的事拖出 Q1 就会立刻看起来失败 ——
 * 它仍然过期，所以立刻又被算回 Q1。三个选项里我们选了最诚实的那个：
 *
 *   - 时钟赢，拖动无效         → 一个不响应的控件
 *   - 清掉 urgent 但它仍在 Q1  → 撒谎
 *   - 时钟赢，拒绝并说明原因   → 采纳
 *
 * 拒绝的理由不是"权限"，是语义：用户不能声明一件已经过期的事"不紧急"。
 * 他能做的只有两件——做掉它，或者给它一个新日期。
 *
 * 反过来，用户自己标了紧急、但**并没有过期**的任务，可以自由拖走：
 * 那是他的判断，时钟没有意见。
 *
 * 所以判定只依赖「时钟怎么说」，不依赖用户标的那个布尔值 ——
 * `isUrgentByClock` 的定义里已经排除了用户手标的情况。
 */
export type DragVerdict = { allowed: true } | { allowed: false; reason: 'overdue' };

export function dragVerdict(isUrgentByClock: boolean): DragVerdict {
  // Only the clock may veto. A user flag is the user's own word, so moving it
  // out of the urgent column is a legitimate change of mind.
  return isUrgentByClock ? { allowed: false, reason: 'overdue' } : { allowed: true };
}
