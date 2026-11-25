import type common from './locales/en/common.json';
import type errors from './locales/en/errors.json';
import type shell from './locales/en/shell.json';

/**
 * Type-safe translation keys.
 *
 * The English catalog is the source of truth for the key space; without this
 * augmentation `t('common:butons.save')` is a silent runtime miss that renders
 * the raw key to the user. With it, the same typo is a compile error.
 *
 * Kept in a `.d.ts` (and referenced from i18n/index.ts) so it follows the
 * package into consumers — apps/desktop type-checks `t()` calls against these
 * resources even though it never imports 'i18next' itself.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    returnNull: false;
    resources: {
      common: typeof common;
      shell: typeof shell;
      errors: typeof errors;
    };
  }
}
