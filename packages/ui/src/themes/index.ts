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

/*
 * There used to be a `defaultTheme` object here, hardcoding a "refined-light"
 * palette. It had two problems and no callers:
 *
 * 1. It was a second source of truth for colours that `tokens.css` already
 *    defines — and it had drifted. Its `text-tertiary` was `#a1a1a6`, the value
 *    later measured at 2.57:1 and replaced with `#747478`. Anyone who built a
 *    Theme from it would have shipped the same contrast failure the token work
 *    had just fixed.
 * 2. `applyTheme` below writes inline custom properties on `<html>`, and
 *    inline styles beat every stylesheet rule. That is exactly why
 *    `apps/desktop/src/shell/theme.ts` refuses to use this path for dark mode:
 *    it would pin the light values permanently.
 *
 * The conversion helpers stay — they are the useful, side-effect-free part —
 * but the palette itself lives only in `tokens.css`.
 */

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
