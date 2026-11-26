import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveAppVersion } from './src/shell/version';

/**
 * The Tauri config directory. It is also the base for the `version` field's
 * file references: Tauri resolves them against the directory holding
 * `tauri.conf.json`, so `../package.json` means `apps/desktop/package.json`.
 */
const TAURI_DIR = fileURLToPath(new URL('./src-tauri/', import.meta.url));

/**
 * The app version shown by the update panel.
 *
 * Read from the Tauri config (the single source of truth that also drives the
 * installer's `ProductVersion`) rather than hardcoded in TypeScript. Without
 * this the panel would compare every release against a stale literal and could
 * report "already up to date" forever.
 *
 * `version` there is a *reference* (`"../package.json"`), not a literal.
 * `resolveAppVersion` follows it the same way Tauri does and throws on a
 * missing file or a non-semver result, so a broken reference fails the build
 * instead of silently baking a path into the bundle (P0-9).
 */
const tauriConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
) as { version: string };

const APP_VERSION = resolveAppVersion(tauriConfig.version, (path) =>
  readFileSync(resolve(TAURI_DIR, path), 'utf8'),
);

// Tauri expects a fixed port and a relative base for the packaged webview.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  build: { target: 'es2022', sourcemap: true },
});
