import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
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

export const DEFAULT_SHORTCUT_ITEMS: readonly ShortcutHelpItem[] = [
  { binding: 'mod+k', label: '搜索' },
  { binding: '?', label: '快捷键帮助' },
  { binding: 'mod+z', label: '撤销' },
  { binding: 'mod+shift+z', label: '重做' },
  { binding: 'g q', label: '四象限' },
  { binding: 'g m', label: '月视图' },
  { binding: 'g w', label: '周视图' },
  { binding: 'g d', label: '日视图' },
  { binding: 'g a', label: '日程视图' },
  { binding: 'escape', label: '关闭对话框' },
];

/**
 * Modal cheat-sheet built on the native `<dialog>`, so focus trapping,
 * Escape-to-close and the backdrop come from the platform.
 *
 * Uncontrolled by default: render it once anywhere in the tree and it opens on
 * `?`. Pass `open` + `onClose` to drive it from outside instead.
 */
export function ShortcutHelp({ open: controlledOpen, onClose, items = DEFAULT_SHORTCUT_ITEMS }: ShortcutHelpProps) {
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
            键盘快捷键
          </h2>
          <span className="sc-help__hint" aria-hidden="true">
            按 Esc 关闭
          </span>
        </header>
        <ul className="sc-help__list">
          {items.map((item) => (
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
