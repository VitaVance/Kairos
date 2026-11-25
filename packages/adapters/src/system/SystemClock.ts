import type { Clock, Instant } from '@todolist/core';

/**
 * Wall-clock `Clock` for production. Returns a UTC ISO-8601 instant, which is
 * what every `Instant` in the domain is (and sorts correctly as text).
 */
export class SystemClock implements Clock {
  now(): Instant {
    return new Date().toISOString() as Instant;
  }
}
