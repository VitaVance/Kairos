import type { InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { isImeComposing, isSubmitEnter } from './ime';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onSubmit' | 'value' | 'onChange'
> {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  leadingIcon?: ReactNode;
  /**
   * Optional control rendered *inside* the field, after the input (e.g. a
   * pointer-accessible submit button). It is a real focusable control, unlike
   * `leadingIcon`, which is a decorative span.
   */
  trailing?: ReactNode;
  label?: string;
}

export interface TextFieldKeyDownContext {
  value: string;
  onSubmit?: (value: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/**
 * The single keydown pipeline for `TextField`, extracted so its merge
 * semantics can be unit-tested without a DOM.
 *
 * Merge semantics: the caller's `onKeyDown` runs **first**, then the built-in
 * Enter/Escape behaviour unless the caller called `preventDefault()`, at which
 * point `defaultPrevented` short-circuits the built-in path.
 *
 * Why external-first: it is the only ordering that lets a caller opt out, and
 * the callers that own Enter today (`TaskDetailPanel`, `SearchPanel`) already
 * express "I handle this key" by calling `preventDefault()`. Honouring that
 * signal keeps their behaviour intact while fixing the old bug where `{...rest}`
 * was spread *after* the internal handler, so passing `onKeyDown` silently
 * replaced the component's own submit/Escape logic entirely. Both handlers now
 * run by default; neither silently clobbers the other.
 */
export function handleTextFieldKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  { value, onSubmit, onKeyDown }: TextFieldKeyDownContext,
): void {
  onKeyDown?.(event);
  if (event.defaultPrevented) return;

  // An IME-confirming Enter belongs to the input method: neither submit nor
  // preventDefault (which would cancel candidate confirmation).
  if (onSubmit && isSubmitEnter(event)) {
    event.preventDefault();
    onSubmit(value);
  }
  if (event.key === 'Escape' && !isImeComposing(event)) {
    (event.target as HTMLInputElement).blur();
  }
}

export function TextField({
  value,
  onChange,
  onSubmit,
  leadingIcon,
  trailing,
  label,
  className = '',
  onKeyDown,
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
        onKeyDown={(e) => handleTextFieldKeyDown(e, { value, onSubmit, onKeyDown })}
        {...rest}
      />
      {/*
        Rendered as a sibling flex item so a pointer-accessible control (e.g. a
        submit button) can sit at the field's trailing edge. `.tl-field` is
        already `display: flex; align-items: center; gap: var(--tl-space-2)`,
        so this needs no new CSS — which matters because this component may not
        touch the stylesheet from the feature side.
      */}
      {trailing}
    </div>
  );
}

// Re-exported from this module (rather than requiring an explicit line in
// `src/index.tsx`, which star-exports this file) so feature screens can import
// the shared IME predicate from `@todolist/ui` — the only package-boundary
// import path the features package uses.
export { isImeComposing, isSubmitEnter } from './ime';
