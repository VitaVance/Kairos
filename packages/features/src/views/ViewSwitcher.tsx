import { useMemo } from 'react';
import { SegmentedControl, ViewSwitcherPill, useTranslation } from '@todolist/ui';

export type ViewKind = 'quadrant' | 'month' | 'week' | 'day' | 'agenda' | 'year' | 'multi-day' | 'multi-week';

export interface ViewSwitcherProps {
  value: ViewKind;
  onChange: (value: ViewKind) => void;
  variant?: 'segmented' | 'pill';
  /** Only used by the pill variant — the CTA on the right end. */
  cta?: { label: string; onClick: () => void };
}

/**
 * The eight destinations, in the order they appear in both variants.
 *
 * Labels are resolved from the catalog inside the component rather than being
 * baked into a module-level table: a `const` evaluated at import time cannot
 * follow a language change, so the switcher would have stayed Chinese in an
 * English UI — which is exactly what happened before this moved here.
 */
const VIEWS: readonly ViewKind[] = [
  'quadrant',
  'month',
  'week',
  'day',
  'agenda',
  'multi-day',
  'multi-week',
  'year',
];

/**
 * Compact segmented variant. It renders every view, so the highlighted segment
 * always names what is actually on screen — an earlier version sliced the list
 * to five and snapped year/multi-* views to a lit 月视图.
 */
export function ViewSwitcher({ value, onChange, variant = 'segmented', cta }: ViewSwitcherProps) {
  const { t } = useTranslation('misc');
  const options = useMemo(
    () => VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) })),
    [t],
  );

  if (variant === 'pill') {
    // No `caption`: the design's mockup note would be false here — this app
    // shows the user's real tasks, not sample data.
    return (
      <ViewSwitcherPill
        items={options}
        value={value}
        onChange={(v) => onChange(v as ViewKind)}
        cta={cta}
      />
    );
  }

  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      size="sm"
      ariaLabel={t('views.switcherLabel')}
    />
  );
}
