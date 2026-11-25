import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@todolist/ui/tokens.css';
import '@todolist/ui/styles.css';
import '@todolist/features/styles.css';
import './app.css';
import './shell/shell.css';
import { applyPalette, applyThemeMode, readStoredPalette, readStoredTheme } from './shell/theme';
import { initI18n } from '@todolist/ui';
import { App } from './App';

// Apply both theme axes before the first paint so there is no light flash and
// no palette flicker on reload.
applyThemeMode(readStoredTheme());
applyPalette(readStoredPalette());

// Same rule for language: catalogs are bundled and i18next initialises
// synchronously, so the very first frame is already translated (and
// <html lang> is set) instead of flashing English.
initI18n();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
