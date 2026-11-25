import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from '@todolist/ui';
import { formatBinding, isEditableTarget } from './useShortcuts';
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
    | 'shortcuts.close';
}[] = [
  // Both conventional chords open search; users arrive with either habit.
  { binding: 'mod+f', labelKey: 'shortcuts.search' },
  { binding: 'mod+k', labelKey: 'shortcuts.search' },
  { binding: '?', labelKey: 'shortcuts.help' },
  { binding: 'mod+z', labelKey: 'shortcuts.undo' },
  { binding: 'mod+shift+z', labelKey: 'shortcuts.redo' },
  { binding: 'g q', labelKey: 'shortcuts.quadrant' },
  { binding: 'g m', labelKey: 'shortcuts.month' },
  { binding: 'g w', labelKey: 'shortcuts.week' },
  { binding: 'g d', labelKey: 'shortcuts.day' },
  { binding: 'g a', labelKey: 'shortcuts.agenda' },
  { binding: 'escape', labelKey: 'shortcuts.close' },
];


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
  useEffect(() => {
    if (controlled) return;
    const onKeyDown = (event: KeyboardEvent) => {
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
  );
}
