import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './data-transfer.css';

/**
 * The repository's one correct destructive-confirmation shape (see
 * `docs/DESIGN-LANGUAGE.md` §5.4 and `docs/UI-AUDIT.md` §2.2-B).
 *
 * The wrong shape — an inline two-step block — caused a real data-loss incident
 * here: the trigger and the confirm button occupied the same screen position,
 * so one double-click cleared everything. The right shape is a separate native
 * `<dialog>` driven with `showModal()`:
 *
 * - the platform supplies the focus trap, Esc handling, `:modal` top layer and
 *   focus restoration to the trigger;
 * - Cancel takes focus on open, so a held Enter cannot confirm;
 * - the destructive button stays disabled for `armDelay` ms, so the gesture
 *   that opened the dialog (or a scripted click, or a keydown repeat) cannot
 *   also fire it;
 * - the destructive button sits at the end of a right-aligned row, so it never
 *   lands under the pointer that opened the dialog.
 *
 * Do not add `role="dialog"`, `aria-modal` or an Esc handler: the native
 * element already provides all three, and duplicating them is how the inline
 * versions drifted out of spec.
 */
export interface DestructiveConfirmProps {
  open: boolean;
  /** Close without acting. Also called when the user presses Esc. */
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  busyLabel?: string;
  /** Delay before the destructive button arms, ms. Default 600. */
  armDelay?: number;
}

/** 600ms: long enough to break the opening gesture, short enough to feel instant. */
export const DEFAULT_ARM_DELAY_MS = 600;

/**
 * Clamp a caller-supplied arm delay to something the scheduler can honour.
 *
 * `NaN` and non-positive values arm immediately (0). `Infinity` is preserved
 * and means "never arms" — useful for tests and for callers that want the
 * button permanently disabled while some other condition holds.
 */
export function armDelayMs(armDelay: number): number {
  if (Number.isNaN(armDelay) || armDelay <= 0) return 0;
  return armDelay;
}

/**
 * Whether the destructive action may fire `elapsedMs` after the dialog opened.
 *
 * Kept as a pure function so the timing rule has a test without a DOM: the
 * button is armed at exactly the delay, never one tick early.
 */
export function shouldArm(elapsedMs: number, armDelay: number): boolean {
  return elapsedMs >= armDelayMs(armDelay);
}

/** Monotonic clock where available; `Date.now()` as the fallback. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function DestructiveConfirm({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  busyLabel,
  armDelay = DEFAULT_ARM_DELAY_MS,
}: DestructiveConfirmProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [armed, setArmed] = useState(false);

  // Drive the native dialog imperatively — never render the `open` attribute.
  // `showModal()` gives the focus trap, Escape and `::backdrop`; `close()`
  // returns focus to whatever opened the dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    // The safe action holds focus, so a held Enter lands on Cancel.
    cancelRef.current?.focus();
    setArmed(false);

    const delay = armDelayMs(armDelay);
    const openedAt = now();
    let timer = window.setTimeout(function tick() {
      const elapsed = now() - openedAt;
      // Re-check instead of arming blindly: coarse timers may fire a tick
      // early, and the rule is "not before the delay", not "whenever the
      // timer fires". If early, wait out the remainder.
      if (shouldArm(elapsed, delay)) {
        setArmed(true);
        return;
      }
      timer = window.setTimeout(tick, Math.max(0, delay - elapsed));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [open, armDelay]);

  // Esc (and programmatic `close()`) do not go through React state, so mirror
  // them back. When `open` flips false the effect above calls `close()`, which
  // fires this too; `onCancel` is idempotent by contract.
  // Subscribe once and read the latest callback through a ref: `onCancel` is
  // usually an inline arrow, so keying the listener on it would tear it down
  // and re-add it every render for no behavioural gain.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      setArmed(false);
      onCancelRef.current();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dt-reset-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <h2 className="dt-reset-dialog__title" id={titleId}>
        {title}
      </h2>
      <div className="dt-reset-dialog__body" id={bodyId}>
        {body}
      </div>
      <div className="dt-reset-dialog__actions">
        {/* Cancel first, and focused on open: the safe action holds the
            Enter key too, so a held key cannot confirm. */}
        <button
          ref={cancelRef}
          type="button"
          className="dt-btn dt-btn--ghost dt-btn--sm"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        {/* Disabled until `armed`: the opening gesture (and a fast second
            click, or an automated one) cannot land on this button. */}
        <button
          type="button"
          className="dt-btn dt-btn--danger dt-btn--sm"
          disabled={!armed || busy}
          onClick={onConfirm}
        >
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
