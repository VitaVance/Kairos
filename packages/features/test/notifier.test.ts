import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Instant, LocalDate } from '@todolist/core';
import { initI18n, setLanguage } from '@todolist/ui';
import type { ReminderItem } from '../src/reminders/ReminderScheduler.js';
import { reminderKey } from '../src/reminders/ReminderScheduler.js';
import {
  REMINDER_NOTIFICATION_TITLE,
  formatReminderNotification,
  selectUnannounced,
} from '../src/reminders/Notifier.js';

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

// The copy now lives in the `misc` catalog; assertions pin the English locale
// so wording changes in either catalog are caught without depending on the
// machine's locale.
beforeEach(() => {
  initI18n('en');
});

afterEach(async () => {
  await setLanguage('en');
});

describe('formatReminderNotification', () => {
  it('titles every toast with the app name and echoes the banner time wording', () => {
    expect(formatReminderNotification(item({ minutesUntil: 0 }), 'en')).toEqual({
      title: REMINDER_NOTIFICATION_TITLE,
      body: 'Task: 写周报 · now',
    });
    expect(formatReminderNotification(item({ minutesUntil: 5 }), 'en').body).toBe(
      'Task: 写周报 · in 5 minutes',
    );
    expect(formatReminderNotification(item({ minutesUntil: 1 }), 'en').body).toBe(
      'Task: 写周报 · in 1 minute',
    );
  });

  it('labels events and all-day items distinctly', () => {
    const event = item({ kind: 'event', id: 'event-1', title: '站会', minutesUntil: -2 });
    expect(formatReminderNotification(event, 'en').body).toBe('Event: 站会 · now');
    expect(formatReminderNotification(item({ allDay: true }), 'en').body).toBe(
      'Task: 写周报 · All day',
    );
  });

  it('prints the half-day bucket instead of all-day for period items', () => {
    const period = (p: 'morning' | 'afternoon' | 'evening', minutesUntil = 0) =>
      item({ allDay: true, period: p, reminderDate: '2026-09-06' as LocalDate, minutesUntil });

    expect(formatReminderNotification(period('morning'), 'en').body).toBe(
      'Task: 写周报 · Morning',
    );
    expect(formatReminderNotification(period('afternoon'), 'en').body).toBe(
      'Task: 写周报 · Afternoon',
    );
    // A late catch-up (anchor already passed) still names the bucket, not "now":
    // the user cares which part of the day it was written for.
    expect(formatReminderNotification(period('evening', -420), 'en').body).toBe(
      'Task: 写周报 · Evening',
    );
  });

  it('renders the Chinese catalog when the language is zh-CN', async () => {
    await setLanguage('zh-CN');
    // Word order and spacing come from Intl.RelativeTimeFormat, not ours.
    expect(formatReminderNotification(item({ minutesUntil: 5 }), 'zh-CN').body).toBe(
      '任务：写周报 · 5分钟后',
    );
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
