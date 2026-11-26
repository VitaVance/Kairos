import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Global keyboard shortcuts with platform-correct modifiers and two-key
 * sequences.
 *
 * Binding syntax: `mod+k`, `mod+shift+z`, `?`, `escape`, or a sequence written
 * with spaces — `g q`. `mod` is Cmd on macOS and Ctrl everywhere else.
 *
 * Events are ignored while typing in an input/textarea/contenteditable, except
 * a small allowlist of chords that never insert text — `mod+k` and `mod+f` (so
 * the search palette can open from anywhere) — and Escape (so it can close
 * whatever has focus). Events another listener already handled
 * (`defaultPrevented`) are skipped, which lets the host shell own a shortcut
 * natively without double-firing.
 */

export type ShortcutBindings = Record<string, () => void>;

export type ShortcutPlatform = 'mac' | 'other';

export interface UseShortcutsOptions {
  /** How long a first key waits for the second key of a sequence. Default 1000ms. */
  sequenceTimeoutMs?: number;
  /** Set false to detach the listener without unmounting. */
  enabled?: boolean;
  /**
   * Called whenever the sequence wait starts, changes, or ends. `[]` means the
   * wait is over (matched, cancelled, or timed out). Lets a host show a
   * "second key?" hint without touching this hook's internals; `ShortcutHelp`
   * also subscribes through `useSequencePending` so the built-in hint works
   * with no host wiring.
   */
  onSequencePending?: (pending: readonly string[]) => void;
}

export const SEQUENCE_TIMEOUT_MS = 1000;

const MODIFIER_KEYS = new Set([
  'shift',
  'control',
  'alt',
  'meta',
  'os',
  'altgraph',
  'capslock',
  'fn',
]);

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Del',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

export function detectPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const source = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(source) ? 'mac' : 'other';
}

const PLATFORM: ShortcutPlatform = detectPlatform();

/**
 * Chords that keep working while the user is typing in a field.
 *
 * They never insert text, so the focused field loses nothing by yielding them;
 * the binding is still matched later with its exact modifier set, so
 * `Ctrl+Shift+F` or `Ctrl+Alt+F` are *not* covered by this list.
 */
const TYPING_ALLOWED_CHORDS: readonly string[] = ['mod+k', 'mod+f'];

interface ParsedStep {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

interface ParsedBinding {
  /** The binding string as written, e.g. `g q`. */
  readonly source: string;
  readonly steps: readonly ParsedStep[];
  readonly run: () => void;
}

function normalizeKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === 'esc') return 'escape';
  if (key === 'spacebar') return 'space';
  return key;
}

function parseStep(raw: string): ParsedStep {
  const tokens = raw
    .split('+')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const key = normalizeKey(tokens.pop() ?? '');
  return {
    key,
    mod: tokens.includes('mod') || tokens.includes('cmd') || tokens.includes('command'),
    shift: tokens.includes('shift'),
    alt: tokens.includes('alt') || tokens.includes('option'),
    ctrl: tokens.includes('ctrl') || tokens.includes('control'),
    meta: tokens.includes('meta') || tokens.includes('win') || tokens.includes('cmd'),
  };
}

function parseBindings(bindings: ShortcutBindings): ParsedBinding[] {
  const parsed: ParsedBinding[] = [];
  for (const [binding, run] of Object.entries(bindings)) {
    const steps = binding
      .trim()
      .split(/\s+/)
      .map(parseStep)
      .filter((step) => step.key.length > 0);
    if (steps.length > 0) parsed.push({ source: binding.trim(), steps, run });
  }
  return parsed;
}

/** True when a keyboard shortcut should defer to the focused field. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}

function stepMatches(
  step: ParsedStep,
  event: ShortcutKeyEvent,
  key: string,
  platform: ShortcutPlatform,
): boolean {
  if (step.key !== key) return false;

  // Exact modifier-set comparison in both directions. A `mod+f` binding must
  // not fire for `mod+shift+f`: Shift is part of the chord, so an extra
  // Shift means the user asked for something else. `mod` expands to Ctrl on
  // Windows/Linux and Cmd on macOS before comparing, so it is not required
  // spuriously *and* is not left out of the equality check.
  const modPressed = platform === 'mac' ? event.metaKey : event.ctrlKey;
  if (step.mod !== modPressed) return false;
  const wantsCtrl = step.ctrl || (step.mod && platform !== 'mac');
  const wantsMeta = step.meta || (step.mod && platform === 'mac');
  if (wantsCtrl !== event.ctrlKey) return false;
  if (wantsMeta !== event.metaKey) return false;
  if (step.alt !== event.altKey) return false;

  // Shift is meaningful for letters/digits and whenever the binding asks for
  // it. Punctuation like `?` already requires Shift to type, so demanding
  // `!shift` would make those bindings unreachable.
  const shiftMatters = step.shift || /^[a-z0-9]$/.test(step.key);
  if (shiftMatters && step.shift !== event.shiftKey) return false;

  return true;
}

/** The subset of a KeyboardEvent that binding matching reads. */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * True when a single-step binding (`mod+f`, `escape`) matches this event on
 * the given platform. Sequences are stateful and therefore not supported here;
 * this exists so the matcher's exact-modifier rule is testable without a DOM.
 */
