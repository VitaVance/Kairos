import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface EmptyStateProps {
  message?: string;
  hint?: string;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ message, hint, icon, compact = false }: EmptyStateProps) {
  const { t } = useTranslation('common');
  // Callers that already pass a translated message win; the default is a key so
  // the component has no hardcoded Chinese that escapes localization.
  return (
    <div className={`tl-empty${compact ? ' tl-empty--compact' : ''}`} role="status">
      {icon ? <div className="tl-empty__icon">{icon}</div> : null}
      <p className="tl-empty__msg">{message ?? t('empty.noTasks')}</p>
      {hint ? <p className="tl-empty__hint">{hint}</p> : null}
    </div>
  );
}
