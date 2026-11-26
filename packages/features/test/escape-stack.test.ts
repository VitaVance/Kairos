import { describe, expect, it } from 'vitest';
import { createEscapeStack, escapeStack } from '../src/shortcuts/useShortcuts.js';

describe('createEscapeStack', () => {
  it('is empty initially', () => {
    const stack = createEscapeStack();
    expect(stack.topmost()).toBeNull();
    expect(stack.isTopmost('search')).toBe(false);
  });

  it('gives Escape to the most recently pushed layer', () => {
    const stack = createEscapeStack();
    stack.push('detail');
    expect(stack.isTopmost('detail')).toBe(true);

    stack.push('search');
    expect(stack.isTopmost('search')).toBe(true);
    // The lower layer must not act: this is the bug where Escape closed the
    // detail panel while the search palette was open on top of it.
    expect(stack.isTopmost('detail')).toBe(false);
    expect(stack.topmost()).toBe('search');
  });

  it('hands Escape back to the lower layer when the top one pops', () => {
    const stack = createEscapeStack();
    stack.push('detail');
    stack.push('search');
    stack.pop('search');
    expect(stack.isTopmost('detail')).toBe(true);
    expect(stack.topmost()).toBe('detail');
  });

  it('supports out-of-order pops without stranding the stack', () => {
    const stack = createEscapeStack();
    stack.push('detail');
    stack.push('composer');
    stack.push('search');

    // The middle layer closes first (e.g. focus moved and a parent unmounted).
    stack.pop('composer');
    expect(stack.topmost()).toBe('search');
    expect(stack.isTopmost('detail')).toBe(false);

    stack.pop('search');
    expect(stack.topmost()).toBe('detail');
  });

  it('treats popping a layer that is not on the stack as a no-op', () => {
    const stack = createEscapeStack();
    stack.push('detail');
    expect(() => stack.pop('search')).not.toThrow();
    expect(stack.isTopmost('detail')).toBe(true);
  });

  it('re-promotes an already-open layer on a second push', () => {
    const stack = createEscapeStack();
    stack.push('detail');
    stack.push('search');
    // Reopening the detail sheet above search moves it to the top exactly once.
    stack.push('detail');
    expect(stack.topmost()).toBe('detail');
    stack.pop('detail');
    // No duplicate `detail` entry left behind to become topmost again.
    expect(stack.topmost()).toBe('search');
    stack.pop('search');
    expect(stack.topmost()).toBeNull();
  });

  it('is empty again after every layer closes, so Escape is free', () => {
    const stack = createEscapeStack();
    stack.push('a');
    stack.push('b');
    stack.pop('b');
    stack.pop('a');
    expect(stack.topmost()).toBeNull();
    expect(stack.isTopmost('a')).toBe(false);
    expect(stack.isTopmost('b')).toBe(false);
  });

  it('can be cleared for a full teardown', () => {
    const stack = createEscapeStack();
    stack.push('a');
    stack.push('b');
    stack.clear();
    expect(stack.topmost()).toBeNull();
  });

  it('keeps independent stacks independent (one per owner, not shared)', () => {
    const a = createEscapeStack();
    const b = createEscapeStack();
    a.push('search');
    expect(a.isTopmost('search')).toBe(true);
    expect(b.isTopmost('search')).toBe(false);
  });
});

describe('escapeStack (the app-wide instance)', () => {
  it('exists and behaves like any other stack', () => {
    // The singleton is shared by overlays; other tests must not leave it dirty,
    // so this one restores it itself.
    escapeStack.push('__test__');
    expect(escapeStack.isTopmost('__test__')).toBe(true);
    escapeStack.pop('__test__');
    expect(escapeStack.isTopmost('__test__')).toBe(false);
  });
});
