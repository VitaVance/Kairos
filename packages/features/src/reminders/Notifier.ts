import type { DuePeriod } from '@todolist/core';
import type { ReminderItem } from './ReminderScheduler.js';
import { reminderKey } from './ReminderScheduler.js';

/**
 * Platform notification port.
 *
 * The feature layer declares *what* a reminder announcement looks like; the
 * host shell decides *how* it reaches the user (an OS toast in the desktop
 * app, nothing at all in a plain browser). Deliberately narrow — one method,
 * pure data in, no callbacks out — so `useReminders` never learns about Tauri.
 *
 * Implementations must be idempotent per `reminderKey`: a reminder may be
 * retried by a host tick, and the user must never get the same toast twice.
 */
export interface Notifier {
  notify(items: readonly ReminderItem[]): Promise<void>;
}

/** App name shown as the notification title («清单» in the product). */
export const REMINDER_NOTIFICATION_TITLE = 'Kairos';

export interface ReminderNotification {
  readonly title: string;
  readonly body: string;
}

function kindLabel(kind: ReminderItem['kind']): string {
  return kind === 'task' ? '任务' : '日程';
}

/** The same 上午/下午/晚上 wording the list and calendar chips use. */
const PERIOD_LABEL: Record<DuePeriod, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

/**
 * A day/period task announces *during* its bucket, so "全天" would be wrong:
 * a "this morning" task announced at 10:00 is not an all-day one. Period items
 * print their bucket; a plain day task keeps 全天, since it really is the whole
 * day. Exact-time items keep the countdown, where a negative value means the
 * anchor has already passed and the honest label is 现在.
 */
function timeLabel(item: ReminderItem): string {
  if (item.allDay) return item.period === null ? '全天' : PERIOD_LABEL[item.period];
  if (item.minutesUntil <= 0) return '现在';
  if (item.minutesUntil === 1) return '1 分钟后';
  return `${item.minutesUntil} 分钟后`;
}

/**
 * Pure description of the toast for one reminder: title is always the app
 * name, body carries the task/event title plus the same time wording the
 * in-app banner uses (现在 / N 分钟后 / 全天 / 上午等).
 */
export function formatReminderNotification(item: ReminderItem): ReminderNotification {
  return {
    title: REMINDER_NOTIFICATION_TITLE,
    body: `${kindLabel(item.kind)}：${item.title} · ${timeLabel(item)}`,
  };
}

/**
 * Items that have not been announced yet, de-duplicated within `items` too.
 * Membership in `announced` is left to the caller, which marks keys before
 * awaiting the platform call so concurrent ticks cannot double-send.
 */
export function selectUnannounced(
  items: readonly ReminderItem[],
  announced: ReadonlySet<string>,
): ReminderItem[] {
  const seen = new Set<string>();
  const fresh: ReminderItem[] = [];
  for (const item of items) {
    const key = reminderKey(item);
    if (announced.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return fresh;
}
