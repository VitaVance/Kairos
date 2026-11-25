import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { ChevronDownIcon } from '../icons';

export interface CollapsibleSectionProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Rendered after the list, e.g. a 查看更多 link. */
  footer?: ReactNode;
}

/**
 * Disclosure pattern using a real <button> with aria-expanded / aria-controls,
 * so screen readers announce state and the region is reachable.
 */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
  footer,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="tl-collapse">
      <button
        type="button"
        className="tl-collapse__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDownIcon size={14} className={`tl-collapse__chev${open ? '' : ' tl-collapse__chev--closed'}`} />
        <span className="tl-collapse__title">{title}</span>
        {typeof count === 'number' ? <span className="tl-collapse__count">{count}</span> : null}
      </button>
      {open ? (
        <div className="tl-collapse__panel" id={panelId}>
          {children}
          {footer ? <div className="tl-collapse__footer">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
