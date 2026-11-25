import { useCallback, useEffect, useRef, useState } from 'react';
import type { Instant, Task, TaskId } from '@todolist/core';
import { useAsync } from './useAsync';
import { useAppServices, useBumpRevision, useRevision } from '../services';
import { useToast } from '../undo/UndoProvider';

/** How long a row keeps its completion intent flag (≈ the CSS animation). */
const FRESH_MS = 220;

/**
 * Pure optimistic overlay for one row: flip the status locally while the write
 * is in flight. Kept framework-free so the rollback contract is unit-testable.
 */
export function optimisticToggle(task: Task, now: Instant): Task {
  const goingDone = task.status !== 'done';
  return {
    ...task,
    status: goingDone ? 'done' : 'open',
    completedAt: goingDone ? now : null,
  };
}

/**
 * Tasks for the current screen. `mutate` runs a write then bumps the shared
 * revision, so every other visible screen (calendar, agenda, detail panel)
 * refetches instead of showing stale data.
 *
 * `toggleDone(id, title)` is the exception: completion is the interaction
 * users do constantly, so the row flips instantly and reconciles afterwards.
 * A failed write drops the optimistic value (rolling back) and raises a toast.
 */
export function useTasks() {
  const { tasks } = useAppServices();
  const revision = useRevision();
  const bump = useBumpRevision();
  const notify = useToast();

  const state = useAsync<readonly Task[]>(() => tasks.listAll(), [revision]);

  /** id → optimistic row laid over the latest loaded snapshot. */
  const [pending, setPending] = useState<ReadonlyMap<TaskId, Task>>(() => new Map());
  /** Rows whose completion intent is younger than the animation. */
  const [fresh, setFresh] = useState<ReadonlySet<TaskId>>(() => new Set());
  /** StrictMode-safe guard: one in-flight toggle per task id. */
  const inFlight = useRef(new Set<TaskId>());
  /** Latest rows by id — lets `toggleDone` stay stable across reloads while
      still reading the freshest data. */
  const latest = useRef({ snapshot: state.data, pending });
  latest.current = { snapshot: state.data, pending };
  /** Pending animation timers, cleared on unmount. */
  const timers = useRef(new Set<number>());

  const data = state.data
    ? state.data.map((task) => pending.get(task.id) ?? task)
    : state.data;

  // Retire an optimistic row as soon as the reloaded snapshot carries the same
  // write back. Deleting on a timer instead would flash the old status
  // whenever the reload was slow.
  useEffect(() => {
    if (pending.size === 0 || !state.data) return;
    const next = new Map(pending);
    for (const [id, optimistic] of pending) {
      const live = state.data.find((task) => task.id === id);
      if (live && live.updatedAt === optimistic.updatedAt && live.status === optimistic.status) {
        next.delete(id);
      }
    }
    if (next.size !== pending.size) setPending(next);
  }, [state.data, pending]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      bump();
      state.reload();
    },
    [bump, state],
  );

  const markFresh = useCallback((id: TaskId) => {
    setFresh((prev) => new Set(prev).add(id));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setFresh((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, FRESH_MS);
    timers.current.add(timer);
  }, []);

  // A row's animation flag must not outlive the screen.
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const toggleDone = useCallback(
    (id: TaskId, title: string) => {
      if (inFlight.current.has(id)) return;
      const { snapshot, pending: optimisticRows } = latest.current;
      const base = optimisticRows.get(id) ?? snapshot?.find((task) => task.id === id);
      if (!base) return;
      inFlight.current.add(id);

      const goingDone = base.status !== 'done';
      const optimistic = optimisticToggle(base, new Date().toISOString() as Instant);
      setPending((prev) => new Map(prev).set(id, optimistic));
      markFresh(id);

      void (async () => {
        try {
          const written = await tasks.toggleDone(id);
          // Keep the authoritative row (a recurring task rolls forward) until
          // the reloaded list replaces it.
          setPending((prev) => new Map(prev).set(id, written));
          bump();
          state.reload();
        } catch (error) {
          console.error('切换完成状态失败', error);
          // Rollback: drop the optimistic row so the pre-toggle status returns.
          setPending((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          notify(goingDone ? `「${title}」完成失败，请重试` : `「${title}」取消完成失败，请重试`);
        } finally {
          inFlight.current.delete(id);
        }
      })();
    },
    [bump, markFresh, notify, state, tasks],
  );

  return { ...state, data, mutate, toggleDone, fresh };
}
