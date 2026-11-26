import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react';
import { Button, useTranslation } from '@todolist/ui';
import { useBumpRevision } from '../services';
import { DEFAULT_UNDO_LIMIT, createUndoStack } from './undo-stack';
import type { UndoCommand, UndoStack } from './undo-stack';
import './undo.css';

export type { UndoCommand, UndoStack } from './undo-stack';

const TOAST_DURATION_MS = 6000;

export interface UndoContextValue {
  /** Record an action that can be undone. A new push clears the redo stack. */
  push(command: UndoCommand): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /**
   * Drop every pending command. Call after a bulk write (e.g. a `replace`
   * import) whose rows the old commands can no longer address safely.
   */
  clear(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

const UndoContext = createContext<UndoContextValue | null>(null);

interface ToastState {
  readonly id: number;
  readonly label: string;
  /** False for informational notices (e.g. a failed optimistic write). */
  readonly undoable: boolean;
  /**
   * Optional second action, offered next to Undo. A completion uses it to end
   * a repeating series without leaving the list: the toast is already the
   * place that reports what a tick did, so it is where "and stop repeating"
   * belongs.
   */
  readonly action?: {
    readonly label: string;
    readonly run: () => void | Promise<void>;
  };
}

/** Show a transient notice without offering undo. No-op outside the provider. */
const ToastContext = createContext<((label: string) => void) | null>(null);

const NOOP_NOTIFY = () => {};

/**
 * Show a notice that also carries one extra action. Optional provider, like
 * `useToast`: outside it the call degrades to nothing rather than throwing.
 */
const ToastActionContext = createContext<
  ((label: string, action: NonNullable<ToastState['action']>) => void) | null
>(null);

export interface UndoProviderProps {
  children: ReactNode;
  /** Stack cap; defaults to 50. */
  max?: number;
}

/**
 * Undo/redo for accidental or destructive actions.
 *
 * Screens do the write, then `push({ label, undo, redo })` with the inverse
 * work. The provider owns the two stacks and the confirmation toast; after an
 * undo/redo it bumps the shared revision so every visible screen refetches.
 *
 * Mount inside `AppServicesProvider` — it needs the revision context.
 */
export function UndoProvider({ children, max = DEFAULT_UNDO_LIMIT }: UndoProviderProps) {
  const { t } = useTranslation('misc');
  const bump = useBumpRevision();
  const [stack] = useState<UndoStack>(() => createUndoStack(max));
  const [flags, setFlags] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
  });
  const [toast, setToast] = useState<ToastState | null>(null);

  const toastId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const remainingRef = useRef(TOAST_DURATION_MS);
  const pausedRef = useRef(false);
  /**
   * One undo/redo in flight at a time. The stack awaits a command *before* it
   * moves off the stack, so a second Ctrl+Z landing during that await would run
   * the same command twice — and for a completion that means deleting the
   * occurrence the first run just re-created.
   */
  const busyRef = useRef(false);

