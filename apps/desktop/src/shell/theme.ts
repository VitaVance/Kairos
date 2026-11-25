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
