import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  LANGUAGE_OPTIONS,
  detectLanguage,
  setLanguage,
  useTranslation,
} from '@todolist/ui';
import type { Language } from '@todolist/ui';
import { DEFAULT_SHORTCUT_BINDINGS } from '../shortcuts/ShortcutHelp';
import { formatBinding } from '../shortcuts/useShortcuts';
import './settings.css';

/** Mirrors the host's theme axis without importing the desktop shell. */
export type SettingsThemeMode = 'light' | 'dark' | 'system';
/** Mirrors the host's palette axis (directions A / B / C). */
export type SettingsPalette = 'refined' | 'protool' | 'editorial';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Current appearance and its setters, owned by the host shell. */
  mode: SettingsThemeMode;
  palette: SettingsPalette;
  onModeChange: (mode: SettingsThemeMode) => void;
  onPaletteChange: (palette: SettingsPalette) => void;
  /** App version string supplied by the host (build-time token). */
  version: string;
}

type Section = 'general' | 'appearance' | 'shortcuts' | 'about';

const SECTIONS: readonly Section[] = ['general', 'appearance', 'shortcuts', 'about'];

const MODE_VALUES: readonly SettingsThemeMode[] = ['light', 'dark', 'system'];
const PALETTE_VALUES: readonly SettingsPalette[] = ['refined', 'protool', 'editorial'];

type ShortcutLabelKey = (typeof DEFAULT_SHORTCUT_BINDINGS)[number]['labelKey'];

/**
 * Shortcut groups for the settings pane.
 *
 * Membership is declared by catalog key, but the *bindings themselves* are
 * never restated here: rows are filtered out of `DEFAULT_SHORTCUT_BINDINGS`, so
 * the settings pane and the `?` cheat-sheet cannot drift. A key that is added
 * to the catalog but not to a group simply does not render until it is placed.
 */
export const SHORTCUT_GROUPS: readonly {
  groupKey: 'groupCommon' | 'groupNavigation';
  labelKeys: readonly ShortcutLabelKey[];
}[] = [
  {
    groupKey: 'groupCommon',
    labelKeys: [
      'shortcuts.search',
      'shortcuts.help',
      'shortcuts.undo',
      'shortcuts.redo',
      'shortcuts.settings',
      'shortcuts.close',
    ],
  },
  {
    groupKey: 'groupNavigation',
    labelKeys: [
      'shortcuts.quadrant',
      'shortcuts.month',
      'shortcuts.week',
      'shortcuts.day',
      'shortcuts.agenda',
    ],
  },
];

/** Single-line description shown on the 关于 pane. */
const APP_DESCRIPTION_KEY = 'settings.about.description';

/**
 * 设置 dialog — a two-pane surface over the app's existing preferences.
 *
 * It does not own any preference state. Theme, palette and language are read
 * from and written back to the same stores the top-bar controls use; this is a
 * second view of them, not a second source of truth. Native `<dialog>` supplies
 * focus trapping, Escape-to-close and the backdrop.
 *
 * The 快捷键 pane is intentionally read-only: rebinding (capturing a chord and
 * persisting it) is not implemented, so the rows carry no hover/pressed
 * affordance that would imply "click to change".
 */
