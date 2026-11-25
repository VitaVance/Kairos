import { describe, expect, it } from 'vitest';
import type { Instant, LocalDate } from '@todolist/core';
import type { ReminderItem } from '../src/reminders/ReminderScheduler.js';
import { reminderKey } from '../src/reminders/ReminderScheduler.js';
import { formatReminderNotification, selectUnannounced } from '../src/reminders/Notifier.js';

const T = (iso: string) => iso as Instant;

function item(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return {
    kind: 'task',
    id: 'task-1',
    title: '写周报',
    dueAt: T('2026-09-06T08:00:00.000Z'),
    minutesUntil: 0,
    allDay: false,
    period: null,
    reminderDate: null,
    ...overrides,
  };
}

describe('formatReminderNotification', () => {
  it('titles every toast with the app name and echoes the banner time wording', () => {
    expect(formatReminderNotification(item({ minutesUntil: 0 }))).toEqual({
      title: '清单',
      body: '任务：写周报 · 现在',
    });
    expect(formatReminderNotification(item({ minutesUntil: 5 })).body).toBe('任务：写周报 · 5 分钟后');
    expect(formatReminderNotification(item({ minutesUntil: 1 })).body).toBe('任务：写周报 · 1 分钟后');
  });

  it('labels events and all-day items distinctly', () => {
    const event = item({ kind: 'event', id: 'event-1', title: '站会', minutesUntil: -2 });
    expect(formatReminderNotification(event).body).toBe('日程：站会 · 现在');
    expect(formatReminderNotification(item({ allDay: true })).body).toBe('任务：写周报 · 全天');
  });

  it('prints the half-day bucket instead of 全天 for period items', () => {
    const period = (p: 'morning' | 'afternoon' | 'evening', minutesUntil = 0) =>
      item({ allDay: true, period: p, reminderDate: '2026-09-06' as LocalDate, minutesUntil });

    expect(formatReminderNotification(period('morning')).body).toBe('任务：写周报 · 上午');
    expect(formatReminderNotification(period('afternoon')).body).toBe('任务：写周报 · 下午');
    // A late catch-up (anchor already passed) still names the bucket, not 现在:
    // the user cares which part of the day it was written for.
    expect(formatReminderNotification(period('evening', -420)).body).toBe('任务：写周报 · 晚上');
  });
});

describe('selectUnannounced', () => {
  it('skips already-announced keys and de-duplicates within one batch', () => {
    const first = item({ id: 'task-1' });
    const second = item({ id: 'task-2', title: '评审' });
    const announced = new Set([reminderKey(first)]);

    const fresh = selectUnannounced([first, second, { ...second }], announced);
    expect(fresh.map(reminderKey)).toEqual([reminderKey(second)]);
  });

  it('treats the same id at a different due instant as a different reminder', () => {
    const base = item();
    const moved = item({ dueAt: T('2026-09-07T08:00:00.000Z') });
    expect(selectUnannounced([moved], new Set([reminderKey(base)]))).toHaveLength(1);
  });

  it('returns an empty list when everything was already announced', () => {
    const one = item();
    expect(selectUnannounced([one], new Set([reminderKey(one)]))).toEqual([]);
  });
});
