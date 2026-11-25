import type { CalendarEntry, LocalDate } from '@todolist/core';
import { endOfDay, startOfDay } from '@todolist/core';
import { useAsync } from './useAsync';
import { useAppServices, useRevision } from '../services';

/** Entries whose start falls inside the given local day. */
export function useDayEntries(date: LocalDate) {
  const { calendar } = useAppServices();
  const revision = useRevision();
  return useAsync<readonly CalendarEntry[]>(
    () => calendar.entriesBetween(startOfDay(date), endOfDay(date)),
    [date, revision],
  );
}

/** One fetch for an arbitrary range — used by the month grid. */
export function useRangeEntries(from: LocalDate, to: LocalDate) {
  const { calendar } = useAppServices();
  const revision = useRevision();
  return useAsync<readonly CalendarEntry[]>(
    () => calendar.entriesBetween(startOfDay(from), endOfDay(to)),
    [from, to, revision],
  );
}
