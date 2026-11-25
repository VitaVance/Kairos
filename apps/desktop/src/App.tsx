import { useEffect, useState } from 'react';
import { CryptoIdGenerator, SystemClock, resetAllData, seedDemoData } from '@todolist/adapters';
import type { TaskList } from '@todolist/core';
import { TaskService, initTemporal } from '@todolist/core';
import { resolveInitialLanguage } from '@todolist/ui';
import { AppServicesProvider } from '@todolist/features';
import type { Notifier } from '@todolist/features';
import { Shell } from './shell/Shell';
import { createTauriNotifier } from './shell/tauri-notifier';
import { UPDATE_ENDPOINT, createTauriUpdateChecker } from './shell/tauri-update-checker';
import { isTauri } from './host';
import { createImportApplier, createServices } from './composition';
import { createStorage } from './storage';
import type { StorageHandle } from './storage';

/**
 * Composition root.
 *
 * This is the ONLY place that knows which concrete adapters exist. `createStorage`
 * picks SQLite inside Tauri and an in-memory fallback for browser dev, so nothing
 * above this line changes. On React Native, the same createServices() call is
 * reused with a mobile storage adapter.
 */
interface Booted {
  readonly storage: StorageHandle;
  readonly lists: readonly TaskList[];
  /**
   * Wipes every task, list and event. Persists "onboarding dismissed" inside
   * the same transaction boundary as the deletes, so the next boot stays
   * empty instead of re-seeding.
   */
  readonly resetData: () => Promise<void>;
}

const clock = new SystemClock();
const ids = new CryptoIdGenerator();

/**
 * Constructed once per page load, not per render: the notifier keeps the
 * permission decision and the already-announced keys for the whole session.
 * In a plain browser the hook's own no-op default is used instead.
 */
const notifier: Notifier | undefined = isTauri() ? createTauriNotifier() : undefined;

/**
 * Update checking is manual and reads a local file, so it needs a host but no
 * network. Constructed once, like the notifier.
 */
const updateChecker = isTauri() ? createTauriUpdateChecker() : null;

/** Boot: Temporal → storage → seed → one-time data repair. */
async function boot(): Promise<Booted> {
  await initTemporal();
  const storage = await createStorage({ ids });
  /**
   * The demo corpus is chosen once, here, from the language the UI will open
   * in (persisted choice, else the OS locale, else English). This runs before
   * React and before `initI18n` has finished, so it reads the same pure
   * resolver the runtime uses rather than a hook. Rows are then ordinary
   * content and are never retranslated when the user switches later.
   */
  await seedDemoData({ uow: storage.uow, clock, ids, language: resolveInitialLanguage() });
  await repairRunawayRecurringDates(storage.uow);
  const lists = await storage.uow.lists.list();
  return {
    storage,
    lists,
    resetData: () => resetAllData({ uow: storage.uow, clock, ids }),
  };
}

/**
 * One-time correction for the old recurring-completion bug, which advanced a
 * repeating task's due date on every click and could push it years out.
 *
 * Gated on a marker in the database's `settings` table, so it runs exactly
 * once per installation: a user who *later* deliberately schedules a repeating
 * task months ahead must not have it clamped on the next start. The write
 * happens before the first list read, so the corrupt date is never rendered.
 *
 * Storage that exposes no settings (a hand-written fake) is skipped — there is
 * nothing to record the marker in, so repeating the pass forever would be the
 * only alternative.
 */
const RECURRENCE_REPAIR_KEY = 'repair.recurring-runaway-dates.v1';

interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

async function repairRunawayRecurringDates(uow: StorageHandle['uow']): Promise<void> {
  const store = (uow as { settings?: Partial<SettingsStore> }).settings;
  if (typeof store?.get !== 'function' || typeof store.set !== 'function') return;
  if ((await store.get(RECURRENCE_REPAIR_KEY)) !== null) return;

  const repaired = await new TaskService({ uow, clock, ids }).repairRunawayRecurrences();
  await store.set(RECURRENCE_REPAIR_KEY, clock.now());
  if (repaired.length > 0) {
    console.info(
      `[repair] 已把 ${repaired.length} 条重复任务的错误日期修正到最近一次:`,
      repaired.map((task) => `${task.title} → ${task.dueDate}`).join(', '),
    );
  }
}

