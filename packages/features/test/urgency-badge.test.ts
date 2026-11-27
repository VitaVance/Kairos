import { describe, expect, it } from 'vitest';
import { urgencyBadge } from '../src/quadrant/urgency-badge';

/**
 * ADR 0007 决策 5：行上要能区分「时间推的」和「我标的」。
 * 两者在数据上都是紧急，对用户的意义不同。
 */
describe('urgencyBadge', () => {
  const open = { urgent: false, status: 'open' as const };

  it('shows the clock badge when the task is overdue', () => {
    expect(urgencyBadge(open, 'urgent', 0)).toEqual({ kind: 'clock', label: 'overdue' });
  });

  it('shows the clock badge even if the user also flagged it', () => {
    // The row is in an overdue state; that is what a reader needs to know first.
    expect(urgencyBadge({ urgent: true, status: 'open' }, 'urgent', 0)).toEqual({
      kind: 'clock',
      label: 'overdue',
    });
  });

  it('shows the user badge for a flagged task that is not overdue', () => {
    expect(urgencyBadge({ urgent: true, status: 'open' }, 'far', 10)).toEqual({
      kind: 'user',
      label: 'whyUser',
    });
  });

  it('shows a due badge inside 24 hours instead of moving the card', () => {
    // `near` must not enter Q1 (ADR 0004 §4), so the row carries the signal.
    expect(urgencyBadge(open, 'near', 1)).toEqual({ kind: 'due', label: 'dueTomorrow' });
    expect(urgencyBadge(open, 'near', 0)).toEqual({ kind: 'due', label: 'dueSoon' });
  });

  it('shows nothing for soon/far/none', () => {
    expect(urgencyBadge(open, 'soon', 3)).toEqual({ kind: 'none' });
    expect(urgencyBadge(open, 'far', 9)).toEqual({ kind: 'none' });
    expect(urgencyBadge(open, 'none', null)).toEqual({ kind: 'none' });
  });

  it('shows nothing on a completed task', () => {
    expect(urgencyBadge({ urgent: true, status: 'done' }, 'urgent', 0)).toEqual({ kind: 'none' });
  });
});
