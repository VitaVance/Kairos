import { beforeAll, describe, expect, it } from 'vitest';
import type { LocalDate } from '@todolist/core';
import { initI18n } from '@todolist/ui';
import en from '../../ui/src/i18n/locales/en/task.json';
import zh from '../../ui/src/i18n/locales/zh-CN/task.json';
import { formatDue } from '../src/task/due-label';
import { describeRecurrence, weekdayLabels } from '../src/task/recurrence-label';

type Catalog = { readonly [key: string]: string | Catalog };

function leafPaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : leafPaths(value, path);
  });
}

const sorted = (list: string[]) => [...list].sort();

describe('task namespace', () => {
  beforeAll(() => {
    initI18n('en');
  });

  it('en and zh-CN have identical key paths', () => {
    expect(sorted(leafPaths(zh))).toEqual(sorted(leafPaths(en)));
  });

  it('zh-CN still reads the original wording', () => {
    const today = '2026-09-06' as LocalDate;
    expect(formatDue({ dueDate: today, duePeriod: 'morning' }, today, 'zh-CN')).toBe(
      '今天 · 上午',
    );
    expect(
      describeRecurrence({ frequency: 'weekly', interval: 1, weekdays: [0, 2], until: null }, 'zh-CN'),
    ).toBe('每周 周一、周三');
    expect(weekdayLabels('zh-CN')).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
  });
});
