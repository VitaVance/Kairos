import type { ReactNode } from 'react';

export interface EmptyStateProps {
  message?: string;
  hint?: string;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ message = '没有任务', hint, icon, compact = false }: EmptyStateProps) {
  return (
    <div className={`tl-empty${compact ? ' tl-empty--compact' : ''}`} role="status">
      {icon ? <div className="tl-empty__icon">{icon}</div> : null}
      <p className="tl-empty__msg">{message}</p>
      {hint ? <p className="tl-empty__hint">{hint}</p> : null}
    </div>
  );
}
