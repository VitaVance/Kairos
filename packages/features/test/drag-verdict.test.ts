import { describe, expect, it } from 'vitest';
import { dragVerdict } from '../src/quadrant/drag-verdict';

/**
 * ADR 0007 决策 3：过期的任务不能被拖出 urgent 列。
 *
 * 这不是权限判断，是语义判断 —— 用户能对一件已过期的事做两件事：
 * 做掉它，或给它一个新日期。他不能声明它"不紧急"。
 *
 * 判定只吃「是否因时间而紧急」，不吃用户的 urgent 布尔值：
 * 用户标的、且没到期的，拖走是他的权利。
 */
describe('dragVerdict', () => {
  it('refuses to move a task the clock pushed into urgent', () => {
    expect(dragVerdict(true)).toEqual({ allowed: false, reason: 'overdue' });
  });

  it('allows moving anything the clock has no opinion about', () => {
    // Covers: unflagged and not due, and flagged-but-not-overdue.
    // The flag is the user's own word; taking it back is a change of mind.
    expect(dragVerdict(false)).toEqual({ allowed: true });
  });
});
