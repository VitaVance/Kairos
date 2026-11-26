import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * IME-safe keyboard predicates, shared by `TextField` and every screen that
 * owns its own `Enter` handling.
 *
 * A single-line `<input>` receives the same IME-confirming `Enter` keydown a
 * `<textarea>` does: the browser reports `key === 'Enter'` while the input
 * method is still composing, so a naive handler submits a half-finished title
 * the moment the user confirms a candidate.
 *
 * The official reference (`forms/ime-safe-enter-submit.md`) also requires the
 * legacy `keyCode === 229` check: some engines report the IME keydown before
 * `isComposing` flips, and Safari in particular can deliver them out of order.
 * WebView2 does not, but the check costs nothing and keeps this predicate
 * correct wherever it is reused.
 */

/** Structural subset shared by a native KeyboardEvent and React's synthetic one. */
interface ImeKeyLike {
  readonly key: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  /** React's synthetic event forwards the native one here. */
  readonly nativeEvent?: ImeKeyLike;
}

export type SubmitKeyEvent = KeyboardEvent | ReactKeyboardEvent;

/**
 * `isComposing` only exists on the *native* event in React's typings, and the
 * deprecated `keyCode` is owned by the browser, so both are read from the
 * native source rather than the synthetic wrapper.
 */
function sourceOf(event: SubmitKeyEvent): ImeKeyLike {
  const candidate = event as ImeKeyLike;
  return candidate.nativeEvent ?? candidate;
}

/** True while an IME is composing, or on the legacy 229 "process" keydown. */
export function isImeComposing(event: SubmitKeyEvent): boolean {
  const source = sourceOf(event);
  return source.isComposing === true || source.keyCode === 229;
}

/**
 * True when this keydown is a genuine submit gesture: an `Enter` that is not
 * the IME's candidate-confirmation. Direction keys need `isImeComposing`
 * directly — during composition they navigate the candidate list, not the
 * listbox.
 */
export function isSubmitEnter(event: SubmitKeyEvent): boolean {
  return event.key === 'Enter' && !isImeComposing(event);
}
