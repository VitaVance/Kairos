/**
 * Language identity, persistence and detection — deliberately free of any
 * i18next import so tests can exercise the mapping without booting the runtime.
 *
 * `zh-*` is intentionally folded onto one supported tag: the app ships a single
 * Simplified Chinese catalog, and mapping zh-TW / zh-Hans / zh-Hant onto it is
 * more useful than falling back to English merely because the region differs.
 */

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Stable key shared with any future native prefs bridge. */
export const LANGUAGE_STORAGE_KEY = 'todolist.language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Map an arbitrary BCP-47 tag (navigator.language, a stored value, i18next's
 * resolved language) onto something the catalog actually has.
 *
 * Everything that is not Chinese maps to English rather than returning null:
 * `fallbackLng: 'en'` is the declared contract, and returning a stable value
 * here keeps the switcher's `value` prop controlled instead of flickering.
 */
export function detectLanguage(candidate: string | null | undefined): Language {
  if (!candidate) return 'en';
  return candidate.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

/** The persisted *explicit* choice, or null when the user has never chosen. */
export function readStoredLanguage(): Language | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist an explicit choice. Storage failures are non-fatal (in-memory only). */
export function storeLanguage(language: Language): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* storage unavailable — ignore */
  }
}

function browserLanguage(): string | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : navigator.language;
  } catch {
    return undefined;
  }
}

/**
 * Detection order: explicit persisted choice first, system locale second.
 *
 * Detection deliberately does NOT write the detected value back to storage —
 * persisting the system locale would turn OS-language changes into a one-time
 * event. Only an explicit switcher action calls `storeLanguage`.
 */
export function resolveInitialLanguage(): Language {
  return readStoredLanguage() ?? detectLanguage(browserLanguage());
}

/** Keep `<html lang>` truthful — affects screen readers and native spellcheck. */
export function applyDocumentLanguage(language: Language): void {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
  } catch {
    /* non-DOM environment — no-op */
  }
}

/**
 * Endonyms, not translated names: a user looking for their language should
 * recognise it even while the UI is showing one they cannot read.
 */
export const LANGUAGE_OPTIONS: readonly { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];
