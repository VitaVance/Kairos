import { useCallback, useEffect } from 'react';
import { LANGUAGE_OPTIONS, detectLanguage, setLanguage, useTranslation } from '@todolist/ui';
import type { Language } from '@todolist/ui';
import { isTauri } from '../host';

/**
 * Push the active language to the Rust side so the tray menu agrees with the
 * window.
 *
 * The tray is built in Rust and has no access to the webview's i18next
 * instance, so without this the menu would stay in whatever language the
 * binary shipped with while the UI switched — a small but persistent
 * inconsistency the user sees every time they right-click the tray icon.
 *
 * Fire-and-forget and browser-safe: `invoke` only exists under Tauri, and a
 * failure to relabel a menu is not worth surfacing to the user.
 */
function syncTrayLanguage(language: Language): void {
  if (!isTauri()) return;
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_tray_language', { language });
    } catch (error: unknown) {
      console.warn('[i18n] 无法同步托盘菜单语言', error);
    }
  })();
}

/**
 * Language switcher that sits beside the theme control.
 *
 * A native <select> rather than a custom menu: it is discoverable (the current
 * language is visible in the closed state), keyboard/screen-reader correct for
 * free, and renders with the OS control on every platform. The endonyms in
 * LANGUAGE_OPTIONS are deliberately untranslated so the choice is legible even
 * when the UI is in a language the user cannot read.
 *
 * `useTranslation` is subscribed here anyway: it re-renders this control on
 * `languageChanged`, keeping <select> in sync when the change originates
 * somewhere other than this control.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation('common');
  const value: Language = detectLanguage(i18n.resolvedLanguage ?? i18n.language);

  // The initial boot language never passes through onChange, so the tray would
  // stay at the Rust default ("en") on a Chinese system until the user touched
  // the switcher. Sync once on mount with whatever was resolved.
  useEffect(() => {
    syncTrayLanguage(value);
  }, [value]);

  const onChange = useCallback((next: Language) => {
    // Fire-and-forget: bundled resources resolve synchronously, so the label
    // updates on the same click; a rejected promise would only mean the
    // catalog was missing, which the parity test already rules out.
    void setLanguage(next);
  }, []);

  return (
    <label className="sh-lang">
      <span className="tl-visually-hidden">{t('language.label')}</span>
      <select
        className="sh-lang__select"
        aria-label={t('language.label')}
        title={t('language.label')}
        value={value}
        onChange={(e) => onChange(e.target.value as Language)}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
