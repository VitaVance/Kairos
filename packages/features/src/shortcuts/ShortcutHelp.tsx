import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from '@todolist/ui';
import { formatBinding, isEditableTarget, useSequencePending } from './useShortcuts';
import './shortcuts.css';

export interface ShortcutHelpItem {
  /** Binding syntax, e.g. `mod+k` or `g q`. */
  readonly binding: string;
  /** What the shortcut does, in the UI's language. */
  readonly label: string;
}

export interface ShortcutHelpProps {
  /** Controlled visibility. Omit to let the component own it (opens on `?`). */
  open?: boolean;
  /** Required alongside `open` when controlled. */
  onClose?: () => void;
  /** Override the default cheat-sheet; order is preserved across columns. */
  items?: readonly ShortcutHelpItem[];
}

/**
 * The bindings are fixed; only their descriptions change with the language.
 * Kept as a binding list here and resolved through the catalog in the
 * component so the sheet follows a language switch made while it is open.
 */
/**
 * The bindings are fixed; only their descriptions change with the language.
 *
 * Full catalog paths rather than a bare suffix: the typed `t()` accepts only
 * literal keys, so `t('shortcuts.' + b.key)` would fail to type-check — which
 * is the point. Spelling each path out means a renamed catalog key breaks the
 * build instead of rendering the raw key to the user.
 */
/**
 * The cheat-sheet's rows. Every binding the shell registers must appear here
 * and nothing else may: the sheet is the single promise the app makes about
 * keys. `default-shortcuts.test.ts` holds the two to each other.
 */
export const DEFAULT_SHORTCUT_BINDINGS: readonly {
  binding: string;
  labelKey:
    | 'shortcuts.search'
    | 'shortcuts.help'
    | 'shortcuts.undo'
    | 'shortcuts.redo'
    | 'shortcuts.quadrant'
    | 'shortcuts.month'
    | 'shortcuts.week'
    | 'shortcuts.day'
    | 'shortcuts.agenda'
    | 'shortcuts.settings'
    | 'shortcuts.close';
}[] = [
  // Both conventional chords open search; users arrive with either habit.
  { binding: 'mod+f', labelKey: 'shortcuts.search' },
  { binding: 'mod+k', labelKey: 'shortcuts.search' },
  { binding: '?', labelKey: 'shortcuts.help' },
  { binding: 'mod+z', labelKey: 'shortcuts.undo' },
  { binding: 'mod+shift+z', labelKey: 'shortcuts.redo' },
  // The 设置 dialog. Registered in Shell.tsx alongside the entries below.
  { binding: 'mod+,', labelKey: 'shortcuts.settings' },
  { binding: 'g q', labelKey: 'shortcuts.quadrant' },
  { binding: 'g m', labelKey: 'shortcuts.month' },
  { binding: 'g w', labelKey: 'shortcuts.week' },
  { binding: 'g d', labelKey: 'shortcuts.day' },
  { binding: 'g a', labelKey: 'shortcuts.agenda' },
  { binding: 'escape', labelKey: 'shortcuts.close' },
];


/**
 * Which sequences start with this prefix, for the visible pending hint.
 */
function sequencesStartingWith(
  items: readonly ShortcutHelpItem[],
  prefix: readonly string[],
): readonly ShortcutHelpItem[] {
  return items.filter((item) => {
    const steps = item.binding.trim().split(/\s+/);
    return (
      steps.length > prefix.length &&
      prefix.every((key, index) => steps[index]?.toLowerCase() === key.toLowerCase())
    );
  });
}

/** The second-key label of a two-step binding: `g q` → `Q`. */
function finalKeyLabel(binding: string): string {
  const formatted = formatBinding(binding).split(' ');
  return formatted[formatted.length - 1] ?? '';
}

