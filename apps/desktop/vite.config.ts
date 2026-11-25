import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The app version shown by the update panel.
 *
 * Read from the Tauri config (the single source of truth that also drives the
 * installer's `ProductVersion`) rather than hardcoded in TypeScript. Without
 * this the panel would compare every release against a stale literal and could
 * report "already up to date" forever.
 */
const tauriConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
) as { version: string };

// Tauri expects a fixed port and a relative base for the packaged webview.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(tauriConfig.version),
  },
  build: { target: 'es2022', sourcemap: true },
});
