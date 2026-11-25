import { describe, expect, it } from 'vitest';
import { i18n, initI18n, setLanguage } from '../src/i18n/index';
import enCommon from '../src/i18n/locales/en/common.json';
import enErrors from '../src/i18n/locales/en/errors.json';
import enShell from '../src/i18n/locales/en/shell.json';
import enCalendar from '../src/i18n/locales/en/calendar.json';
import zhCommon from '../src/i18n/locales/zh-CN/common.json';
import zhErrors from '../src/i18n/locales/zh-CN/errors.json';
import zhShell from '../src/i18n/locales/zh-CN/shell.json';
import zhCalendar from '../src/i18n/locales/zh-CN/calendar.json';
import { detectLanguage } from '../src/i18n/types';

type Catalog = { readonly [key: string]: string | Catalog };

const EN: Record<string, Catalog> = {
  common: enCommon,
  shell: enShell,
  errors: enErrors,
  calendar: enCalendar,
};
const ZH: Record<string, Catalog> = {
  common: zhCommon,
  shell: zhShell,
  errors: zhErrors,
  calendar: zhCalendar,
};

/** Depth-first list of every leaf path, e.g. `shell:theme.mode.dark`. */
function leafPaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    // Objects are namespaces of their own; a string (even one containing dots)
    // is a leaf and must not be split further.
    return typeof value === 'string' ? [path] : leafPaths(value, path);
  });
}

function leaves(catalog: Catalog): Array<[string, string]> {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'string'
      ? ([[key, value]] as Array<[string, string]>)
      : leaves(value).map(([path, text]) => [`${key}.${path}`, text] as [string, string]),
  );
}

const sorted = (list: string[]) => [...list].sort();

describe('translation catalog parity', () => {
  for (const ns of Object.keys(EN)) {
    it(`${ns}: en and zh-CN have identical key paths`, () => {
      const en = EN[ns];
      const zh = ZH[ns];
      expect(en).toBeDefined();
      expect(zh).toBeDefined();
      // Reporting both directions in one assertion names the missing key
      // instead of merely "arrays differ".
      expect(sorted(leafPaths(zh!))).toEqual(sorted(leafPaths(en!)));
    });
  }

  it('the two locales ship the same namespace set', () => {
    expect(sorted(Object.keys(ZH))).toEqual(sorted(Object.keys(EN)));
  });
});

describe('translation values', () => {
  for (const ns of Object.keys(EN)) {
    it(`${ns}: no value is empty or whitespace`, () => {
      const empty = leaves(EN[ns]!).filter(([, text]) => text.trim() === '');
      expect(empty).toEqual([]);
    });

    it(`${ns}: zh-CN has no empty or whitespace value`, () => {
      const empty = leaves(ZH[ns]!).filter(([, text]) => text.trim() === '');
      expect(empty).toEqual([]);
    });
  }
});

describe('detectLanguage', () => {
  it.each(['zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'zh'])('maps %s to zh-CN', (tag) => {
    expect(detectLanguage(tag)).toBe('zh-CN');
  });

  it.each(['de-DE', 'ja-JP', 'en-US', 'fr', ''])('maps %s to en', (tag) => {
    expect(detectLanguage(tag)).toBe('en');
  });

  it('treats a missing locale (SSR / no navigator) as en', () => {
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage(null)).toBe('en');
  });
});

describe('initI18n', () => {
  it('initialises synchronously so the first paint can already translate', () => {
    initI18n('en');
    // `initAsync: false` + bundled resources: no awaiting is needed, which is
    // what makes the no-flash guarantee in main.tsx hold.
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.getFixedT(null, 'common')('buttons.save')).toBe('Save');
    expect(i18n.getFixedT(null, 'shell')('theme.mode.dark')).toBe('Dark');
  });

  it('switches language and resolves per-namespace keys', async () => {
    initI18n('en');
    await setLanguage('zh-CN');
    expect(i18n.getFixedT(null, 'common')('buttons.save')).toBe('保存');
    expect(i18n.getFixedT(null, 'shell')('theme.mode.dark')).toBe('深色');
    expect(i18n.getFixedT(null, 'shell')('theme.palettes.editorial.name')).toBe('纸墨');
    // Interpolation still works after a live switch.
    expect(i18n.getFixedT(null, 'shell')('nav.calendarWithView', { view: '周视图' })).toBe(
      '日历（周视图）',
    );
  });

  it('falls back to English for a key missing from the active locale', async () => {
    initI18n('en');
    // Simulate a partial future catalog: the contract is fallbackLng: 'en',
    // never a raw key rendered to the user.
    i18n.removeResourceBundle('zh-CN', 'common');
    i18n.addResourceBundle('zh-CN', 'common', { buttons: { cancel: '取消' } }, false, true);
    await setLanguage('zh-CN');
    try {
      expect(i18n.getFixedT(null, 'common')('buttons.save')).toBe('Save');
      expect(i18n.getFixedT(null, 'common')('buttons.cancel')).toBe('取消');
    } finally {
      i18n.removeResourceBundle('zh-CN', 'common');
      i18n.addResourceBundle('zh-CN', 'common', zhCommon, true, true);
      await setLanguage('en');
    }
  });
});
