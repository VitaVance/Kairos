/**
 * Minimal, hand-written Temporal types.
 *
 * TypeScript 5.9 does not ship `lib.es20xx.temporal.d.ts` yet, so the subset of
 * the Temporal API that `shared/date.ts` and `shared/temporal-runtime.ts` use is
 * declared here. This is deliberately small and honest: add members only when a
 * date helper actually calls them.
 *
 * It is a global ambient namespace (no `export {}`), which is why it does not
 * pollute the module graph and is picked up by every file in the package.
 * No global `var Temporal` is declared on purpose — runtime access always goes
 * through `globalThis` inside `temporal-runtime.ts`, with a narrow cast there.
 */
declare namespace Temporal {
  /** Integer calendar-unit delta accepted by `PlainDate#add`. */
  interface DurationLike {
    readonly years?: number;
    readonly months?: number;
    readonly weeks?: number;
    readonly days?: number;
  }

  interface Instant {
    /** ISO-8601 string in UTC. Default precision trims trailing zeros. */
    toString(options?: {
      readonly fractionalSecondDigits?: 'auto' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
      readonly timeZone?: string;
    }): string;
    toZonedDateTimeISO(timeZone: string): ZonedDateTime;
    readonly epochMilliseconds: number;
  }

  interface InstantConstructor {
    from(item: string | Instant): Instant;
    compare(one: string | Instant, two: string | Instant): number;
  }

  interface PlainDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    /** 1 = Monday … 7 = Sunday. */
    readonly dayOfWeek: number;
    toString(): string;
    add(duration: DurationLike): PlainDate;
    toZonedDateTime(options: { readonly timeZone: string; readonly plainTime?: string }): ZonedDateTime;
  }

  interface PlainDateConstructor {
    from(item: string | PlainDate): PlainDate;
    compare(one: string | PlainDate, two: string | PlainDate): number;
  }

  interface ZonedDateTime {
    toPlainDate(): PlainDate;
    toInstant(): Instant;
    readonly epochMilliseconds: number;
  }

  interface NowConstructor {
    plainDateISO(timeZone?: string): PlainDate;
    instant(): Instant;
  }

  const Instant: InstantConstructor;
  const PlainDate: PlainDateConstructor;
  const Now: NowConstructor;
}
