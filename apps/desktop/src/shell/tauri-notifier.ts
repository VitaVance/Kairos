import { formatReminderNotification, reminderKey, selectUnannounced } from '@todolist/features';
import type { Notifier, ReminderItem } from '@todolist/features';
import { isTauri } from '../host';

/**
 * Tauri host wrapper for the features-internal `Notifier` port.
 *
 * Same loading discipline as the SQL driver: the plugin is only reached via
 * `await import()` behind `isTauri()`, so the browser dev build never bundles
 * or evaluates the native bridge. Without Tauri the notifier is a no-op and
 * the in-app banner remains the only channel.
 *
 * Permission is requested lazily on the first reminder, never at boot. A
 * denial (or a failing plugin call) disables native toasts for the session
 * and is swallowed: reminders must keep working in the banner either way.
 *
 * Dedup: `announced` remembers every `reminderKey` whose toast was accepted,
 * and a key is inserted *before* the await so two ticks racing on the same
 * due item still produce exactly one toast.
 */

type NotificationModule = typeof import('@tauri-apps/plugin-notification');

const announced = new Set<string>();

/** `null` = not loaded yet, `false` = unavailable/denied, otherwise the module. */
let pluginPromise: Promise<NotificationModule | null> | null = null;
let permission: Promise<boolean> | null = null;

function loadPlugin(): Promise<NotificationModule | null> {
  if (pluginPromise === null) {
    pluginPromise = import('@tauri-apps/plugin-notification').catch((error: unknown) => {
      console.warn('[notify] 系统通知插件不可用，仅显示应用内提醒', error);
      return null;
    });
  }
  return pluginPromise;
}

/** Resolve (once) whether the OS will accept our toasts. */
function ensurePermission(plugin: NotificationModule): Promise<boolean> {
  if (permission === null) {
    permission = (async () => {
      try {
        if (await plugin.isPermissionGranted()) return true;
        const result = await plugin.requestPermission();
        return result === 'granted';
      } catch (error: unknown) {
        console.warn('[notify] 无法获取系统通知权限，仅显示应用内提醒', error);
        return false;
      }
    })();
  }
  return permission;
}

/** Drop the oldest remembered keys so a long session cannot grow unbounded. */
const ANNOUNCED_CAPACITY = 500;
function remember(key: string): void {
  announced.add(key);
  while (announced.size > ANNOUNCED_CAPACITY) {
    const oldest = announced.values().next();
    if (oldest.done) break;
    announced.delete(oldest.value);
  }
}

export function createTauriNotifier(): Notifier {
  return {
    notify: async (items: readonly ReminderItem[]) => {
      if (!isTauri() || items.length === 0) return;

      const plugin = await loadPlugin();
      if (plugin === null) return;
      if (!(await ensurePermission(plugin))) return;

      for (const item of selectUnannounced(items, announced)) {
        // Claim the key first: a concurrent tick must not re-send while the
        // (synchronous but throwable) platform call runs.
        remember(reminderKey(item));
        const { title, body } = formatReminderNotification(item);
        try {
          plugin.sendNotification({ title, body });
        } catch (error: unknown) {
          console.warn('[notify] 发送系统通知失败', error);
        }
      }
    },
  };
}