export function SettingsDialog({
  open,
  onClose,
  mode,
  palette,
  onModeChange,
  onPaletteChange,
  version,
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation('shell');
  // Shortcut descriptions live in the `misc` catalog (shared with the sheet).
  const { t: tMisc } = useTranslation('misc');
  const [active, setActive] = useState<Section>('general');
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const language: Language = detectLanguage(i18n.resolvedLanguage ?? i18n.language);

  const shortcutGroups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((group) => ({
        groupKey: group.groupKey,
        items: DEFAULT_SHORTCUT_BINDINGS.filter((binding) =>
          (group.labelKeys as readonly string[]).includes(binding.labelKey),
        ).map((binding) => ({
          binding: binding.binding,
          label: tMisc(binding.labelKey),
        })),
      })),
    [tMisc],
  );

  // Drive the native dialog imperatively — never render the `open` attribute.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // On each open, land focus on the active section so keyboard users can move
  // at once; the native dialog already traps the rest. Kept separate from the
  // show/close effect so switching sections mid-session never steals focus
  // from the pane.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLButtonElement>('.set-nav__item.is-active')?.focus();
  }, [open]);

  const onClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    // A click on the dialog element itself (not a descendant) is the backdrop.
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="set-dialog"
      aria-labelledby={titleId}
      onClick={onClick}
      // `cancel` fires on Escape; close through the parent so `open` stays the
      // single source of truth, and let the native close follow.
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="set-shell">
        <header className="set-head">
          <h2 className="set-title" id={titleId}>
            {t('settings.title')}
          </h2>
          {/*
            A visible close control, not just Esc. The dialog guide requires one
            in every dialog the user can dismiss ("DO use a native <button> with
            an accessible name for close controls"), and a modal opened from a
            gear icon gives no other hint that Esc works.
          */}
          <button
            type="button"
            className="set-close"
            aria-label={t('settings.close')}
            title={t('settings.close')}
            onClick={onClose}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="set-body">
          {/*
            A plain nav of buttons rather than the ARIA tabs pattern: tabs owe
            the user roving focus + arrow-key navigation, and a dialog this
            small does not need a second custom keyboard model beside Tab.
            `aria-current` marks the active section; the pane is its region.
          */}
          <nav className="set-nav" aria-label={t('settings.title')}>
            {SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                aria-current={active === section ? 'true' : undefined}
                aria-controls={`set-panel-${section}`}
                id={`set-nav-${section}`}
                className={`set-nav__item${active === section ? ' is-active' : ''}`}
                onClick={() => setActive(section)}
              >
                {t(`settings.sections.${section}`)}
              </button>
            ))}
          </nav>

          <div
            className="set-pane"
            role="region"
            id={`set-panel-${active}`}
            aria-labelledby={`set-nav-${active}`}
            tabIndex={0}
          >
            {active === 'general' ? (
              <section className="set-section" aria-labelledby="set-general-heading">
                <h3 className="set-section__title" id="set-general-heading">
                  {t('settings.sections.general')}
                </h3>

                <div className="set-group">
                  <div className="set-row">
                    <div className="set-row__text">
                      <span className="set-row__label">{t('settings.general.language')}</span>
                      <span className="set-row__hint">{t('settings.general.languageHint')}</span>
                    </div>
                    <select
                      className="set-select tl-select"
                      aria-label={t('settings.general.language')}
                      value={language}
                      onChange={(e) => void setLanguage(e.target.value as Language)}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="set-row">
                    <div className="set-row__text">
                      <span className="set-row__label">{t('settings.general.weekStart')}</span>
                      <span className="set-row__hint">{t('settings.general.weekStartFixed')}</span>
                    </div>
                    <span className="set-row__value set-row__value--fixed">
                      {t('settings.general.weekStartValue')}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            {active === 'appearance' ? (
              <section className="set-section" aria-labelledby="set-appearance-heading">
                <h3 className="set-section__title" id="set-appearance-heading">
                  {t('settings.sections.appearance')}
                </h3>

                <div className="set-group">
                  <div className="set-row">
                    <div className="set-row__text">
                      <span className="set-row__label">{t('settings.appearance.theme')}</span>
                    </div>
                    <div className="set-choice" role="group" aria-label={t('settings.appearance.theme')}>
                      {MODE_VALUES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`set-choice__item${mode === value ? ' is-active' : ''}`}
                          aria-pressed={mode === value}
                          onClick={() => onModeChange(value)}
                        >
                          {t(`theme.mode.${value}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="set-row set-row--stack">
                    <div className="set-row__text">
                      <span className="set-row__label">{t('settings.appearance.palette')}</span>
                    </div>
                    <div className="set-palettes" role="group" aria-label={t('settings.appearance.palette')}>
                      {PALETTE_VALUES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`set-palette${palette === value ? ' is-active' : ''}`}
                          aria-pressed={palette === value}
                          onClick={() => onPaletteChange(value)}
                        >
                          <span className="set-palette__name">
                            {t(`theme.palettes.${value}.name`)}
                          </span>
                          <span className="set-palette__hint">
                            {t(`theme.palettes.${value}.hint`)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {active === 'shortcuts' ? (
              <section className="set-section" aria-labelledby="set-shortcuts-heading">
                <h3 className="set-section__title" id="set-shortcuts-heading">
                  {t('settings.sections.shortcuts')}
                </h3>
                <p className="set-note" role="note">
                  {t('settings.shortcuts.notRebindable')}
                </p>

                {shortcutGroups.map((group) => (
                  <div className="set-group" key={group.groupKey}>
                    <h4 className="set-group__title">
                      {t(`settings.shortcuts.${group.groupKey}`)}
                    </h4>
                    <ul className="set-keys" aria-label={t(`settings.shortcuts.${group.groupKey}`)}>
                      {group.items.map((item) => (
                        <li className="set-key" key={`${item.binding}:${item.label}`}>
                          <span className="set-key__label">{item.label}</span>
                          <kbd className="set-key__kbd">{formatBinding(item.binding)}</kbd>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ) : null}

            {active === 'about' ? (
              <section className="set-section" aria-labelledby="set-about-heading">
                <h3 className="set-section__title" id="set-about-heading">
                  {t('settings.sections.about')}
                </h3>

                <div className="set-about">
                  <span className="set-about__name">Kairos</span>
                  <span className="set-about__version">
                    {t('settings.about.version', { version })}
                  </span>
                  <p className="set-about__desc">{t(APP_DESCRIPTION_KEY)}</p>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}