  const syncFlags = useCallback(() => {
    setFlags({ canUndo: stack.canUndo, canRedo: stack.canRedo });
  }, [stack]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (deadlineRef.current !== null) {
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
      deadlineRef.current = null;
    }
  }, []);

  const armTimer = useCallback(() => {
    if (timerRef.current !== null || pausedRef.current) return;
    const ms = remainingRef.current;
    if (ms <= 0) {
      setToast(null);
      return;
    }
    deadlineRef.current = Date.now() + ms;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      deadlineRef.current = null;
      setToast(null);
    }, ms);
  }, []);

  const dismissToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const push = useCallback(
    (command: UndoCommand) => {
      stack.push(command);
      syncFlags();
      // A silent command is still undoable — it is only the announcement that
      // is skipped, so a deliberate tick never flashes a banner over the list.
      if (command.silent) return;
      clearTimer();
      remainingRef.current = TOAST_DURATION_MS;
      // `clearTimer` leaves `pausedRef` set; a fresh toast must arm its own
      // timer, or a new action shown while the pointer still hovers the old
      // toast's spot would never auto-dismiss.
      pausedRef.current = false;
      toastId.current += 1;
      setToast({ id: toastId.current, label: command.label, undoable: true });
      armTimer();
    },
    [armTimer, clearTimer, stack, syncFlags],
  );

  const notify = useCallback(
    (label: string) => {
      clearTimer();
      remainingRef.current = TOAST_DURATION_MS;
      pausedRef.current = false;
      toastId.current += 1;
      setToast({ id: toastId.current, label, undoable: false });
      armTimer();
    },
    [armTimer, clearTimer],
  );

  /**
   * The toast that reports a tick, with "stop repeating" next to Undo. Shown
   * even when the tick itself is silent: the caller only uses this for a
   * *recurring* completion, where not saying anything would hide the fact that
   * a second row now exists.
   */
  const notifyWithAction = useCallback(
    (label: string, action: NonNullable<ToastState['action']>) => {
      clearTimer();
      remainingRef.current = TOAST_DURATION_MS;
      pausedRef.current = false;
      toastId.current += 1;
      setToast({ id: toastId.current, label, undoable: true, action });
      armTimer();
    },
    [armTimer, clearTimer],
  );

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const command = await stack.undo();
      syncFlags();
      if (command) {
        bump();
        dismissToast();
      }
    } catch (error) {
      // The stack leaves a failed command in place; surface it without
      // turning a keyboard shortcut into an unhandled rejection.
      console.error('撤销失败', error);
      syncFlags();
    } finally {
      busyRef.current = false;
    }
  }, [bump, dismissToast, stack, syncFlags]);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const command = await stack.redo();
      syncFlags();
      if (command) {
        bump();
        dismissToast();
      }
    } catch (error) {
      console.error('重做失败', error);
      syncFlags();
    } finally {
      busyRef.current = false;
    }
  }, [bump, dismissToast, stack, syncFlags]);

  const clear = useCallback(() => {
    stack.clear();
    syncFlags();
    dismissToast();
  }, [dismissToast, stack, syncFlags]);

  // Timers must not outlive the provider.
  useEffect(() => () => clearTimer(), [clearTimer]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    // Hovering the toast may outlast the deadline. The stack still holds the
    // command (`canUndo`), so keep the toast up and let the button become the
    // undo affordance again rather than dismissing it under the pointer.
    if (remainingRef.current <= 0) remainingRef.current = TOAST_DURATION_MS;
    armTimer();
  }, [armTimer]);

  const onBlurToast = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) resume();
    },
    [resume],
  );

  const onUndoClick = useCallback(() => {
    void undo();
  }, [undo]);

  const onToastAction = useCallback(() => {
    const action = toast?.action;
    if (!action) return;
    dismissToast();
    void Promise.resolve(action.run()).catch((error: unknown) => {
      console.error('提示操作失败', error);
    });
  }, [dismissToast, toast]);

  const value = useMemo<UndoContextValue>(
    () => ({ push, undo, redo, clear, canUndo: flags.canUndo, canRedo: flags.canRedo }),
    [push, undo, redo, clear, flags],
  );

  return (
    <UndoContext.Provider value={value}>
      <ToastContext.Provider value={notify}>
        <ToastActionContext.Provider value={notifyWithAction}>
          {children}
          {toast ? (
            <div
              key={toast.id}
              className={`undo-toast${toast.undoable ? '' : ' undo-toast--notice'}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              onMouseEnter={pause}
              onMouseLeave={resume}
              onFocus={pause}
              onBlur={onBlurToast}
            >
              <span className="undo-toast__label">{toast.label}</span>
              {toast.action ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="undo-toast__action"
                  onClick={onToastAction}
                >
                  {toast.action.label}
                </Button>
              ) : null}
              {toast.undoable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="undo-toast__action"
                  // The toast can outlive a successful undo elsewhere (another
                  // toast, a bulk import clearing the stack). Offering a button
                  // that silently does nothing is worse than hiding it.
                  disabled={!flags.canUndo}
                  onClick={onUndoClick}
                >
                  {t('undo.action')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </ToastActionContext.Provider>
      </ToastContext.Provider>
    </UndoContext.Provider>
  );
}

/** Access the undo stack. Must be used inside `<UndoProvider>`. */
export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error('useUndo 必须在 <UndoProvider> 内使用');
  return ctx;
}

/**
 * Access the undo stack when one may not be mounted (a feature screen rendered
 * standalone in a test or storybook). Returns `null` instead of throwing.
 */
export function useUndoOptional(): UndoContextValue | null {
  return useContext(UndoContext);
}

/**
 * Transient, non-undoable notice through the same toast slot as undo.
 * Returns a stable no-op when no provider is mounted, so optimistic writes
 * can report failures from tests and storybook without extra wiring.
 */
export function useToast(): (label: string) => void {
  return useContext(ToastContext) ?? NOOP_NOTIFY;
}

/**
 * A notice with one extra action next to Undo. Returns a no-op outside a
 * provider, so screens can report from tests without extra wiring.
 */
export function useToastAction(): (label: string, action: NonNullable<ToastState['action']>) => void {
  return useContext(ToastActionContext) ?? NOOP_NOTIFY;
}
