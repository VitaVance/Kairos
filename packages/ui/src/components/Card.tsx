import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ title, actions, padded = true, interactive = false, className = '', children }: CardProps) {
  return (
    <section
      className={`tl-card${padded ? ' tl-card--padded' : ''}${interactive ? ' tl-card--interactive' : ''} ${className}`.trim()}
    >
      {title || actions ? (
        <header className="tl-card__head">
          {title ? <div className="tl-card__title">{title}</div> : null}
          {actions ? <div className="tl-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="tl-card__body">{children}</div>
    </section>
  );
}
