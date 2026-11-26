import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SequenceTracker,
  type SequencePressResult,
  type ShortcutKeyEvent,
} from '../src/shortcuts/useShortcuts.js';

function plain(key: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
}

function ctrl(key: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra };
}

/** Records which bindings fired; `press` reports, the caller runs. */
function recorder() {
  const calls: string[] = [];
  return { calls, action: (name: string) => () => calls.push(name) };
}

/** Mirror what `useShortcuts` does with a `matched` result. */
function runIfMatched(result: SequencePressResult): void {
  if (result.kind === 'matched') result.run();
}

function setup() {
  const { calls, action } = recorder();
  const tracker = new SequenceTracker({
    bindings: {
      'g q': action('g q'),
      'g m': action('g m'),
      'mod+z': action('mod+z'),
      'mod+shift+z': action('mod+shift+z'),
      '?': action('?'),
    },
    platform: 'other',
  });
  return { tracker, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SequenceTracker: two-key sequences', () => {
  it('fires `g q` when `q` arrives inside the window', () => {
    const { tracker, calls } = setup();
    const first = tracker.press('g', plain('g'));
    expect(first.kind).toBe('pending');
    expect(tracker.pending).toEqual(['g']);

    const second = tracker.press('q', plain('q'));
    expect(second).toMatchObject({ kind: 'matched', binding: 'g q' });
    runIfMatched(second);
    expect(calls).toEqual(['g q']);
    expect(tracker.pending).toBeNull();
  });

  it('does not fire after the window closes', () => {
    vi.useFakeTimers();
    const { tracker, calls } = setup();

    tracker.press('g', plain('g'));
    vi.advanceTimersByTime(999);
    expect(tracker.pending).toEqual(['g']);

    // The window expires: the prefix is dropped, and the late `q` is neither a
    // completion nor a fresh binding.
    vi.advanceTimersByTime(1);
    expect(tracker.pending).toBeNull();

    const late = tracker.press('q', plain('q'));
    expect(late).toMatchObject({ kind: 'ignored', cancelled: null });
    expect(calls).toEqual([]);
  });

  it('restarts the window on every advance of a longer prefix', () => {
    vi.useFakeTimers();
    const { calls, action } = recorder();
    const tracker = new SequenceTracker({
      bindings: { 'g g q': action('g g q') },
      platform: 'other',
    });

    tracker.press('g', plain('g'));
    vi.advanceTimersByTime(900);
    expect(tracker.press('g', plain('g')).kind).toBe('pending');
    vi.advanceTimersByTime(900);
    // 1.8s in total, but the second `g` re-armed the timer.
    expect(tracker.pending).toEqual(['g', 'g']);

    runIfMatched(tracker.press('q', plain('q')));
    expect(calls).toEqual(['g g q']);
  });

  it('reports a dead end as a cancelled prefix and retries the key fresh', () => {
    const { tracker, calls } = setup();

    tracker.press('g', plain('g'));
    // `z` neither completes nor extends `g`; on its own it binds nothing, so
    // the prefix is dropped rather than left to leak into the next keystroke.
    const result = tracker.press('z', plain('z'));
    expect(result).toMatchObject({ kind: 'ignored', cancelled: ['g'] });
    expect(tracker.pending).toBeNull();
    expect(calls).toEqual([]);
  });

  it('lets a dead-ended prefix fall through to the fresh key that followed it', () => {
    const { tracker, calls } = setup();

    tracker.press('g', plain('g'));
    // Ctrl+Z after `g` must still undo: the dead end re-enters matching as a
    // fresh start instead of swallowing the keystroke.
    const result = tracker.press('z', ctrl('z'));
    expect(result).toMatchObject({ kind: 'matched', binding: 'mod+z', cancelled: ['g'] });
    runIfMatched(result);
    expect(calls).toEqual(['mod+z']);
    expect(tracker.pending).toBeNull();
  });

  it('does not start a sequence for a modified first key', () => {
    const { tracker } = setup();
    // Ctrl+G is not `g`: modifiers are part of the match.
    expect(tracker.press('g', ctrl('g'))).toMatchObject({ kind: 'ignored' });
    expect(tracker.pending).toBeNull();
  });

  it('reports a single-key binding immediately, with no wait', () => {
    const { tracker, calls } = setup();
    const result = tracker.press('?', plain('?', { shiftKey: true }));
    expect(result).toMatchObject({ kind: 'matched', binding: '?' });
    runIfMatched(result);
    expect(calls).toEqual(['?']);
  });

  it('prefers the single binding over a sequence start for the same key', () => {
    const calls: string[] = [];
    const tracker = new SequenceTracker({
      bindings: { g: () => calls.push('g'), 'g q': () => calls.push('g q') },
      platform: 'other',
    });
    const result = tracker.press('g', plain('g'));
    expect(result).toMatchObject({ kind: 'matched', binding: 'g' });
    runIfMatched(result);
    expect(tracker.pending).toBeNull();
    expect(calls).toEqual(['g']);
  });

  it('reset drops a pending prefix (this is what Escape does)', () => {
    const { tracker, calls } = setup();
    tracker.press('g', plain('g'));
    tracker.reset();
    expect(tracker.pending).toBeNull();
    runIfMatched(tracker.press('q', plain('q')));
    expect(calls).toEqual([]);
  });

  it('keeps two sequences on the same prefix distinct', () => {
    const { tracker, calls } = setup();
    tracker.press('g', plain('g'));
    runIfMatched(tracker.press('m', plain('m')));
    expect(calls).toEqual(['g m']);
  });
});

