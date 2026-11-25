import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@todolist/ui/tokens.css';
import '@todolist/ui/styles.css';
import '@todolist/features/styles.css';
import './app.css';
import './shell/shell.css';
import { applyPalette, applyThemeMode, readStoredPalette, readStoredTheme } from './shell/theme';
import { App } from './App';

// Apply both theme axes before the first paint so there is no light flash and
// no palette flicker on reload.
applyThemeMode(readStoredTheme());
applyPalette(readStoredPalette());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
