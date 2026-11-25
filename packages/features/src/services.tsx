import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CalendarService, EventService, ListService, TaskService, TaskList } from '@todolist/core';
import type { ReactNode } from 'react';

/**
 * Composition-root boundary.
 *
 * Feature screens receive services through this context and NEVER import an
 * adapter, SQL driver, or platform API. The app shell (desktop today, mobile
 * later) constructs the concrete services and provides them here; that is the
 * only place that knows how data is stored.
 */
export interface AppServices {
  readonly tasks: TaskService;
  readonly calendar: CalendarService;
  readonly listsService: ListService;
  readonly events: EventService;
  /**
   * Initial list snapshot. Live lists come from `useLists()` below, which
   * re-reads through `listsService` whenever the revision changes — a list
   * created or recolored in the sidebar must show up everywhere at once.
   */
  readonly lists: readonly TaskList[];
}

const ServicesContext = createContext<AppServices | null>(null);

/**
 * Data revision.
 *
 * Every screen loads its own slice. When one writes, the others must re-read.
 * A mutation calls `bump()`; `useLists` and every `useAsync` consumer keyed on
 * the revision refetch. One counter instead of an event bus keeps the wiring
 * obvious and impossible to forget.
 */
const RevisionContext = createContext<{ revision: number; bump: () => void } | null>(null);

export function AppServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const revisionValue = useMemo(() => ({ revision, bump }), [revision, bump]);

  return (
    <ServicesContext.Provider value={services}>
      <RevisionContext.Provider value={revisionValue}>{children}</RevisionContext.Provider>
    </ServicesContext.Provider>
  );
}

export function useAppServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useAppServices 必须在 <AppServicesProvider> 内使用');
  return ctx;
}

/**
 * Live lists. Re-reads on every revision bump so renames, recolors and
 * deletions propagate without a page reload.
 */
export function useLists(): readonly TaskList[] {
  const { listsService, lists: initial } = useAppServices();
  const revision = useRevision();
  const [loaded, setLoaded] = useState<readonly TaskList[]>(initial);

  useEffect(() => {
    let alive = true;
    listsService.listAll().then(
      (next) => {
        if (alive) setLoaded(next);
      },
      (err: unknown) => {
        console.error('[lists] 加载失败', err);
      },
    );
    return () => {
      alive = false;
    };
  }, [listsService, revision]);

  return loaded;
}

/** Current data revision — put this in a `useAsync` dep list to auto-reload. */
export function useRevision(): number {
  const ctx = useContext(RevisionContext);
  if (!ctx) throw new Error('useRevision 必须在 <AppServicesProvider> 内使用');
  return ctx.revision;
}

/** Call after any successful mutation to refresh every visible screen. */
export function useBumpRevision(): () => void {
  const ctx = useContext(RevisionContext);
  if (!ctx) throw new Error('useBumpRevision 必须在 <AppServicesProvider> 内使用');
  return ctx.bump;
}
