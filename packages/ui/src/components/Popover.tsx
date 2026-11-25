import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Rendered inside the panel. */
  children: ReactNode;
  /** Returns the element the panel should sit near. */
  anchorRef: React.RefObject<HTMLElement | null>;
  width?: number;
  align?: 'start' | 'end';
}

/**
 * Minimal anchored popover: Escape + outside-click close, focus moved in on
 * open and restored on close. Positioned with fixed coords measured from the
 * anchor, so it escapes overflow:hidden ancestors.
 */
export function Popover({ open, onClose, children, anchorRef, width = 260, align = 'start' }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  // The host usually passes an inline arrow (`onClose={() => setOpen(false)}`),
  // whose identity changes on every render. Reading it through a ref keeps the
  // open/close effect below keyed on `open` alone — otherwise every re-render
  // (e.g. choosing a theme palette) tore the effect down and restored focus to
  // the trigger mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    // Fixed coordinates are measured once; re-measure when the anchor moves
    // (window resize, or scrolling a dialog that hosts the trigger) so the
    // panel never detaches from what it points at.
    const position = () => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;
      const r = anchor.getBoundingClientRect();
      const left = align === 'end' ? r.right - width : r.left;
      panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
      // Flip above the anchor when there is not enough room below, otherwise
      // clamp so a tall panel still ends inside the viewport.
      const height = panel.offsetHeight;
      const below = window.innerHeight - (r.bottom + 6);
      if (height > below && r.top - 6 > below) {
        panel.style.top = `${Math.max(8, r.top - 6 - height)}px`;
      } else {
        panel.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - height - 8))}px`;
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', position);
    // Capture phase sees scrolls inside nested scrollers too.
    document.addEventListener('scroll', position, true);

    position();
    panelRef.current
      ?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      previous?.focus?.();
    };
    // `onClose` intentionally read through a ref (see above).
  }, [open, anchorRef, width, align]);

  if (!open) return null;

  return (
    <div ref={panelRef} id={id} className="tl-popover" role="dialog" aria-modal="false" style={{ width }}>
      {children}
    </div>
  );
}
