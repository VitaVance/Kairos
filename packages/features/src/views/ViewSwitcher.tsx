import { SegmentedControl, ViewSwitcherPill } from '@todolist/ui';

export type ViewKind = 'quadrant' | 'month' | 'week' | 'day' | 'agenda' | 'year' | 'multi-day' | 'multi-week';

export interface ViewSwitcherProps {
  value: ViewKind;
  onChange: (value: ViewKind) => void;
  variant?: 'segmented' | 'pill';
  /** Only used by the pill variant — the 立即升级 CTA on the right end. */
  cta?: { label: string; onClick: () => void };
}

const OPTIONS: { value: ViewKind; label: string }[] = [
  { value: 'quadrant', label: '四象限' },
  { value: 'month', label: '月视图' },
  { value: 'week', label: '周视图' },
  { value: 'day', label: '日视图' },
  { value: 'agenda', label: '日程视图' },
  { value: 'multi-day', label: '多日视图' },
  { value: 'multi-week', label: '多周视图' },
  { value: 'year', label: '年视图' },
];

/**
 * Compact segmented variant. It renders every view, so the highlighted segment
 * always names what is actually on screen — an earlier version sliced the list
 * to five and snapped year/multi-* views to a lit 月视图.
 */
export function ViewSwitcher({ value, onChange, variant = 'segmented', cta }: ViewSwitcherProps) {
  if (variant === 'pill') {
    // No `caption`: the design's 「示例数据仅供参考」 is a mockup note. This app
    // shows the user's real tasks, so that line would be false.
    return <ViewSwitcherPill items={OPTIONS} value={value} onChange={(v) => onChange(v as ViewKind)} cta={cta} />;
  }

  return (
    <SegmentedControl options={OPTIONS} value={value} onChange={onChange} size="sm" ariaLabel="视图" />
  );
}