/**
 * Non-modal status hint shown while a sequence waits for its second key.
 *
 * Lives outside the modal cheat-sheet so it is visible whenever a sequence is
 * pending. It is a `role="status"` region rather than a dialog: it must never
 * take focus or intercept Escape, and its appearance is the feedback a sighted
 * user gets — before this existed, pressing `g` changed nothing on screen for
 * a full second.
 *
 * Wordless by design: the prefix and the valid next keys are already the
 * message, and every label here is either a key glyph or an existing catalog
 * string (as the option chips' `title`), so this needs no new translation key.
 * `ShortcutHelp` is mounted for the whole app session by the shell, so the hint
 * needs no host wiring; a host without it can use `onSequencePending`.
 */
function SequenceHint() {
  const { t } = useTranslation('misc');
  const pending = useSequencePending();
  const options = useMemo(
    () =>
      sequencesStartingWith(
        DEFAULT_SHORTCUT_BINDINGS.map((b) => ({ binding: b.binding, label: t(b.labelKey) })),
        pending ?? [],
      ),
    [pending, t],
  );
  if (pending === null || pending.length === 0) return null;

  return (
    <div className="sc-seq" role="status" aria-live="polite">
      <kbd className="sc-seq__prefix">{pending.map((k) => k.toUpperCase()).join(' ')}</kbd>
      <span className="sc-seq__sep" aria-hidden="true">
        →
      </span>
      <span className="sc-seq__options">
        {options.map((option) => (
          <kbd key={option.binding} className="sc-seq__kbd" title={option.label}>
            {finalKeyLabel(option.binding)}
          </kbd>
        ))}
      </span>
    </div>
  );
}

/**
 * Modal cheat-sheet built on the native `<dialog>`, so focus trapping,
 * Escape-to-close and the backdrop come from the platform.
 *
 * Uncontrolled by default: render it once anywhere in the tree and it opens on
 * `?`. Pass `open` + `onClose` to drive it from outside instead.
 */
export function ShortcutHelp({ open: controlledOpen, onClose, items }: ShortcutHelpProps) {
  const { t } = useTranslation('misc');
  // Resolve the default cheat-sheet in the active language. Building it at
  // module scope would freeze whichever language was active at import time.
  const resolvedItems = useMemo<readonly ShortcutHelpItem[]>(
    () =>
      items ??
      DEFAULT_SHORTCUT_BINDINGS.map((b) => ({
        binding: b.binding,
        label: t(b.labelKey),
      })),
    [items, t],
  );
  const controlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlled ? controlledOpen : internalOpen;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    if (controlled) onClose?.();
    else setInternalOpen(false);
  }, [controlled, onClose]);

  // Only bound in uncontrolled mode, so it always targets internal state.
  const toggle = useCallback(() => setInternalOpen((value) => !value), []);

  // Capture phase so `?` still opens the sheet even if another shortcut
  // handler ran first (it sees the event before any bubble-phase listener).
  // The same guards the shared hook applies (`useShortcuts.ts`): an event that
  // another handler already claimed, an IME composition, and auto-repeat from
  // a held key must not toggle the sheet. Composition matters most here — a
  // Chinese IME buffers keys and can emit `?` while the candidate window is
  // up, where it belongs to the IME, not to this shortcut.
  useEffect(() => {
    if (controlled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [controlled, toggle]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Backdrop click: the dialog element itself receives the click, while
  // clicks inside the panel target its children.
  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) close();
    },
    [close],
  );

  // `cancel` fires on Escape; the native close then dispatches `close`, which
  // routes back to the host. Don't preventDefault or the tag stays open.
  const onCancel = useCallback(() => close(), [close]);

  return (
    <>
      <SequenceHint />
      <dialog
        ref={dialogRef}
        className="sc-help"
        aria-labelledby={titleId}
        onClick={onClick}
        onCancel={onCancel}
        onClose={close}
      >
        <div className="sc-help__panel">
          <header className="sc-help__head">
            <h2 className="sc-help__title" id={titleId}>
              {t('shortcuts.title')}
            </h2>
            <span className="sc-help__hint" aria-hidden="true">
              {t('shortcuts.close')}
            </span>
          </header>
          <ul className="sc-help__list">
            {resolvedItems.map((item) => (
              <li className="sc-help__item" key={`${item.binding}:${item.label}`}>
                <span className="sc-help__label">{item.label}</span>
                <kbd className="sc-help__kbd">{formatBinding(item.binding)}</kbd>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