export function matchesBinding(
  binding: string,
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform = PLATFORM,
): boolean {
  const steps = binding
    .trim()
    .split(/\s+/)
    .map(parseStep);
  if (steps.length !== 1) return false;
  return stepMatches(steps[0]!, event, eventKey(event), platform);
}

/**
 * True when the event matches a chord that is allowed to fire from a text
 * field (`TYPING_ALLOWED_CHORDS`). Compared on key + exact modifiers so the
 * allowlist cannot widen into `mod+shift+f`, a sequence, or a bare `f`.
 */
function isTypingAllowedChord(event: ShortcutKeyEvent): boolean {
  return TYPING_ALLOWED_CHORDS.some((binding) => matchesBinding(binding, event));
}

function isModifierOnly(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

function eventKey(event: Pick<KeyboardEvent, 'key'>): string {
  return normalizeKey(event.key === ' ' ? 'space' : event.key);
}

/** Human-readable, platform-correct label for a binding. */
export function formatBinding(binding: string, platform: ShortcutPlatform = PLATFORM): string {
  const steps = binding
    .trim()
    .split(/\s+/)
    .map((raw) => formatStep(parseStep(raw), platform));
  return steps.join(' ');
}

function formatStep(step: ParsedStep, platform: ShortcutPlatform): string {
  const mods: string[] = [];
  if (step.mod) mods.push(platform === 'mac' ? '⌘' : 'Ctrl');
  if (step.ctrl) mods.push(platform === 'mac' ? '⌃' : 'Ctrl');
  if (step.meta) mods.push(platform === 'mac' ? '⌘' : 'Win');
  if (step.alt) mods.push(platform === 'mac' ? '⌥' : 'Alt');
  if (step.shift) mods.push(platform === 'mac' ? '⇧' : 'Shift');
  const unique = [...new Set(mods)];

  const labelled = KEY_LABELS[step.key];
  const keyLabel =
    labelled ??
    (step.key.length === 1
      ? step.key.toUpperCase()
      : step.key.charAt(0).toUpperCase() + step.key.slice(1));

  if (platform === 'mac') return `${unique.join('')}${keyLabel}`;
  return [...unique, keyLabel].join('+');
}

/* ==========================================================================
 * Escape stack — a new layer is only dismissed by Escape when it is topmost.
 * ========================================================================== */

/**
 * Which overlay owns Escape. Every layer pushes on open and pops on close;
 * document-level Escape listeners ask `isTopmost(id)` before acting.
 *
 * Why a stack rather than each layer guessing: without it, whichever document
 * listener was registered first wins (and stops propagation), so opening the
 * search palette above the task detail panel made Escape close the *detail*.
 * With a shared ordering, only the last-opened layer is dismissed, and a lower
 * layer stays put — the same rule native `<dialog>` modals get from the UA.
 *
 * Nesting and out-of-order pops are both supported: `pop` removes that id from
 * wherever it sits, so a component that closes out of order (an ancestor
 * unmounting, StrictMode's mount/unmount/mount) cannot strand the stack.
 */
export interface EscapeStack {
  /** Marks `id` as the topmost layer. Pushing an already-open id re-promotes it. */
  push(id: string): void;
  /** Removes `id`; a no-op when it is not on the stack. */
  pop(id: string): void;
  /** True only when `id` is the most recently pushed layer still on the stack. */
  isTopmost(id: string): boolean;
  /** The topmost layer's id, or `null` when the stack is empty. */
  topmost(): string | null;
  /** Drops every layer (tests / full teardown). */
  clear(): void;
}

export function createEscapeStack(): EscapeStack {
  const layers: string[] = [];
  return {
    push(id) {
      const existing = layers.indexOf(id);
      if (existing !== -1) layers.splice(existing, 1);
      layers.push(id);
    },
    pop(id) {
      const existing = layers.lastIndexOf(id);
      if (existing !== -1) layers.splice(existing, 1);
    },
    isTopmost(id) {
      return layers.length > 0 && layers[layers.length - 1] === id;
    },
    topmost() {
      return layers.length > 0 ? layers[layers.length - 1]! : null;
    },
    clear() {
      layers.length = 0;
    },
  };
}

/** The app-wide stack. Every overlay shares it so ordering is global. */
export const escapeStack: EscapeStack = createEscapeStack();

/* ==========================================================================
 * Sequence state machine — framework-free so it is testable without a DOM.
 * ========================================================================== */

export type SequencePressResult =
  /** A complete binding fired. `cancelled` is the abandoned prefix, if any. */
  | {
      readonly kind: 'matched';
      readonly binding: string;
      readonly run: () => void;
      readonly cancelled: readonly string[] | null;
    }
  /** The keystroke is one step of a sequence; wait for the next key. */
  | {
      readonly kind: 'pending';
      readonly pending: readonly string[];
      readonly cancelled: readonly string[] | null;
    }
  /** Nothing matched and nothing started. `cancelled` is a dead-ended prefix. */
  | { readonly kind: 'ignored'; readonly cancelled: readonly string[] | null };

export interface SequenceTrackerOptions {
  bindings: ShortcutBindings;
  /** How long a prefix waits for its next key. Default 1000ms. */
  timeoutMs?: number;
  /**
   * Fired when the pending path changes: `['g']` on start/advance, `null` when
   * it is matched, cancelled, reset or times out.
   */
  onChange?: (pending: readonly string[] | null) => void;
  /** Matching platform for `mod` expansion. Defaults to the detected one. */
  platform?: ShortcutPlatform;
}

function sameKeys(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * The two-key-sequence state machine. The hook owns one instance; tests drive
 * it directly with plain key events.
 *
 * Semantics (mirrors `useShortcuts`): a prefix waits up to `timeoutMs` for the
 * next key; an exact multi-step match runs it; a keystroke that neither
 * completes nor extends a prefix is a *dead end* — the prefix is dropped and
 * the same keystroke is retried as the start of a fresh binding, so `g` then
 * `Ctrl+Z` still undoes instead of silently eating both keys.
 */
export class SequenceTracker {
  private parsed: ParsedBinding[];
  private pendingKeys: readonly string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timeoutMs: number;
  private readonly platform: ShortcutPlatform;
  private readonly onChange: ((pending: readonly string[] | null) => void) | undefined;

  constructor(options: SequenceTrackerOptions) {
    this.parsed = parseBindings(options.bindings);
    this.timeoutMs = options.timeoutMs ?? SEQUENCE_TIMEOUT_MS;
    this.platform = options.platform ?? PLATFORM;
    this.onChange = options.onChange;
  }

  /** The current prefix, or `null` when no sequence is pending. */
  get pending(): readonly string[] | null {
    return this.pendingKeys.length === 0 ? null : this.pendingKeys;
  }

  setBindings(bindings: ShortcutBindings): void {
    this.parsed = parseBindings(bindings);
  }

  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms;
  }

  /** Drops a pending prefix (Escape, or a host that wants to abort). */
  reset(): void {
    this.setPending(null);
  }

  /** Stops the timer; notifies once so subscribers drop the hint. */
  dispose(): void {
    this.reset();
  }

  /**
   * Feed one keystroke (already filtered for modifiers-only, composing and
   * editable targets by the caller). Returns what the caller should do; the
   * tracker itself never calls `preventDefault`.
   */
  press(key: string, event: ShortcutKeyEvent): SequencePressResult {
    const pending = this.pendingKeys;
    if (pending.length > 0) {
      const nextKeys = [...pending, key];
      const exact = this.parsed.find(
        (binding) =>
          binding.steps.length === nextKeys.length &&
          binding.steps.slice(0, -1).every((step, i) => step.key === nextKeys[i]) &&
          stepMatches(binding.steps[binding.steps.length - 1]!, event, key, this.platform),
      );
      if (exact !== undefined) {
        this.setPending(null);
        return { kind: 'matched', binding: exact.source, run: exact.run, cancelled: null };
      }

      const isPrefix = this.parsed.some(
        (binding) =>
          binding.steps.length > nextKeys.length &&
          nextKeys.every((pressed, i) => binding.steps[i]?.key === pressed),
      );
      if (isPrefix) {
        this.setPending(nextKeys);
        return { kind: 'pending', pending: nextKeys, cancelled: null };
      }

      // Dead end — drop the prefix and treat this key as a fresh start.
      const cancelled = pending;
      this.setPending(null);
      return this.fresh(key, event, cancelled);
    }

    return this.fresh(key, event, null);
  }

  private fresh(
    key: string,
    event: ShortcutKeyEvent,
    cancelled: readonly string[] | null,
  ): SequencePressResult {
    const single = this.parsed.find(
      (binding) =>
        binding.steps.length === 1 &&
        stepMatches(binding.steps[0]!, event, key, this.platform),
    );
    if (single !== undefined) {
      return { kind: 'matched', binding: single.source, run: single.run, cancelled };
    }

    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (hasModifier) return { kind: 'ignored', cancelled };

    const startsSequence = this.parsed.some(
      (binding) =>
        binding.steps.length > 1 &&
        stepMatches(binding.steps[0]!, event, key, this.platform),
    );
    if (startsSequence) {
      const next = [key];
      this.setPending(next);
      return { kind: 'pending', pending: next, cancelled };
    }
    return { kind: 'ignored', cancelled };
  }

  private setPending(next: readonly string[] | null): void {
    const value = next === null || next.length === 0 ? null : next;
    const changed = !sameKeys(this.pendingKeys.length === 0 ? null : this.pendingKeys, value);
    this.pendingKeys = value ?? [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (value !== null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pendingKeys = [];
        this.onChange?.(null);
      }, this.timeoutMs);
    }
    if (changed) this.onChange?.(value);
  }
}

