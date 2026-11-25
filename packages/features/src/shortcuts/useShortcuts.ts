import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts with platform-correct modifiers and two-key
 * sequences.
 *
 * Binding syntax: `mod+k`, `mod+shift+z`, `?`, `escape`, or a sequence written
 * with spaces — `g q`. `mod` is Cmd on macOS and Ctrl everywhere else.
 *
 * Events are ignored while typing in an input/textarea/contenteditable, except
 * `mod+k` (so the search palette can open from anywhere) and Escape (so it can
 * close whatever has focus). Events another listener already handled
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

const IS_MAC = detectPlatform() === 'mac';

interface ParsedStep {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

interface ParsedBinding {
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
    if (steps.length > 0) parsed.push({ steps, run });
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

function stepMatches(step: ParsedStep, event: KeyboardEvent, key: string): boolean {
  if (step.key !== key) return false;

  const modPressed = IS_MAC ? event.metaKey : event.ctrlKey;
  if (step.mod !== modPressed) return false;
  if (step.ctrl && !event.ctrlKey) return false;
  if (step.meta && !event.metaKey) return false;
  if (step.alt !== event.altKey) return false;

  // Shift is meaningful for letters/digits and whenever the binding asks for
  // it. Punctuation like `?` already requires Shift to type, so demanding
  // `!shift` would make those bindings unreachable.
  const shiftMatters = step.shift || /^[a-z0-9]$/.test(step.key);
  if (shiftMatters && step.shift !== event.shiftKey) return false;

  return true;
}

function isModifierOnly(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

function eventKey(event: KeyboardEvent): string {
  return normalizeKey(event.key === ' ' ? 'space' : event.key);
}

/** Human-readable, platform-correct label for a binding. */
export function formatBinding(binding: string, platform: ShortcutPlatform = detectPlatform()): string {
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

  const pendingRef = useRef<readonly string[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const clearPending = () => {
      pendingRef.current = null;
      clearTimer();
    };

    const startTimer = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        pendingRef.current = null;
        timerRef.current = null;
      }, sequenceTimeoutRef.current);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;

      const key = eventKey(event);
      if (key.length === 0 || isModifierOnly(key)) return;

      const editable = isEditableTarget(event.target);
      const searchChord = key === 'k' && (IS_MAC ? event.metaKey : event.ctrlKey);
      const escape = key === 'escape';
      if (editable && !searchChord && !escape) return;

      if (escape) {
        // Let dialogs/popovers handle Escape themselves; just drop a pending
        // sequence so it cannot leak into the next keystroke.
        clearPending();
        return;
      }

      const parsed = parseBindings(bindingsRef.current);
      if (parsed.length === 0) return;

      const pending = pendingRef.current;
      if (pending) {
        const nextKeys = [...pending, key];
        const exact = parsed.find(
          (binding) =>
            binding.steps.length === nextKeys.length &&
            binding.steps.slice(0, -1).every((step, i) => step.key === nextKeys[i]) &&
            stepMatches(binding.steps[binding.steps.length - 1]!, event, key),
        );
        if (exact) {
          clearPending();
          event.preventDefault();
          exact.run();
          return;
        }

        const isPrefix = parsed.some(
          (binding) =>
            binding.steps.length > nextKeys.length &&
            nextKeys.every((pressed, i) => binding.steps[i]?.key === pressed),
        );
        if (isPrefix) {
          pendingRef.current = nextKeys;
          startTimer();
          event.preventDefault();
          return;
        }

        // Dead end — fall through and treat this key as a fresh start.
        clearPending();
      }

      const single = parsed.find(
        (binding) => binding.steps.length === 1 && stepMatches(binding.steps[0]!, event, key),
      );
      if (single) {
        event.preventDefault();
        single.run();
        return;
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (hasModifier) return;

      const startsSequence = parsed.some(
        (binding) => binding.steps.length > 1 && stepMatches(binding.steps[0]!, event, key),
      );
      if (startsSequence) {
        pendingRef.current = [key];
        startTimer();
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, []);
}
