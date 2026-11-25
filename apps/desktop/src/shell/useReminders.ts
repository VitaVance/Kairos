import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent, Task } from '@todolist/core';
import { reminderKey, ReminderState } from '@todolist/features';
import type { Notifier, ReminderItem } from '@todolist/features';
import { useAppServices } from '@todolist/features';
import { useRevision, useTasks } from '@todolist/features';

const TICK_MS = 30_000;
const WINDOW_MINUTES = 10;
/**
 * How often the near-term event window is re-read. The tick above only asks
 * "is anything due *in the data I already hold*"; it cannot discover an event
 * that was created after the last load, nor keep a fixed ±1/+2 day span
 * centred on a clock that has moved. Fifteen minutes is far below the ten
 * minute reminder window's margin of error and costs one indexed range query.
 */
const EVENTS_REFRESH_MS = 15 * 60_000;

/** Browser dev has no OS toasts; keep one shared no-op instead of branching. */
const NO_NOTIFIER: Notifier = { notify: async () => {} };

/**
 * Drives the reminder scheduler.
 *
 * The scheduler itself is pure and timer-free (`ReminderState.tick(now)`);
 * this hook is the only place that owns a clock.
 *
 * Both data sources are held in refs and fed to the scheduler *together*, so a
 * tick can never run with tasks-loaded-but-events-empty (which is exactly how
 * event reminders silently failed before): whichever fetch lands last pushes
 * the combined sources in and ticks immediately.
 *
 * `notify` is fed the same newly-fired items the banner gets, so an OS toast
 * (desktop) and the in-app banner always agree. Notification failures never
 * reach the banner path — the banner is the guaranteed channel.
 */
export function useReminders(notifier: Notifier = NO_NOTIFIER): {
  items: readonly ReminderItem[];
  /** Dismiss every reminder currently on screen. */
  dismiss: () => void;
  /** Remove one reminder (完成 in the banner must not hide the others). */
  dismissOne: (item: ReminderItem) => void;
} {
  const { events } = useAppServices();
  const { data: tasks } = useTasks();
  // Any calendar mutation bumps the revision. Without it the event window below
  // was only re-read when a *task* happened to reload — correct by accident,
  // and it stopped being correct the moment the window itself moved (below).
  const revision = useRevision();
  const [items, setItems] = useState<readonly ReminderItem[]>([]);

  const stateRef = useRef(new ReminderState({ windowMinutes: WINDOW_MINUTES }));
  const tasksRef = useRef<readonly Task[]>([]);
  const eventsRef = useRef<readonly CalendarEvent[]>([]);

  // Read through a ref so swapping the notifier never restarts the clock, and
  // sync callback identity cannot make an effect fire twice.
  const notifierRef = useRef(notifier);
  notifierRef.current = notifier;

  // Fire-and-forget: native delivery must never block or break the state update
  // that feeds the in-app banner.
  const announce = (due: readonly ReminderItem[]) => {
    if (due.length === 0) return;
    notifierRef.current.notify(due).catch((err: unknown) => {
      console.warn('[reminders] 系统通知发送失败', err);
    });
  };

  // Keep the refs current and re-tick from a single place.
  useEffect(() => {
    tasksRef.current = tasks ?? [];
    const state = stateRef.current;

    const tick = () => {
      state.setSources(tasksRef.current, eventsRef.current);
      const now = new Date();
      const due = state.tick(now.toISOString() as never);
      announce(due);
      // Reconcile rather than overwrite: anything still upcoming stays,
      // newly-due items are merged in, and items whose moment has passed (or
      // whose task is now done) are dropped so a stale banner cannot offer to
      // "complete" something that is already finished.
      setItems((prev) => {
        const nowMs = now.getTime();
        const doneIds = new Set(
          tasksRef.current.filter((task) => task.status === 'done').map((task) => String(task.id)),
        );
        const dueByKey = new Map(due.map((item) => [reminderKey(item), item]));
        const kept: ReminderItem[] = [];
        for (const previous of prev) {
          const key = reminderKey(previous);
          const fresh = dueByKey.get(key);
          if (fresh) {
            kept.push(fresh);
            continue;
          }
          // `minutesUntil` is a snapshot from when the item first fired; a kept
          // item must be re-measured against *this* tick or its stale value
          // would keep it on screen forever.
          if (Date.parse(previous.dueAt) < nowMs) continue;
          if (previous.kind === 'task' && doneIds.has(previous.id)) continue;
          kept.push(refreshCountdown(previous, nowMs));
        }
        const keptKeys = new Set(kept.map((item) => reminderKey(item)));
        const added = due.filter((item) => !keptKeys.has(reminderKey(item)));
        const next = [...kept, ...added];
        return sameItems(prev, next) ? prev : next;
      });
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, [tasks]);

  // Fetch the near-term events; when they arrive, feed + tick immediately.
  //
  // The window is recomputed on every load rather than captured once: this
  // hook used to read a fixed ±1/+2 day span at mount and only re-read it when
  // a *task* changed. That was survivable while the process died with its
  // window, but the app now lives in the tray indefinitely, so a reminder for
  // tomorrow's meeting would never be fetched at all on a machine left running
  // for a week. `EVENTS_REFRESH_MS` keeps the span rolling and picks up events
  // created elsewhere; `revision` covers mutations made in this window.
  useEffect(() => {
    let alive = true;

    const load = () => {
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
      events
        .listBetween(from as never, to as never)
        .then((list) => {
          if (!alive) return;
          eventsRef.current = list;
          const state = stateRef.current;
          state.setSources(tasksRef.current, list);
          const due = state.tick(new Date().toISOString() as never);
          if (due.length > 0) {
            setItems((prev) => mergeItems(prev, due));
            announce(due);
          }
        })
        .catch((err: unknown) => console.error('[reminders] 读取日程失败', err));
    };

    load();
    const id = window.setInterval(load, EVENTS_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [events, revision]);

  const dismiss = useCallback(() => setItems([]), []);
  const dismissOne = useCallback(
    (item: ReminderItem) =>
      setItems((prev) => prev.filter((entry) => reminderKey(entry) !== reminderKey(item))),
    [],
  );
  return { items, dismiss, dismissOne };
}

/** Re-price a kept reminder against the current clock. */
function refreshCountdown(item: ReminderItem, nowMs: number): ReminderItem {
  return { ...item, minutesUntil: Math.round((Date.parse(item.dueAt) - nowMs) / 60_000) };
}

/** True when two lists carry the same reminders with the same wording. */
function sameItems(a: readonly ReminderItem[], b: readonly ReminderItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      reminderKey(item) === reminderKey(b[i]!) && item.minutesUntil === b[i]!.minutesUntil,
  );
}

function mergeItems(
  prev: readonly ReminderItem[],
  due: readonly ReminderItem[],
): readonly ReminderItem[] {
  const byKey = new Map(prev.map((item) => [reminderKey(item), item]));
  for (const item of due) byKey.set(reminderKey(item), item);
  return [...byKey.values()];
}
