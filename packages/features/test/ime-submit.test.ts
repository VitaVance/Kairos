import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { handleTextFieldKeyDown, isImeComposing, isSubmitEnter } from '@todolist/ui';

/**
 * Fake keydown sources, shaped like a native KeyboardEvent. `nativeEvent` lets
 * the same object stand in for React's synthetic wrapper, whose `isComposing`
 * lives only on the native event.
 */
function nativeEvent(init: { key: string; isComposing?: boolean; keyCode?: number }): KeyboardEvent {
  return {
    key: init.key,
    isComposing: init.isComposing ?? false,
    keyCode: init.keyCode ?? 0,
  } as unknown as KeyboardEvent;
}

function reactEvent(init: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}): ReactKeyboardEvent<HTMLInputElement> & {
  preventDefault: ReturnType<typeof vi.fn>;
  preventCount: () => number;
} {
  const native = nativeEvent({ key: init.key, isComposing: init.isComposing, keyCode: init.keyCode });
  let prevented = init.defaultPrevented ?? false;
  const preventDefault = vi.fn(() => {
    prevented = true;
  });
  return {
    key: init.key,
    nativeEvent: native,
    target: init.target ?? null,
    preventDefault,
    get defaultPrevented() {
      return prevented;
    },
    preventCount: () => preventDefault.mock.calls.length,
  } as unknown as ReactKeyboardEvent<HTMLInputElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
    preventCount: () => number;
  };
}

describe('isSubmitEnter', () => {
  it('rejects an Enter that is confirming an IME candidate', () => {
    expect(isSubmitEnter(nativeEvent({ key: 'Enter', isComposing: true }))).toBe(false);
  });

  it('accepts a plain Enter', () => {
    expect(isSubmitEnter(nativeEvent({ key: 'Enter' }))).toBe(true);
  });

  it('rejects the legacy keyCode 229 "process" keydown', () => {
    // Some engines report the IME keydown before `isComposing` flips.
    expect(isSubmitEnter(nativeEvent({ key: 'Enter', keyCode: 229 }))).toBe(false);
  });

  it('rejects non-Enter keys', () => {
    expect(isSubmitEnter(nativeEvent({ key: 'a' }))).toBe(false);
  });

  it('reads isComposing from a React synthetic event’s nativeEvent', () => {
    expect(isSubmitEnter(reactEvent({ key: 'Enter', isComposing: true }))).toBe(false);
    expect(isSubmitEnter(reactEvent({ key: 'Enter', isComposing: false }))).toBe(true);
  });
});

describe('isImeComposing', () => {
  it('is true while a composition is active, regardless of key', () => {
    expect(isImeComposing(nativeEvent({ key: 'ArrowDown', isComposing: true }))).toBe(true);
  });

  it('is true for keyCode 229', () => {
    expect(isImeComposing(nativeEvent({ key: 'ArrowUp', keyCode: 229 }))).toBe(true);
  });

  it('is false for ordinary navigation keys', () => {
    expect(isImeComposing(nativeEvent({ key: 'ArrowUp' }))).toBe(false);
  });
});

describe('TextField keydown merge semantics', () => {
  const base = { value: 'buy milk' };

  it('runs the caller handler then the built-in submit, both taking effect', () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn();
    const event = reactEvent({ key: 'Enter' });

    handleTextFieldKeyDown(event, { ...base, onSubmit, onKeyDown });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('buy milk');
    expect(event.preventCount()).toBe(1);
  });

  it('does not submit an IME-confirming Enter and does not cancel it', () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn();
    const event = reactEvent({ key: 'Enter', isComposing: true });

    handleTextFieldKeyDown(event, { ...base, onSubmit, onKeyDown });

    // The caller still sees the keydown (they may need it for their own logic)
    // — but nothing submits and the IME's candidate confirmation is not cancelled.
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.preventCount()).toBe(0);
  });

  it('lets the caller opt out of the built-in behaviour via preventDefault', () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn((e: ReactKeyboardEvent<HTMLInputElement>) => e.preventDefault());
    const event = reactEvent({ key: 'Enter' });

    handleTextFieldKeyDown(event, { ...base, onSubmit, onKeyDown });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Escape blurring when the caller does not claim it', () => {
    const blur = vi.fn();
    const target = { blur } as unknown as EventTarget;
    const event = reactEvent({ key: 'Escape', target });

    handleTextFieldKeyDown(event, { ...base });

    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('does not blur on an IME Escape (composition cancel belongs to the IME)', () => {
    const blur = vi.fn();
    const target = { blur } as unknown as EventTarget;
    const event = reactEvent({ key: 'Escape', isComposing: true, target });

    handleTextFieldKeyDown(event, { ...base });

    expect(blur).not.toHaveBeenCalled();
  });
});
