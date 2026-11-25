import type { InputHTMLAttributes } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
}

/**
 * Styled native checkbox — keeps real input semantics (space toggles, screen
 * readers announce checked state, form participation) with a custom square
 * drawn on top.
 *
 * The visible square stays 15px; the input itself is the hit target and is
 * enlarged to 32×32 (fine pointer) / 44×44 (coarse pointer) by CSS. Callers
 * always pass an `aria-label`/`aria-labelledby` describing the action.
 */
export function Checkbox({ checked, onChange, indeterminate = false, className = '', ...rest }: CheckboxProps) {
  return (
    <span className="tl-checkbox">
      <input
        type="checkbox"
        className={`tl-checkbox__input ${className}`.trim()}
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="tl-checkbox__box" aria-hidden="true">
        <svg viewBox="0 0 12 12" className="tl-checkbox__tick">
          <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
        </svg>
        <span className="tl-checkbox__dash" />
      </span>
    </span>
  );
}
