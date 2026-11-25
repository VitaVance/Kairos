import { useTranslation } from 'react-i18next';

export interface ViewSwitcherItem {
  value: string;
  label: string;
}

export interface ViewSwitcherPillProps {
  items: readonly ViewSwitcherItem[];
  value: string;
  onChange: (value: string) => void;
  /** Optional accent CTA rendered at the right end (e.g. 立即升级). */
  cta?: { label: string; onClick: () => void };
  caption?: string;
  /** Accessible name for the group; defaults to the translated "Switch view". */
  ariaLabel?: string;
}

/**
 * Floating bottom-center view switcher. Presentational only — the app decides
 * which view each item maps to.
 *
 * These are toggle buttons, not ARIA tabs: the surrounding content is replaced,
 * but there is no tabpanel relationship to maintain (no `aria-controls`, no
 * roving tabindex, no arrow-key paging). `aria-pressed` says exactly what the
 * button does; `role="tab"` without those would promise keyboard behaviour this
 * control does not have.
 */
export function ViewSwitcherPill({ items, value, onChange, cta, caption, ariaLabel }: ViewSwitcherPillProps) {
  const { t } = useTranslation('common');
  return (
    <div className="tl-pill-wrap">
      <div className="tl-pill" role="group" aria-label={ariaLabel ?? t('a11y.switchView')}>
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              className={`tl-pill__item${active ? ' tl-pill__item--active' : ''}`}
              onClick={() => onChange(item.value)}
            >
              {item.label}
            </button>
          );
        })}
        {cta ? (
          <button type="button" className="tl-pill__cta" onClick={cta.onClick}>
            {cta.label}
          </button>
        ) : null}
      </div>
      {caption ? <p className="tl-pill__caption">{caption}</p> : null}
    </div>
  );
}
