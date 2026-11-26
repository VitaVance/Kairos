/**
 * Theme mode persistence + application.
 *
 * IMPORTANT — do NOT use `applyTheme()` from @todolist/ui for dark mode.
 * `applyTheme` writes `--tl-*` values as *inline* styles on <html>. Inline
 * styles beat every stylesheet rule, so they would permanently pin the light
 * values and the `[data-theme="dark"]` block in tokens.css could never win.
 *
 * Instead we toggle `data-theme` on <html> and let tokens.css (plus the
 * `color-scheme` rule in @todolist/ui/styles.css) do the switching. Only
 * 'light' | 'dark' ever lands on the attribute; 'system' is resolved first.
 *
 * The *palette* (design direction) is a second, orthogonal axis written to
 * `data-palette`. Leaving it unset selects direction A (the default in
 * tokens.css), which is why 'refined' never needs an attribute.
 */

import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** The three shipped design directions. `refined` is the attribute-less default. */
export type Palette = 'refined' | 'protool' | 'editorial';

export const PALETTE_STORAGE_KEY = 'todolist.palette';

export const PALETTE_LABEL: Record<Palette, string> = {
  refined: '清简',
  protool: '专注',
  editorial: '纸墨',
};

const PALETTES: readonly Palette[] = ['refined', 'protool', 'editorial'];

function isPalette(value: unknown): value is Palette {
  return typeof value === 'string' && (PALETTES as readonly string[]).includes(value);
}

/** Read the persisted palette, defaulting to `refined` (direction A). */
export function readStoredPalette(): Palette {
  try {
    if (typeof window === 'undefined') return 'refined';
    const raw = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(raw) ? raw : 'refined';
  } catch {
    return 'refined';
  }
}

export function storePalette(palette: Palette): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Write the palette to <html>. `refined` removes the attribute so the `:root`
 * block wins, which keeps the default path byte-identical to a fresh install.
 */
export function applyPalette(palette: Palette): void {
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (palette === 'refined') delete root.dataset.palette;
    else root.dataset.palette = palette;
  } catch {
    /* non-DOM environment — no-op */
  }
}

/** localStorage key — shared with any future native prefs bridge. */
export const STORAGE_KEY = 'todolist.theme';

/** Media query used by resolveTheme and the ThemeToggle system subscription. */
export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/**
 * Read the persisted mode. Falls back to 'system' when nothing valid is
 * stored — including when storage itself is unavailable (private mode, quota,
 * disabled cookies).
 */
export function readStoredTheme(): ThemeMode {
  try {
    if (typeof window === 'undefined') return 'system';
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the mode. Storage failures are non-fatal (theme stays in-memory). */
export function storeTheme(mode: ThemeMode): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Resolve 'system' against the OS preference at call time. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(PREFERS_DARK_QUERY).matches ? 'dark' : 'light';
    }
  } catch {
    /* matchMedia unavailable — fall through */
  }
  return 'light';
}

/**
 * Apply a mode to the document: `data-theme` drives the stylesheet's token
 * overrides, `color-scheme` drives native form controls / scrollbars.
 */
export function applyThemeMode(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  } catch {
    /* non-DOM environment — no-op */
  }
}

/* ============================================================================
   Shared appearance store
   ----------------------------------------------------------------------------
   Two surfaces now change the theme: the top-bar popover and the 设置 dialog.
   Before this, each owned its own `useState` seeded from localStorage, and
   neither could see the other — changing in the dialog would leave the popover
   showing the old mode until remount. This store is the single source of truth
   for both. `useAppearance()` mirrors the ThemeToggle contract (choose* applies
   and persists immediately); the popover and the dialog are just two views of
   the same state.
   ========================================================================== */

export interface Appearance {
  readonly mode: ThemeMode;
  readonly palette: Palette;
}

type Listener = () => void;

let appearance: Appearance | null = null;
const listeners = new Set<Listener>();

/** Mirror the value onto <html> — the two axes are independent. */
function applyAppearance(next: Appearance): void {
  applyThemeMode(next.mode);
  applyPalette(next.palette);
}

function readInitialAppearance(): Appearance {
  return { mode: readStoredTheme(), palette: readStoredPalette() };
}

/** Current appearance, hydrated from storage on first read. */
export function getAppearance(): Appearance {
  if (appearance === null) {
    appearance = readInitialAppearance();
    applyAppearance(appearance);
  }
  return appearance;
}

function commit(next: Appearance): void {
  if (
    appearance !== null &&
    appearance.mode === next.mode &&
    appearance.palette === next.palette
  ) {
    return;
  }
  appearance = next;
  applyAppearance(appearance);
  for (const listener of listeners) listener();
}

export function setThemeMode(mode: ThemeMode): void {
  storeTheme(mode);
  commit({ mode, palette: getAppearance().palette });
}

export function setThemePalette(palette: Palette): void {
  storePalette(palette);
  commit({ mode: getAppearance().mode, palette });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe to the appearance axes. Applying happens inside the store, so call
 * it once at boot (a component rendering this hook is enough) and never rely on
 * an effect in a component that may not be mounted.
 */
export function useAppearance(): {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: Palette) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getAppearance, getAppearance);
  return {
    mode: snapshot.mode,
    palette: snapshot.palette,
    setMode: setThemeMode,
    setPalette: setThemePalette,
  };
}

/**
 * While following the system, re-resolve `data-theme` when the OS switches.
 * Idempotent and cheap; safe to call from more than one mounted component.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia(PREFERS_DARK_QUERY);
  const onSystemChange = () => {
    const current = getAppearance();
    if (current.mode === 'system') applyThemeMode('system');
  };
  mql.addEventListener('change', onSystemChange);
  return () => mql.removeEventListener('change', onSystemChange);
}
