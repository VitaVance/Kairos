import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface RailButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name. Also the visible tooltip text. */
  label: string;
  /** Optional chord shown at the end of the tooltip, e.g. "Ctrl+K". */
  shortcut?: string;
  /** Marks the current page; derives `aria-current` and the active styling. */
  active?: boolean;
  children: ReactNode;
}

/**
 * One button on the navigation rail.
 *
 * Two things were wrong when the rail grew: the top four entries were handwritten
 * `<button>`s with an `aria-label` and nothing else, while the bottom three used
 * `<IconButton>` and therefore got the browser's `title`. Whether a rail item
 * told you what it was depended on which component it happened to use.
 *
 * This replaces both, so every item behaves the same:
 *   - a real tooltip on hover AND on keyboard focus (native `title` does neither
 *     reliably: it needs a ~1s dwell and never fires for keyboard users);
 *   - the shortcut in the tooltip, since a hidden chord nobody can discover is
 *     a chord only its author uses.
 *
 * The tooltip is a `role="tooltip"` span owned by `aria-describedby`, not
 * `aria-labelledby`: the button already has an accessible name from `label`, and
 * pointing the name at the tooltip too would make a screen reader read the text
 * twice. The visible copy is `aria-hidden` for the same reason — the name is
 * already announced; only the shortcut adds anything, and that is the part left
 * exposed.
 */
export function RailButton({ label, shortcut, active = false, children, className = '', ...rest }: RailButtonProps) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // 300ms in, so sweeping the pointer down a column of 36px squares does not
  // flash seven tooltips. No delay out: the tip closes on leave/blur at once.
  const show = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), 300);
  }, [clear]);

  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  return (
    <span className="side-rail__slot">
      <button
        type="button"
        className={`side-rail__item${active ? ' side-rail__item--active' : ''} ${className}`.trim()}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        aria-describedby={open ? tipId : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Escape dismisses a tooltip without activating the button, per
        // WCAG 1.4.13 (content on hover must be dismissable).
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            hide();
          }
          rest.onKeyDown?.(event);
        }}
        {...rest}
      >
        {children}
      </button>
      <span className="side-rail__tip" id={tipId} role="tooltip" data-open={open}>
        <span aria-hidden="true">{label}</span>
        {shortcut === undefined ? null : <kbd>{shortcut}</kbd>}
      </span>
    </span>
  );
}
