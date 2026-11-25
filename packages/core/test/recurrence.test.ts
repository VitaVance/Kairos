import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_RECURRENCE_INTERVAL,
  isLocalDateString,
  isValidRecurrence,
  nextOccurrence,
  previousOccurrence,
} from '../src/domain/recurrence.js';
import type { Recurrence, Weekday } from '../src/domain/recurrence.js';
import type { LocalDate } from '../src/domain/types.js';
import { dayOfWeek, initTemporal } from '../src/index.js';

beforeAll(async () => {
  await initTemporal();
});

const D = (value: string) => value as LocalDate;

describe('isLocalDateString', () => {
  it('accepts real calendar dates', () => {
    expect(isLocalDateString('2026-09-06')).toBe(true);
    expect(isLocalDateString('2024-02-29')).toBe(true);
  });

  it('rejects wrong shapes and impossible dates', () => {
    expect(isLocalDateString('2026-9-6')).toBe(false);
    expect(isLocalDateString('2026-02-31')).toBe(false);
    expect(isLocalDateString('2026-13-01')).toBe(false);
    expect(isLocalDateString('not-a-date')).toBe(false);
    expect(isLocalDateString(20260906)).toBe(false);
    expect(isLocalDateString(null)).toBe(false);
  });
});

describe('isValidRecurrence', () => {
  const daily: Recurrence = { frequency: 'daily', interval: 1 };
  const weekly: Recurrence = { frequency: 'weekly', interval: 2, weekdays: [0, 2] };
  const monthly: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 15 };

  it('accepts the three supported shapes', () => {
    expect(isValidRecurrence(daily)).toBe(true);
    expect(isValidRecurrence(weekly)).toBe(true);
    expect(isValidRecurrence(monthly)).toBe(true);
    expect(isValidRecurrence({ ...daily, until: '2026-12-31' })).toBe(true);
    expect(isValidRecurrence({ ...daily, until: null })).toBe(true);
  });

  it('rejects a bad interval', () => {
    expect(isValidRecurrence({ frequency: 'daily', interval: 0 })).toBe(false);
    expect(isValidRecurrence({ frequency: 'daily', interval: 1.5 })).toBe(false);
    expect(isValidRecurrence({ frequency: 'daily', interval: MAX_RECURRENCE_INTERVAL + 1 })).toBe(false);
    expect(isValidRecurrence({ frequency: 'daily', interval: '1' })).toBe(false);
  });

  it('rejects empty, duplicate or out-of-range weekdays', () => {
    expect(isValidRecurrence({ frequency: 'weekly', interval: 1, weekdays: [] })).toBe(false);
    expect(isValidRecurrence({ frequency: 'weekly', interval: 1, weekdays: [1, 1] })).toBe(false);
    expect(isValidRecurrence({ frequency: 'weekly', interval: 1, weekdays: [7] })).toBe(false);
    expect(isValidRecurrence({ frequency: 'weekly', interval: 1, weekdays: [-1] })).toBe(false);
  });

  it('rejects a bad monthDay and a bad until', () => {
    expect(isValidRecurrence({ frequency: 'monthly', interval: 1, monthDay: 0 })).toBe(false);
    expect(isValidRecurrence({ frequency: 'monthly', interval: 1, monthDay: 32 })).toBe(false);
    expect(isValidRecurrence({ ...daily, until: '2026-02-31' })).toBe(false);
    expect(isValidRecurrence({ ...daily, until: 'soon' })).toBe(false);
  });

  it('rejects non-objects and unknown frequencies', () => {
    expect(isValidRecurrence(null)).toBe(false);
    expect(isValidRecurrence('daily')).toBe(false);
    expect(isValidRecurrence({ frequency: 'yearly', interval: 1 })).toBe(false);
  });
});

describe('nextOccurrence — daily', () => {
  it('advances by the interval', () => {
    const daily: Recurrence = { frequency: 'daily', interval: 1 };
    expect(nextOccurrence(daily, D('2026-09-06'))).toBe('2026-09-07');
    expect(nextOccurrence({ frequency: 'daily', interval: 3 }, D('2026-09-06'))).toBe('2026-09-09');
  });

  it('crosses month and year boundaries', () => {
    const daily: Recurrence = { frequency: 'daily', interval: 1 };
    expect(nextOccurrence(daily, D('2026-12-31'))).toBe('2027-01-01');
    expect(nextOccurrence(daily, D('2024-02-28'))).toBe('2024-02-29');
  });

  it('stops at the inclusive until date', () => {
    const rule: Recurrence = { frequency: 'daily', interval: 1, until: D('2026-09-08') };
    expect(nextOccurrence(rule, D('2026-09-07'))).toBe('2026-09-08');
    expect(nextOccurrence(rule, D('2026-09-08'))).toBeNull();
  });
});