/**
 * Started once per page load, not per mount: React StrictMode mounts effects
 * twice in dev, and two concurrent `migrate()` / seed runs would race on the
 * `schema_version` primary key and duplicate the demo content.
 */
const bootedPromise = boot();

export function App() {
  const [booted, setBooted] = useState<Booted | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bootedPromise.then(
      (result) => {
        if (alive) setBooted(result);
      },
      (error: unknown) => {
        console.error('[boot] 启动失败', error);
        if (alive) setFailure(describeError(error));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failure !== null) return <BootError message={failure} />;
  if (booted === null) return <BootSkeleton />;

  const { storage, lists, resetData } = booted;
  const deps = { uow: storage.uow, clock, ids, lists };
  const services = createServices(deps);
  const importApplier = createImportApplier(deps);

  return (
    <AppServicesProvider services={services}>
      <Shell
        onImport={importApplier}
        onResetData={resetData}
        notifier={notifier}
        updateChecker={updateChecker}
        updateEndpoint={UPDATE_ENDPOINT}
      />
      {storage.mode === 'memory' ? <MemoryModeBadge /> : null}
    </AppServicesProvider>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Loading screen: app name plus a subtle pulsing bar. Styles scoped by `boot-`. */
function BootSkeleton() {
  return (
    <div className="boot-screen">
      <style>{`
        .boot-screen { display: flex; height: 100vh; flex-direction: column; align-items: center;
          justify-content: center; gap: 18px; background: var(--tl-bg);
          color: var(--tl-text);
          font-family: var(--tl-font-sans, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif); }
        .boot-title { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; opacity: 0.75; }
        .boot-bar { position: relative; overflow: hidden; width: 120px; height: 3px; border-radius: 2px;
          background: var(--tl-border); }
        .boot-bar::after { content: ''; position: absolute; inset: 0; border-radius: 2px;
          background: var(--tl-accent); animation: boot-pulse 1.2s ease-in-out infinite;
          transform-origin: left center; }
        @keyframes boot-pulse { 0%, 100% { transform: scaleX(0.15); opacity: 0.4; }
          50% { transform: scaleX(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .boot-bar::after { animation: none; opacity: 0.6; } }
      `}</style>
      <div className="boot-title">Kairos</div>
      <div className="boot-bar" role="progressbar" aria-label="正在加载" />
    </div>
  );
}

/** Boot failure: never a blank screen — show why and offer a reload. */
function BootError({ message }: { message: string }) {
  return (
    <div className="boot-screen">
      <style>{`
        .boot-screen { display: flex; height: 100vh; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; background: var(--tl-bg);
          color: var(--tl-text); padding: 24px; text-align: center;
          font-family: var(--tl-font-sans, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif); }
        .boot-error-title { font-size: 15px; font-weight: 600; color: var(--tl-danger); }
        .boot-error-msg { max-width: 480px; font-size: 12px; opacity: 0.7; word-break: break-word; }
        .boot-retry { margin-top: 4px; padding: 6px 18px; border: 1px solid var(--tl-border);
          border-radius: 6px; background: var(--tl-surface); color: inherit; font: inherit;
          font-size: 13px; cursor: pointer; }
        .boot-retry:hover { border-color: var(--tl-accent); }
      `}</style>
      <div className="boot-error-title">启动失败</div>
      <div className="boot-error-msg">{message}</div>
      <button className="boot-retry" type="button" onClick={() => window.location.reload()}>
        重试
      </button>
    </div>
  );
}

/** Small, non-blocking hint that browser dev mode does not persist. */
function MemoryModeBadge() {
  return (
    <div
      title="浏览器开发模式：数据仅保存在内存中，刷新即丢失。"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        background: 'var(--tl-surface-sunken)',
        color: 'var(--tl-text-secondary)',
        opacity: 0.7,
        pointerEvents: 'none',
      }}
    >
      内存模式
    </div>
  );
}
