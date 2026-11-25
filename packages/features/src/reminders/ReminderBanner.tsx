import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './reminders.css';
import type { ReminderItem } from './ReminderScheduler';
import { reminderKey } from './ReminderScheduler';

/**
 * Top-of-screen reminder banner.
 *
 * Stateless about time: the host owns the clock and passes the currently due
 * `items`. Snooze is local UI state — a snoozed item disappears for ten
 * minutes and comes back on a later render (the host re-renders on its tick).
 * The banner is dismissible and announced via `role="alert"`.
 */
export interface ReminderBannerProps {
  items: readonly ReminderItem[];
  /** Toggle a task done. Only task reminders expose 完成. */
  onComplete: (item: ReminderItem) => void;
  /** Persist the snooze (host may record it); the banner hides locally too. */
  onSnooze: (item: ReminderItem, until: number) => void;
  /** Hide the whole banner until new reminders arrive. */
  onDismiss: () => void;
}

/** Snooze length in milliseconds. */
export const SNOOZE_MS = 10 * 60_000;

function minutesLabel(minutesUntil: number): string {
  if (minutesUntil <= 0) return '现在';
  if (minutesUntil === 1) return '1 分钟后';
  return `${minutesUntil} 分钟后`;
}

function kindLabel(kind: ReminderItem['kind']): string {
  return kind === 'task' ? '任务' : '日程';
}

export function ReminderBanner({ items, onComplete, onSnooze, onDismiss }: ReminderBannerProps) {
  const [snoozedUntil, setSnoozedUntil] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const previousSignature = useRef<string>('');

  // When the incoming set changes (the host ticked or new reminders arrived),
  // refresh "now" so expired snoozes are re-evaluated and a dismissal lapses.
  const signature = items.map((item) => reminderKey(item)).join('|');
  useEffect(() => {
    if (signature === previousSignature.current) return;
    previousSignature.current = signature;
    setNow(Date.now());
    setDismissed(false);
  }, [signature]);

  const visible = useMemo(() => {
    if (dismissed) return [];
    return items.filter((item) => {
      const until = snoozedUntil[reminderKey(item)];
      return until === undefined || until <= now;
    });
  }, [items, snoozedUntil, now, dismissed]);

  // Re-evaluate when the earliest pending snooze expires, so a snoozed item
  // comes back even if the host passes the same item set again.
  useEffect(() => {
    const pending = Object.values(snoozedUntil).filter((until) => until > now);
    if (pending.length === 0) return;
    const delay = Math.max(0, Math.min(...pending) - now);
    const timer = setTimeout(() => setNow(Date.now()), delay + 50);
    return () => clearTimeout(timer);
  }, [snoozedUntil, now]);

  const snooze = useCallback(
    (item: ReminderItem) => {
      const until = Date.now() + SNOOZE_MS;
      setSnoozedUntil((prev) => ({ ...prev, [reminderKey(item)]: until }));
      onSnooze(item, until);
    },
    [onSnooze],
  );

  const dismiss = useCallback(() => {
    setDismissed(true);
    onDismiss();
  }, [onDismiss]);

  if (visible.length === 0) return null;

  return (
    <div className="reminder-banner" role="alert" aria-live="assertive">
      <div className="reminder-banner__list">
        {visible.map((item) => (
          <div key={reminderKey(item)} className="reminder-banner__item">
            <span className="reminder-banner__kind">{kindLabel(item.kind)}</span>
            <span className="reminder-banner__title" title={item.title}>
              {item.title}
            </span>
            <span className="reminder-banner__time">
              {item.allDay ? '全天' : minutesLabel(item.minutesUntil)}
            </span>
            <div className="reminder-banner__actions">
              {item.kind === 'task' ? (
                <button
                  type="button"
                  className="reminder-banner__btn reminder-banner__btn--primary"
                  aria-label={`完成 ${item.title}`}
                  onClick={() => onComplete(item)}
                >
                  完成
                </button>
              ) : null}
              <button type="button" className="reminder-banner__btn" onClick={() => snooze(item)}>
                稍后
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="reminder-banner__dismiss"
        aria-label="关闭提醒"
        onClick={dismiss}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
