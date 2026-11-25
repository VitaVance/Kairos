/// <reference path="./i18next.d.ts" />
import i18n from 'i18next';
import type { TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCalendar from './locales/en/calendar.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enLists from './locales/en/lists.json';
import enMisc from './locales/en/misc.json';
import enPickers from './locales/en/pickers.json';
import enShell from './locales/en/shell.json';
import enTask from './locales/en/task.json';
import zhCalendar from './locales/zh-CN/calendar.json';
import zhCommon from './locales/zh-CN/common.json';
import zhErrors from './locales/zh-CN/errors.json';
import zhLists from './locales/zh-CN/lists.json';
import zhMisc from './locales/zh-CN/misc.json';
import zhPickers from './locales/zh-CN/pickers.json';
import zhShell from './locales/zh-CN/shell.json';
import zhTask from './locales/zh-CN/task.json';
import {
  SUPPORTED_LANGUAGES,
  applyDocumentLanguage,
  detectLanguage,
  resolveInitialLanguage,
  storeLanguage,
} from './types';
import type { Language } from './types';

export {
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  applyDocumentLanguage,
  detectLanguage,
  readStoredLanguage,
  resolveInitialLanguage,
  storeLanguage,
} from './types';
export type { Language } from './types';

// Re-exported so feature packages depend on @todolist/ui alone; a second direct
// import of react-i18next is how two copies end up disagreeing about `t`.
export { I18nextProvider, Trans, useTranslation } from 'react-i18next';

/** Bundled catalogs — no backend, no network, no async flash of raw keys. */
const resources = {
  en: {
    common: enCommon,
    shell: enShell,
    errors: enErrors,
    lists: enLists,
    misc: enMisc,
    pickers: enPickers,
    calendar: enCalendar,
    task: enTask,
  },
  'zh-CN': {
    common: zhCommon,
    shell: zhShell,
    errors: zhErrors,
    lists: zhLists,
    misc: zhMisc,
    pickers: zhPickers,
    calendar: zhCalendar,
    task: zhTask,
  },
} as const;

const NAMESPACES = ['common', 'shell', 'errors', 'lists', 'misc', 'pickers', 'calendar', 'task'] as const;

// Feature namespaces are registered here rather than in i18next.d.ts so a
// feature group can add its catalog without editing the shared type file.
// `ResourceNamespaceMap` merges with `CustomTypeOptions.resources`; the English
// catalog is still the source of truth for the key space.
declare module 'i18next' {
  interface ResourceNamespaceMap {
    lists: typeof enLists;
    misc: typeof enMisc;
    pickers: typeof enPickers;
    calendar: typeof enCalendar;
    task: typeof enTask;
  }
}

export { i18n };

// `<html lang>` follows every language change, including ones triggered outside
// the switcher (e.g. a future native menu calling changeLanguage directly).
i18n.on('languageChanged', (lng) => applyDocumentLanguage(detectLanguage(lng)));

/**
 * Initialise i18next exactly once, synchronously.
 *
 * Must run before `createRoot(...).render(...)` so the first frame is already
 * in the right language — `initAsync: false` plus bundled resources makes the
 * init call synchronous, so no "flash of English" is possible. Repeated calls
 * (StrictMode, HMR) are no-ops apart from re-syncing `<html lang>`.
 */
export function initI18n(language: Language = resolveInitialLanguage()): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LANGUAGES],
      ns: [...NAMESPACES],
      defaultNS: 'common',
      // React escapes interpolated values itself; escaping again double-encodes
      // apostrophes and ampersands in user content.
      interpolation: { escapeValue: false },
      returnNull: false,
      initAsync: false,
    });
  }
  applyDocumentLanguage(currentLanguage());
  return i18n;
}

/** Persist + apply an explicit user choice, then switch the runtime. */
export function setLanguage(language: Language): Promise<TFunction> {
  storeLanguage(language);
  applyDocumentLanguage(language);
  return i18n.changeLanguage(language);
}

/** The language actually in effect, normalised to a catalog we ship. */
export function currentLanguage(): Language {
  return detectLanguage(i18n.resolvedLanguage ?? i18n.language);
}
