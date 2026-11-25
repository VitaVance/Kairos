import type { HTMLAttributes } from 'react';

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  axis?: 'y' | 'x' | 'both';
}

/** Thin-scrollbar wrapper; styling lives in styles.css. */
export function ScrollArea({ axis = 'y', className = '', children, ...rest }: ScrollAreaProps) {
  return (
    <div className={`tl-scroll tl-scroll--${axis} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
