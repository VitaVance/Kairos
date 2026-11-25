/**
 * True inside the Tauri 2 webview, false in a plain browser (`pnpm dev`).
 * Tauri 2 installs `window.__TAURI_INTERNALS__` before app code executes.
 *
 * Lives on its own so both the SQL driver and the notification notifier can
 * share one detection rule without importing each other.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
