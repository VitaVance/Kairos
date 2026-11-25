import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  /**
   * Extra class on the group element, for the rare caller whose container is
   * narrow enough that the items need a different layout (see the 2×2 quadrant
   * picker in the task panel). Layout only — a caller must not restyle the
   * items themselves, or the control stops looking like one control.
   */
  className?: string;
}

/**
 * Radio-group semantics with arrow-key navigation. Roving tabindex so the
 * control is a single Tab stop, as native radio groups behave.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const { t } = useTranslation('common');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    const opt = options[next];
    if (!opt) return;
    onChange(opt.value);
    refs.current[next]?.focus();
  };

  return (
    <div className={`tl-seg tl-seg--${size}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={ariaLabel ?? t('a11y.switch')}>
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`tl-seg__item${active ? ' tl-seg__item--active' : ''}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
