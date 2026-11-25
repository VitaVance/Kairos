import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUT_BINDINGS } from '../src/shortcuts/ShortcutHelp.js';
import {
  formatBinding,
  isEditableTarget,
  matchesBinding,
  type ShortcutKeyEvent,
} from '../src/shortcuts/useShortcuts.js';

/** A Ctrl-only Windows/Linux keydown, the primary target of this app. */
function ctrl(key: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra };
}

function plain(key: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
}

describe('binding parser: `mod+f`', () => {
  it('matches Ctrl+F on Windows/Linux', () => {
    expect(matchesBinding('mod+f', ctrl('f'), 'other')).toBe(true);
  });

  it('matches Cmd+F on macOS, and not Ctrl+F', () => {
    const cmd = plain('f', { metaKey: true });
    expect(matchesBinding('mod+f', cmd, 'mac')).toBe(true);
    // On macOS `mod` is Cmd; a physical Ctrl+F is a different chord.
    expect(matchesBinding('mod+f', ctrl('f'), 'mac')).toBe(false);
  });

  it('is not confused with `mod+shift+f`', () => {
    expect(matchesBinding('mod+f', ctrl('f', { shiftKey: true }), 'other')).toBe(false);
    expect(matchesBinding('mod+shift+f', ctrl('f', { shiftKey: true }), 'other')).toBe(true);
    // ...and the reverse direction also holds.
    expect(matchesBinding('mod+shift+f', ctrl('f'), 'other')).toBe(false);
  });

  it('is not confused with other modifier combinations', () => {
    expect(matchesBinding('mod+f', ctrl('f', { altKey: true }), 'other')).toBe(false);
    expect(matchesBinding('mod+f', plain('f'), 'other')).toBe(false);
  });

  it('is a single chord, not a sequence', () => {
    expect(matchesBinding('mod+f', ctrl('f'), 'other')).toBe(true);
    // A sequence binding never matches a lone keystroke.
    expect(matchesBinding('g f', plain('f'), 'other')).toBe(false);
  });

  it('keeps `mod+k` working alongside it', () => {
    expect(matchesBinding('mod+k', ctrl('k'), 'other')).toBe(true);
    expect(matchesBinding('mod+k', ctrl('f'), 'other')).toBe(false);
  });

  it('matches Escape without modifiers', () => {
    expect(matchesBinding('escape', plain('Escape'), 'other')).toBe(true);
    expect(matchesBinding('escape', ctrl('Escape'), 'other')).toBe(false);
  });
});

describe('formatBinding', () => {
  it('renders `mod+f` for each platform', () => {
    expect(formatBinding('mod+f', 'other')).toBe('Ctrl+F');
    expect(formatBinding('mod+f', 'mac')).toBe('⌘F');
  });

  it('keeps Shift visible', () => {
    expect(formatBinding('mod+shift+f', 'other')).toBe('Ctrl+Shift+F');
  });

  it('renders a space-separated sequence as two steps', () => {
    expect(formatBinding('g f', 'other')).toBe('G F');
  });
});

describe('help sheet lists exactly the bound set', () => {
  const bound = [
    // Shell registration in apps/desktop/src/shell/Shell.tsx.
    'mod+f',
    'mod+k',
    '?',
    'mod+z',
    'mod+shift+z',
    'g q',
    'g m',
    'g w',
    'g d',
    'g a',
    // Escape is handled by the hook itself and by each overlay.
    'escape',
  ];

  it('advertises every bound shortcut', () => {
    const advertised = DEFAULT_SHORTCUT_BINDINGS.map((b) => b.binding);
    for (const binding of bound) expect(advertised).toContain(binding);
  });

  it('advertises nothing that is not bound', () => {
    const advertised = DEFAULT_SHORTCUT_BINDINGS.map((b) => b.binding);
    for (const binding of advertised) expect(bound).toContain(binding);
  });

  it('has no duplicate rows', () => {
    const advertised = DEFAULT_SHORTCUT_BINDINGS.map((b) => b.binding);
    expect(new Set(advertised).size).toBe(advertised.length);
  });

  it('does not advertise Ctrl+N or Ctrl+S', () => {
    const advertised = DEFAULT_SHORTCUT_BINDINGS.map((b) => b.binding);
    // No global capture surface; the app autosaves.
    expect(advertised).not.toContain('mod+n');
    expect(advertised).not.toContain('mod+s');
  });
});

describe('isEditableTarget', () => {
  it('treats no target as not editable', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
