import { useEffect, useRef, useState } from 'react';
import { IconButton, Popover, useTranslation } from '@todolist/ui';
import { useAppearance, watchSystemTheme } from './theme';
import type { Palette, ThemeMode } from './theme';

/**
 * Theme picker: two independent axes in one popover.
 *
 *   appearance  light / dark / system   → `data-theme`   (tokens.css dark block)
 *   palette     refined / protool / editorial → `data-palette` (direction A/B/C)
 *
 * They compose, so all six combinations work. `system` is resolved before it
 * ever reaches the attribute, and the palette is applied independently of it.
 *
 * State lives in the shared appearance store (`theme.ts`), not here: the 设置
 * dialog is a second surface for the same two axes, and two local `useState`
 * copies went out of sync the moment one of them changed.
 *
 * Labels come from the `shell:theme` namespace rather than PALETTE_LABEL: the
 * palette names are user-facing copy, and this menu must switch language live
 * like the rest of the shell.
 */

const MODE_VALUES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const PALETTE_VALUES: readonly Palette[] = ['refined', 'protool', 'editorial'];

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
  const { t } = useTranslation('shell');
  const { mode, palette, setMode, setPalette } = useAppearance();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  // While following the system, react to OS light/dark switches live.
  useEffect(() => watchSystemTheme(), []);

  return (
    <>
      <IconButton
        ref={anchorRef}
        label={t('theme.toggle', { palette: t(`theme.palettes.${palette}.name`) })}
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
          <div className="th-menu__group" role="group" aria-label={t('theme.appearance')}>
            <span className="th-menu__label">{t('theme.appearance')}</span>
            <div className="th-menu__row">
              {MODE_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`th-menu__chip${mode === value ? ' is-active' : ''}`}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    onChange?.(value);
                  }}
                >
                  {t(`theme.mode.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="th-menu__group" role="group" aria-label={t('theme.palette')}>
            <span className="th-menu__label">{t('theme.palette')}</span>
            <div className="th-menu__palettes">
              {PALETTE_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`th-menu__palette${palette === value ? ' is-active' : ''}`}
                  aria-pressed={palette === value}
                  onClick={() => setPalette(value)}
                >
                  <span className="th-menu__swatch" aria-hidden="true">
                    {PALETTE_SWATCH[value].map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="th-menu__palette-text">
                    <strong>{t(`theme.palettes.${value}.name`)}</strong>
                    <small>{t(`theme.palettes.${value}.hint`)}</small>
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