describe('nextOccurrence — weekly', () => {
  // 2026-09-07 is a Monday.
  it('picks a later weekday in the same week', () => {
    // Mon + Wed series, completing Monday → Wednesday of the same week.
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [0, 2] };
    expect(dayOfWeek(D('2026-09-07'))).toBe(0);
    expect(nextOccurrence(rule, D('2026-09-07'))).toBe('2026-09-09');
  });

  it('jumps to the first chosen weekday of the next interval week', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [0, 2] };
    // Completing Wednesday → next Monday.
    expect(nextOccurrence(rule, D('2026-09-09'))).toBe('2026-09-14');
  });

  it('honours a multi-week interval', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 2, weekdays: [0] };
    expect(nextOccurrence(rule, D('2026-09-07'))).toBe('2026-09-21');
  });

  it('handles a Sunday-only series (weekday 6) across the week boundary', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [6] };
    // Sunday 2026-09-06 → next Sunday 2026-09-13.
    expect(dayOfWeek(D('2026-09-06'))).toBe(6);
    expect(nextOccurrence(rule, D('2026-09-06'))).toBe('2026-09-13');
  });

  it('respects until for weekly rules', () => {
    const rule: Recurrence = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [0, 2],
      until: D('2026-09-09'),
    };
    expect(nextOccurrence(rule, D('2026-09-07'))).toBe('2026-09-09');
    expect(nextOccurrence(rule, D('2026-09-09'))).toBeNull();
  });
});

describe('nextOccurrence — monthly', () => {
  it('advances to the same day next month', () => {
    const rule: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 15 };
    expect(nextOccurrence(rule, D('2026-09-15'))).toBe('2026-10-15');
  });

  it('skips months that lack the chosen day (31st)', () => {
    const rule: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 31 };
    // Sep 30 has no 31st → October 31.
    expect(nextOccurrence(rule, D('2026-09-30'))).toBe('2026-10-31');
    // Oct 31 → next month with a 31st is December.
    expect(nextOccurrence(rule, D('2026-10-31'))).toBe('2026-12-31');
  });

  it('from mid-month rolls to the next occurrence of that day', () => {
    const rule: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 15 };
    expect(nextOccurrence(rule, D('2026-09-01'))).toBe('2026-09-15');
    expect(nextOccurrence(rule, D('2026-09-16'))).toBe('2026-10-15');
  });

  it('honours a multi-month interval and until', () => {
    const rule: Recurrence = { frequency: 'monthly', interval: 3, monthDay: 1 };
    expect(nextOccurrence(rule, D('2026-09-01'))).toBe('2026-12-01');

    const bounded: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 15, until: D('2026-10-15') };
    expect(nextOccurrence(bounded, D('2026-09-15'))).toBe('2026-10-15');
    expect(nextOccurrence(bounded, D('2026-10-15'))).toBeNull();
  });

  it('handles the 29th in a leap-year February', () => {
    const rule: Recurrence = { frequency: 'monthly', interval: 1, monthDay: 29 };
    // 2027-01-29 → February 2027 has no 29th → skipped to March 29.
    expect(nextOccurrence(rule, D('2027-01-29'))).toBe('2027-03-29');
    // 2028 is a leap year: 2028-01-29 → 2028-02-29.
    expect(nextOccurrence(rule, D('2028-01-29'))).toBe('2028-02-29');
  });
});

describe('nextOccurrence — malformed input never loops', () => {
  const from = D('2026-09-06');

  it('returns null for null / undefined / invalid rules', () => {
    expect(nextOccurrence(null, from)).toBeNull();
    expect(nextOccurrence(undefined, from)).toBeNull();
    expect(nextOccurrence({ frequency: 'daily', interval: 0 } as Recurrence, from)).toBeNull();
    expect(nextOccurrence({ frequency: 'weekly', interval: 1, weekdays: [] } as unknown as Recurrence, from)).toBeNull();
    expect(nextOccurrence({ frequency: 'monthly', interval: 1, monthDay: 99 } as Recurrence, from)).toBeNull();
  });

  it('returns null for an invalid from date', () => {
    const daily: Recurrence = { frequency: 'daily', interval: 1 };
    expect(nextOccurrence(daily, '2026-02-31' as LocalDate)).toBeNull();
  });

  it('terminates immediately when until is before the first candidate', () => {
    const rule: Recurrence = { frequency: 'daily', interval: 1, until: D('2026-01-01') };
    expect(nextOccurrence(rule, from)).toBeNull();
  });

  it('accepts a weekday set given out of order', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [4, 0] as Weekday[] };
    // Monday → Wednesday (index 2 not selected) → actually next is Friday (4).
    expect(nextOccurrence(rule, D('2026-09-07'))).toBe('2026-09-11');
  });
});

describe('previousOccurrence', () => {
  it('mirrors nextOccurrence on a weekly rule', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [4] };
    // Friday 2026-09-11 → previous Friday.
    expect(previousOccurrence(rule, D('2026-09-11'))).toBe('2026-09-04');
    expect(previousOccurrence(rule, D('2026-09-08'))).toBe('2026-09-04');
  });

  it('picks an earlier weekday in the same week when present', () => {
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekdays: [0, 2] };
    expect(previousOccurrence(rule, D('2026-09-10'))).toBe('2026-09-09');
  });

  it('honours a multi-week interval and the month grid', () => {
    expect(
      previousOccurrence({ frequency: 'weekly', interval: 2, weekdays: [0] }, D('2026-09-14')),
    ).toBe('2026-08-31');
    expect(
      previousOccurrence({ frequency: 'monthly', interval: 1, monthDay: 31 }, D('2026-10-31')),
    ).toBe('2026-08-31');
  });

  it('returns null for malformed rules and dates', () => {
    expect(previousOccurrence(null, D('2026-09-11'))).toBeNull();
    expect(previousOccurrence({ frequency: 'weekly', interval: 1, weekdays: [] } as unknown as Recurrence, D('2026-09-11'))).toBeNull();
    expect(previousOccurrence({ frequency: 'daily', interval: 1 }, D('nope'))).toBeNull();
  });
});
