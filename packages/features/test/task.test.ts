import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@todolist/core';
import { formatDue, parseQuickAdd } from '../src/task/due-label';
import {
  defaultRecurrence,
  describeRecurrence,
  intervalUnit,
} from '../src/task/recurrence-label';

const TODAY = '2026-09-06' as LocalDate;

describe('formatDue', () => {
  it('labels today, tomorrow and yesterday', () => {
    expect(formatDue({ dueDate: TODAY, duePeriod: null }, TODAY)).toBe('今天');
    expect(formatDue({ dueDate: '2026-09-07' as LocalDate, duePeriod: null }, TODAY)).toBe('明天');
    expect(formatDue({ dueDate: '2026-09-05' as LocalDate, duePeriod: null }, TODAY)).toBe('昨天');
  });

  it('labels the day after tomorrow', () => {
    expect(formatDue({ dueDate: '2026-09-08' as LocalDate, duePeriod: null }, TODAY)).toBe('后天');
  });

  it('falls back to M月D日 for other dates', () => {
    expect(formatDue({ dueDate: '2026-09-20' as LocalDate, duePeriod: null }, TODAY)).toBe('9月20日');
    expect(formatDue({ dueDate: '2026-12-01' as LocalDate, duePeriod: null }, TODAY)).toBe('12月1日');
    expect(formatDue({ dueDate: '2026-08-30' as LocalDate, duePeriod: null }, TODAY)).toBe('8月30日');
  });

  it('returns an empty string when there is no due date', () => {
    expect(formatDue({ dueDate: null, duePeriod: null }, TODAY)).toBe('');
  });

  it('appends the half-day bucket after the date wording', () => {
    expect(formatDue({ dueDate: TODAY, duePeriod: 'morning' }, TODAY)).toBe('今天 · 上午');
    expect(formatDue({ dueDate: '2026-09-07' as LocalDate, duePeriod: 'afternoon' }, TODAY)).toBe(
      '明天 · 下午',
    );
    expect(formatDue({ dueDate: '2026-09-20' as LocalDate, duePeriod: 'evening' }, TODAY)).toBe(
      '9月20日 · 晚上',
    );
  });
});

describe('parseQuickAdd', () => {
  it('plain text keeps the title and sets nothing', () => {
    expect(parseQuickAdd('买牛奶', TODAY)).toEqual({
      title: '买牛奶',
      important: false,
      urgent: false,
      dueDate: null,
      dueTime: null,
    });
  });

  it('trims surrounding and repeated whitespace', () => {
    expect(parseQuickAdd('  买  牛奶  ', TODAY).title).toBe('买 牛奶');
  });

  it('parses /重要 and /紧急 tokens out of the title', () => {
    const parsed = parseQuickAdd('写周报 /重要 /紧急', TODAY);
    expect(parsed.title).toBe('写周报');
    expect(parsed.important).toBe(true);
    expect(parsed.urgent).toBe(true);
  });

  it('parses a single /重要 token', () => {
    const parsed = parseQuickAdd('/重要 读书', TODAY);
    expect(parsed.title).toBe('读书');
    expect(parsed.important).toBe(true);
    expect(parsed.urgent).toBe(false);
  });

  it('parses a trailing @14:00 as a due time today', () => {
    const parsed = parseQuickAdd('开会 @14:00', TODAY);
    expect(parsed.title).toBe('开会');
    expect(parsed.dueDate).toBe(TODAY);
    expect(parsed.dueTime).toBe('14:00');
  });

  it('pads single-digit hours from the token', () => {
    const parsed = parseQuickAdd('喝水 @9:05', TODAY);
    expect(parsed.dueTime).toBe('09:05');
    expect(parsed.title).toBe('喝水');
  });

  it('parses tokens and a time together', () => {
    const parsed = parseQuickAdd('复盘 /重要 /紧急 @08:30', TODAY);
    expect(parsed).toEqual({
      title: '复盘',
      important: true,
      urgent: true,
      dueDate: TODAY,
      dueTime: '08:30',
    });
  });

  it('ignores a malformed @99:99 token', () => {
    const parsed = parseQuickAdd('拉伸 @99:99', TODAY);
    expect(parsed.dueDate).toBeNull();
    expect(parsed.dueTime).toBeNull();
    expect(parsed.title).toBe('拉伸 @99:99');
  });

  it('ignores a non-trailing time token', () => {
    const parsed = parseQuickAdd('@14:00 开会', TODAY);
    expect(parsed.dueDate).toBeNull();
    expect(parsed.dueTime).toBeNull();
    expect(parsed.title).toBe('@14:00 开会');
  });

  it('returns an empty title when the input is only tokens', () => {
    expect(parseQuickAdd('/重要 /紧急 @14:00', TODAY).title).toBe('');
  });
});

describe('recurrence presentation helpers', () => {
  it('defaults weekly/monthly rules to the anchor date', () => {
    // 2026-09-06 is a Sunday → weekday 6, day-of-month 6.
    expect(defaultRecurrence('weekly', '2026-09-06' as LocalDate)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [6],
      until: null,
    });
    expect(defaultRecurrence('monthly', '2026-09-06' as LocalDate)).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthDay: 6,
      until: null,
    });
    expect(defaultRecurrence('daily', '2026-09-06' as LocalDate)).toEqual({
      frequency: 'daily',
      interval: 1,
      until: null,
    });
  });

  it('describes each rule shape in one line', () => {
    expect(describeRecurrence({ frequency: 'daily', interval: 1, until: null })).toBe('每天');
    expect(describeRecurrence({ frequency: 'daily', interval: 3, until: null })).toBe('每 3 天');
    expect(
      describeRecurrence({ frequency: 'weekly', interval: 1, weekdays: [0, 2], until: null }),
    ).toBe('每周 周一、周三');
    expect(
      describeRecurrence({ frequency: 'weekly', interval: 2, weekdays: [4], until: null }),
    ).toBe('每 2 周 周五');
    expect(describeRecurrence({ frequency: 'monthly', interval: 1, monthDay: 15, until: null })).toBe(
      '每月 15 日',
    );
    expect(
      describeRecurrence({ frequency: 'monthly', interval: 2, monthDay: 1, until: null }),
    ).toBe('每 2 个月的 1 日');
    expect(
      describeRecurrence({ frequency: 'daily', interval: 1, until: '2026-12-31' as LocalDate }),
    ).toBe('每天，直到 2026-12-31');
  });

  it('labels interval units', () => {
    expect(intervalUnit('daily')).toBe('天');
    expect(intervalUnit('weekly')).toBe('周');
    expect(intervalUnit('monthly')).toBe('个月');
  });
});