describe('SequenceTracker: change notifications', () => {
  it('reports start, match and timeout through onChange', () => {
    vi.useFakeTimers();
    const seen: (readonly string[] | null)[] = [];
    const tracker = new SequenceTracker({
      bindings: { 'g q': () => undefined },
      platform: 'other',
      onChange: (pending) => seen.push(pending),
    });

    tracker.press('g', plain('g'));
    expect(seen).toEqual([['g']]);

    tracker.press('q', plain('q'));
    expect(seen).toEqual([['g'], null]);

    // A second wait that times out also reports the end exactly once.
    tracker.press('g', plain('g'));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([['g'], null, ['g'], null]);
  });

  it('does not emit duplicate notifications for the same state', () => {
    const seen: (readonly string[] | null)[] = [];
    const tracker = new SequenceTracker({
      bindings: { 'g q': () => undefined },
      platform: 'other',
      onChange: (pending) => seen.push(pending),
    });
    tracker.reset(); // already idle — nothing to announce
    expect(seen).toEqual([]);
  });

  it('resets the pending hint on dispose', () => {
    const seen: (readonly string[] | null)[] = [];
    const tracker = new SequenceTracker({
      bindings: { 'g q': () => undefined },
      platform: 'other',
      onChange: (pending) => seen.push(pending),
    });
    tracker.press('g', plain('g'));
    tracker.dispose();
    expect(seen).toEqual([['g'], null]);
  });
});

describe('SequenceTracker: platform modifiers', () => {
  it('expands `mod` to Ctrl off macOS', () => {
    const { calls, action } = recorder();
    const tracker = new SequenceTracker({
      bindings: { 'mod+z': action('undo') },
      platform: 'other',
    });
    runIfMatched(tracker.press('z', ctrl('z')));
    expect(calls).toEqual(['undo']);
  });

  it('expands `mod` to Cmd on macOS, and not to physical Ctrl', () => {
    const { calls, action } = recorder();
    const tracker = new SequenceTracker({
      bindings: { 'mod+z': action('undo') },
      platform: 'mac',
    });
    runIfMatched(tracker.press('z', plain('z', { metaKey: true })));
    expect(calls).toEqual(['undo']);
    expect(tracker.press('z', ctrl('z'))).toMatchObject({ kind: 'ignored' });
    expect(calls).toEqual(['undo']);
  });
});

describe('SequenceTracker: result typing', () => {
  it('narrows the union for callers', () => {
    const { tracker } = setup();
    const result: SequencePressResult = tracker.press('g', plain('g'));
    if (result.kind === 'matched') {
      // TypeScript only exposes `run` on the matched variant.
      expect(typeof result.run).toBe('function');
    } else {
      expect(result.kind).toBe('pending');
    }
  });
});

beforeEach(() => {
  vi.useRealTimers();
});
