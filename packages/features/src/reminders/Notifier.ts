import { i18n, currentLanguage } from '@todolist/ui';
import type { Language } from '@todolist/ui';
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

/** App name shown as the notification title (the product is called «Kairos»). */
export const REMINDER_NOTIFICATION_TITLE = 'Kairos';

export interface ReminderNotification {
  readonly title: string;
  readonly body: string;
}

/**
 * The `misc` translator for the given language. This module has no React, so
 * it resolves the shared i18next instance instead of taking a hook; the caller
 * passes the language so a toast never lags the in-app banner after a switch.
 */
function miscT(language: Language) {
  return i18n.getFixedT(language, 'misc');
}

function kindLabel(t: ReturnType<typeof miscT>, kind: ReminderItem['kind']): string {
  return kind === 'task' ? t('reminders.kind.task') : t('reminders.kind.event');
}

/**
 * A day/period task announces *during* its bucket, so "all day" would be wrong:
 * a "this morning" task announced at 10:00 is not an all-day one. Period items
 * print their bucket; a plain day task keeps all day, since it really is the
 * whole day. Exact-time items keep the countdown, where a negative value means
 * the anchor has already passed and the honest label is "now".
 *
 * The countdown is built with `Intl.RelativeTimeFormat` rather than concatenated
 * fragments, so word order and plural forms come from the platform in both
 * languages (en: "in 5 minutes", zh-CN: "5 分钟后").
 */
function timeLabel(t: ReturnType<typeof miscT>, language: Language, item: ReminderItem): string {
  if (item.allDay) {
    if (item.period === null) return t('reminders.time.allDay');
    return t(`reminders.period.${item.period}` as const);
  }
  if (item.minutesUntil <= 0) return t('reminders.time.now');
  return new Intl.RelativeTimeFormat(language, { numeric: 'always', style: 'long' }).format(
    item.minutesUntil,
    'minute',
  );
}

/**
 * Pure description of the toast for one reminder: title is always the app
 * name, body carries the task/event title plus the same time wording the
 * in-app banner uses (now / in N minutes / all day / morning etc.).
 */
export function formatReminderNotification(
  item: ReminderItem,
  language: Language = currentLanguage(),
): ReminderNotification {
  const t = miscT(language);
  return {
    title: REMINDER_NOTIFICATION_TITLE,
    body: t('reminders.notificationBody', {
      kind: kindLabel(t, item.kind),
      title: item.title,
      time: timeLabel(t, language, item),
    }),
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
