import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Popover } from '@todolist/ui';
import {
  PALETTE_LABEL,
  applyPalette,
  applyThemeMode,
  PREFERS_DARK_QUERY,
  readStoredPalette,
  readStoredTheme,
  storePalette,
  storeTheme,
} from './theme';
import type { Palette, ThemeMode } from './theme';

/**
 * Theme picker: two independent axes in one popover.
 *
 *   appearance  light / dark / system   → `data-theme`   (tokens.css dark block)
 *   palette     清简 / 专注 / 纸墨        → `data-palette` (direction A/B/C)
 *
 * They compose, so all six combinations work. `system` is resolved before it
 * ever reaches the attribute, and the palette is applied independently of it.
 */

const MODE_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const PALETTE_OPTIONS: readonly { value: Palette; label: string; hint: string }[] = [
  { value: 'refined', label: '清简', hint: '冷调中性 · 蓝色强调' },
  { value: 'protool', label: '专注', hint: '暖白 · 靛蓝 · 高密度' },
  { value: 'editorial', label: '纸墨', hint: '纸感 · 赭黄靛苔' },
];

/** Small swatch trio so each palette is recognisable before you try it. */
const PALETTE_SWATCH: Record<Palette, readonly string[]> = {
  refined: ['#f5f5f6', '#ffffff', '#3b82f6'],
  protool: ['#fbfbfa', '#5b5bd6', '#cf4b4b'],
  editorial: ['#f7f3ec', '#fffdf8', '#b4553f'],
};

export interface ThemeToggleProps {
  /** Notified after the mode changes and has been applied. */
  onChange?: (mode: ThemeMode) => void;
}

export function ThemeToggle({ onChange }: ThemeToggleProps) {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme());
  const [palette, setPalette] = useState<Palette>(() => readStoredPalette());
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  // Apply on mount and whenever either axis changes.
  useEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  // While following the system, react to OS light/dark switches live.
  useEffect(() => {
    if (mode !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(PREFERS_DARK_QUERY);
    const onSystemChange = () => applyThemeMode('system');
    mql.addEventListener('change', onSystemChange);
    return () => mql.removeEventListener('change', onSystemChange);
  }, [mode]);

  const chooseMode = useCallback(
    (next: ThemeMode) => {
      setMode(next);
      storeTheme(next);
      onChange?.(next);
    },
    [onChange],
  );

  const choosePalette = useCallback((next: Palette) => {
    setPalette(next);
    storePalette(next);
  }, []);

  return (
    <>
      <IconButton
        ref={anchorRef}
        label={`主题：${PALETTE_LABEL[palette]}`}
        variant="quiet"
        className="sh-theme-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PaletteIcon />
      </IconButton>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={248} align="end">
        <div className="th-menu">
          <div className="th-menu__group" role="group" aria-label="外观">
            <span className="th-menu__label">外观</span>
            <div className="th-menu__row">
              {MODE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`th-menu__chip${mode === o.value ? ' is-active' : ''}`}
                  aria-pressed={mode === o.value}
                  onClick={() => chooseMode(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="th-menu__group" role="group" aria-label="配色">
            <span className="th-menu__label">配色</span>
            <div className="th-menu__palettes">
              {PALETTE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`th-menu__palette${palette === o.value ? ' is-active' : ''}`}
                  aria-pressed={palette === o.value}
                  onClick={() => choosePalette(o.value)}
                >
                  <span className="th-menu__swatch" aria-hidden="true">
                    {PALETTE_SWATCH[o.value].map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="th-menu__palette-text">
                    <strong>{o.label}</strong>
                    <small>{o.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}

function PaletteIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
