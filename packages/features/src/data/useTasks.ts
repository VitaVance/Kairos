import { useCallback, useEffect, useRef, useState } from 'react';
import type { Instant, Task, TaskId, ToggleDoneResult } from '@todolist/core';
import { useTranslation } from '@todolist/ui';
import { useAsync } from './useAsync';
import { useAppServices, useBumpRevision, useRevision } from '../services';
import { useToast, useUndoOptional } from '../undo/UndoProvider';

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
 * The narrow write surface undo/redo need. `TaskService` satisfies it; tests
 * can supply a fake without constructing storage.
 */
export interface CompletionPort {
  listAll(): Promise<readonly Task[]>;
  toggleDone(id: TaskId): Promise<ToggleDoneResult>;
  remove(id: TaskId): Promise<void>;
}

/**
 * Reverse one completion.
 *
 * Completing a recurring task detaches the next occurrence into a *new* row,
 * so the inverse is two writes, not one: delete the row the completion
 * created, then reopen the row that was ticked. Deleting first keeps the list
 * from ever showing two open copies of the same series.
 *
 * The spawned row may have been renamed, rescheduled or deleted by the user in
 * the meantime. Only an unchanged id is removable; a deleted one is already
 * gone, and the reopen still happens either way.
 */
export async function undoCompletion(port: CompletionPort, written: ToggleDoneResult): Promise<void> {
  if (written.next !== null) {
    const nextId = written.next.id;
    const stillThere = (await port.listAll()).some((task) => task.id === nextId);
    if (stillThere) await port.remove(nextId);
  }
  await port.toggleDone(written.task.id);
}

/**
 * Re-apply one completion. Both directions of `toggleDone` are replayed by
 * re-running it: a done recurring row reopens in place (`next` is null), and an
 * open one ticks and detaches the following occurrence again.
 */
export async function redoCompletion(port: CompletionPort, written: ToggleDoneResult): Promise<void> {
  await port.toggleDone(written.task.id);
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
  const undo = useUndoOptional();
  const { t: tMisc } = useTranslation('misc');

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

  /**
   * Flip a task's completion.
   *
   * `source` decides whether the change is *announced*. Ticking the checkbox
   * is a deliberate act, so a six-second undo banner on every tick would be
   * noise over the list the user is still reading. A row-body click lands on a
   * large target that is easy to hit by accident, so that path does show the
   * banner — it is the one that needs a visible way back. Both are recorded on
   * the undo stack either way; only the announcement differs.
   */
  const toggleDone = useCallback(
    (id: TaskId, title: string, source: 'checkbox' | 'row' = 'checkbox') => {
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
          // The authoritative row. A recurring completion also returns the
          // next occurrence, which is a separate row the reload will pick up;
          // only the toggled row is overlaid. (The row's animation flag is
          // already keyed on this id, so it stays with the row that was
          // clicked — not the new one.)
          setPending((prev) => new Map(prev).set(id, written.task));
          bump();
          state.reload();
          // Every toggle is undoable; only the row-click path announces itself.
          // A recurring completion spawns a second row, so its inverse is
          // "delete that row, reopen this one" rather than another toggle.
          undo?.push({
            label: goingDone
              ? tMisc('toast.completed', { title })
              : tMisc('toast.reopened', { title }),
            silent: source === 'checkbox',
            undo: async () => {
              await undoCompletion(tasks, written);
              bump();
              state.reload();
            },
            redo: async () => {
              await redoCompletion(tasks, written);
              bump();
              state.reload();
            },
          });
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
    [bump, markFresh, notify, state, tasks, tMisc, undo],
  );

  return { ...state, data, mutate, toggleDone, fresh };
}