/* ==========================================================================
 * Shared pending-sequence store, so any always-mounted component can show a
 * hint. One `useShortcuts` call exists per app, so ownership is single but the
 * store still guards against a second hook instance clearing the first's hint.
 * ========================================================================== */

let sharedPending: readonly string[] | null = null;
let sharedOwner: object | null = null;
const pendingSubscribers = new Set<() => void>();

function publishPending(owner: object, pending: readonly string[] | null): void {
  if (pending !== null) {
    sharedOwner = owner;
  } else if (sharedOwner !== null && sharedOwner !== owner) {
    // Another hook instance owns the current wait; leave it alone.
    return;
  } else {
    sharedOwner = null;
  }
  if (sameKeys(sharedPending, pending)) return;
  sharedPending = pending;
  for (const subscriber of pendingSubscribers) subscriber();
}

/** Snapshot for `useSyncExternalStore`; `null` when no sequence is waiting. */
export function getPendingSequence(): readonly string[] | null {
  return sharedPending;
}

/** Subscribe to sequence-wait changes. Returns the unsubscribe function. */
export function subscribeSequence(subscriber: () => void): () => void {
  pendingSubscribers.add(subscriber);
  return () => {
    pendingSubscribers.delete(subscriber);
  };
}

/**
 * The current sequence prefix, or `null`. Use it to render a "second key?"
 * hint; `ShortcutHelp` renders the built-in one. A host that does not mount
 * `ShortcutHelp` can pass `onSequencePending` to `useShortcuts` instead.
 */
