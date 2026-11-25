import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId, useState } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onSubmit' | 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  leadingIcon?: ReactNode;
  label?: string;
}

export function TextField({
  value,
  onChange,
  onSubmit,
  leadingIcon,
  label,
  className = '',
  ...rest
}: TextFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  return (
    <div className={`tl-field${focused ? ' tl-field--focused' : ''} ${className}`.trim()}>
      {leadingIcon ? <span className="tl-field__icon">{leadingIcon}</span> : null}
      {label ? (
        <label className="tl-visually-hidden" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className="tl-field__input"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            e.preventDefault();
            onSubmit(value);
          }
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        {...rest}
      />
    </div>
  );
}
