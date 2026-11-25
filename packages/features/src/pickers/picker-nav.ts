import type { KeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // Skip anything hidden (e.g. a collapsed section) but never the active node.
    (el) => el === document.activeElement || el.offsetParent !== null,
  );
}

/**
 * Keep Tab / Shift+Tab inside the popover for as long as it is open.
 *
 * The shared `Popover` handles Escape, outside clicks and focus restore, but
 * intentionally does not trap Tab. Each picker wraps its body in a single
 * element with this handler so it stays a complete dialog.
 */
export function trapTabKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const container = event.currentTarget;
  const items = focusableWithin(container);
  if (items.length === 0) return;

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && (active === first || active === null || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  }
}

/**
 * Roving focus inside a vertical list of buttons (the time columns).
 * Arrow keys / Home / End move focus without selecting.
 */
export function moveListFocus(event: KeyboardEvent<HTMLElement>): void {
  const { key } = event;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  if (buttons.length === 0) return;
  const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
  let next = current;
  if (key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
  else if (key === 'ArrowUp') next = Math.max(0, current - 1);
  else if (key === 'Home') next = 0;
  else next = buttons.length - 1;
  event.preventDefault();
  buttons[next]?.focus();
}