export function useSequencePending(): readonly string[] | null {
  return useSyncExternalStore(subscribeSequence, getPendingSequence, () => null);
}

/**
 * Attach global keyboard shortcuts. Pass a plain map of binding → action;
 * re-rendering with fresh function identities does not re-subscribe.
 */
export function useShortcuts(bindings: ShortcutBindings, options: UseShortcutsOptions = {}): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const enabledRef = useRef(options.enabled ?? true);
  enabledRef.current = options.enabled ?? true;

  const sequenceTimeoutRef = useRef(options.sequenceTimeoutMs ?? SEQUENCE_TIMEOUT_MS);
  sequenceTimeoutRef.current = options.sequenceTimeoutMs ?? SEQUENCE_TIMEOUT_MS;

  const onSequencePendingRef = useRef(options.onSequencePending);
  onSequencePendingRef.current = options.onSequencePending;

  useEffect(() => {
    // The tracker owns the prefix and its timer; this effect only feeds it and
    // mirrors the pending state into the shared store.
    const owner: object = {};
    const tracker = new SequenceTracker({
      bindings: bindingsRef.current,
      timeoutMs: sequenceTimeoutRef.current,
      onChange: (pending) => {
        publishPending(owner, pending);
        onSequencePendingRef.current?.(pending ?? []);
      },
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;

      const key = eventKey(event);
      if (key.length === 0 || isModifierOnly(key)) return;

      const editable = isEditableTarget(event.target);
      const escape = key === 'escape';
      if (editable && !escape && !isTypingAllowedChord(event)) return;

      if (escape) {
        // Let dialogs/popovers handle Escape themselves; just drop a pending
        // sequence so it cannot leak into the next keystroke.
        tracker.reset();
        return;
      }

      tracker.setBindings(bindingsRef.current);
      tracker.setTimeoutMs(sequenceTimeoutRef.current);

      const result = tracker.press(key, event);
      if (result.kind === 'matched') {
        event.preventDefault();
        result.run();
        return;
      }
      if (result.kind === 'pending') {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      tracker.dispose();
    };
  }, []);
}
