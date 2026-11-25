/**
 * Theme shape + runtime injection.
 *
 * `tokens.css` is the static default. When an app needs a different theme at
 * runtime (e.g. after the design direction is chosen), build a Theme object
 * and call themeToCssVars / applyTheme on the root element.
 */

export interface Theme {
  name: string;
  /** CSS custom property overrides, keys WITHOUT the --tl- prefix. */
  vars: Record<string, string>;
}

export const defaultTheme: Theme = {
  name: 'refined-light',
  vars: {
    bg: '#f5f5f6',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    border: '#ececee',
    'border-strong': '#e3e3e6',
    text: '#1d1d1f',
    'text-secondary': '#6e6e73',
    'text-tertiary': '#a1a1a6',
    accent: '#3b82f6',
    'accent-contrast': '#ffffff',
    danger: '#ff5252',
  },
};

export function themeToCssVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.vars)) {
    out[`--tl-${key}`] = value;
  }
  return out;
}

/** Applies a theme to an element (defaults to <html>). SSR-safe no-op guard. */
export function applyTheme(theme: Theme, el?: HTMLElement | null): void {
  const target = el ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return;
  for (const [k, v] of Object.entries(themeToCssVars(theme))) {
    target.style.setProperty(k, v);
  }
}
