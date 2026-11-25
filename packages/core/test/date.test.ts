import { beforeAll, describe, expect, it } from 'vitest';
import {
  APP_TIME_ZONE,
  addDays,
  dayOfWeek,
  eachDay,
  endOfDay,
  hasNativeTemporal,
  instantAtLocal,
  localDateOf,
  startOfDay,
  startOfWeek,
} from '../src/shared/date.js';
import { getTemporal, initTemporal } from '../src/shared/temporal-runtime.js';
import type { Instant, LocalDate } from '../src/domain/types.js';

// Node has no native Temporal yet; resolve the polyfill before any helper runs.
beforeAll(async () => {
  await initTemporal();
});

describe('Temporal runtime', () => {
  it('exposes a boolean native-Temporal probe and a resolved implementation', () => {
    expect(typeof hasNativeTemporal()).toBe('boolean');
    expect(typeof getTemporal().PlainDate.from).toBe('function');
    expect(APP_TIME_ZONE.length).toBeGreaterThan(0);
  });
});

describe('localDateOf', () => {
  it('maps an instant to the calendar day in a fixed zone without drift', () => {
    const instant = '2026-09-05T23:30:00Z' as Instant;
    const date = localDateOf(instant, 'Asia/Shanghai');
    // 23:30Z is 07:30 next day in Shanghai (+08:00).
    expect(date).toBe('2026-09-06');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Consistency with Temporal itself, not a hand-rolled expectation.
    const expected = getTemporal()
      .Instant.from(instant)
      .toZonedDateTimeISO('Asia/Shanghai')
      .toPlainDate()
      .toString();
    expect(date).toBe(expected);

    // Calling again yields the same value (no hidden clock/offset dependency).
    expect(localDateOf(instant, 'Asia/Shanghai')).toBe(date);

    // The same instant is a different day in a westward zone.
    expect(localDateOf(instant, 'America/New_York')).toBe('2026-09-05');
  });

  it('uses the app time zone by default', () => {
    const instant = '2026-09-05T23:30:00Z' as Instant;
    expect(localDateOf(instant)).toBe(localDateOf(instant, APP_TIME_ZONE));
  });
});

describe('addDays', () => {
  it('crosses a non-leap February into March', () => {
    expect(addDays('2026-02-28' as LocalDate, 1)).toBe('2026-03-01');
  });

  it('crosses a leap February into March', () => {
    expect(addDays('2024-02-28' as LocalDate, 1)).toBe('2024-02-29');
  });

  it('crosses a year boundary in both directions', () => {
    expect(addDays('2026-12-31' as LocalDate, 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01' as LocalDate, -1)).toBe('2026-12-31');
  });
});

describe('startOfWeek', () => {
  it('returns the current Monday for a Monday', () => {
    // 2026-08-31 is a Monday.
    expect(startOfWeek('2026-08-31' as LocalDate)).toBe('2026-08-31');
  });

  it('returns the preceding Monday for a Sunday', () => {
    // 2026-09-06 is a Sunday.
    expect(startOfWeek('2026-09-06' as LocalDate)).toBe('2026-08-31');
  });

  it('treats Monday as day 0 and Sunday as day 6', () => {
    expect(dayOfWeek('2026-08-31' as LocalDate)).toBe(0);
    expect(dayOfWeek('2026-09-06' as LocalDate)).toBe(6);
  });
});

describe('eachDay', () => {
  it('is inclusive on both ends', () => {
    expect(eachDay('2026-09-01' as LocalDate, '2026-09-03' as LocalDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });

  it('returns a single day when both ends match', () => {
    expect(eachDay('2026-09-01' as LocalDate, '2026-09-01' as LocalDate)).toEqual(['2026-09-01']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDay('2026-09-03' as LocalDate, '2026-09-01' as LocalDate)).toEqual([]);
  });
});

describe('startOfDay / endOfDay', () => {
  it('round-trips the date through the instant boundaries', () => {
    const date = '2026-09-06' as LocalDate;
    const start = startOfDay(date);
    const end = endOfDay(date);

    expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
    expect(localDateOf(start)).toBe(date);
    // Exclusive end: the next day's start maps to the following date.
    expect(localDateOf(end)).toBe(addDays(date, 1));
  });

  it('is DST-safe whether or not the host zone observes DST', () => {
    // 2026-03-08 is a US spring-forward date. In a zone without DST this is an
    // ordinary day; in one with DST, temporal resolves the shortened day.
    const date = '2026-03-08' as LocalDate;
    const start = startOfDay(date);

    // Must be a parseable instant that maps back to the same local date.
    expect(Number.isNaN(Date.parse(start))).toBe(false);
    expect(localDateOf(start)).toBe(date);

    // It must lie within the local day it claims to start: >= start of day and
    // strictly before the next day's start, using Temporal's own comparison.
    const T = getTemporal();
    const instant = T.Instant.from(start);
    const nextStart = T.Instant.from(startOfDay(addDays(date, 1)));
    expect(T.Instant.compare(instant, nextStart)).toBeLessThan(0);
  });
});

describe('instantAtLocal', () => {
  it('binds the wall-clock time to the app zone', () => {
    const instant = instantAtLocal('2026-09-06' as LocalDate, '14:30');
    expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Round-tripping through the app zone must give back the same reading.
    expect(localDateOf(instant)).toBe('2026-09-06');

    // Compare against Temporal's own zone-aware construction, so the test does
    // not bake in assuming the host zone is UTC.
    const expected = getTemporal()
      .PlainDate.from('2026-09-06')
      .toZonedDateTime({ timeZone: APP_TIME_ZONE, plainTime: '14:30' })
      .toInstant()
      .toString({ fractionalSecondDigits: 3 });
    expect(instant).toBe(expected);
  });

  it('matches startOfDay for 00:00', () => {
    expect(instantAtLocal('2026-09-06' as LocalDate, '00:00')).toBe(startOfDay('2026-09-06' as LocalDate));
  });

  it('throws on a malformed time', () => {
    expect(() => instantAtLocal('2026-09-06' as LocalDate, '25:99')).toThrow();
    expect(() => instantAtLocal('2026-09-06' as LocalDate, 'noon')).toThrow();
  });
});
