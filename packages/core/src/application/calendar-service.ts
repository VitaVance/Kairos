import { colorOfList, eventToEntry, taskToEntry } from '../domain/calendar.js';
import { eachDay, startOfWeek, addDays, startOfDay, endOfDay, dayOfWeek } from '../shared/date.js';
import type { CalendarEntry, Instant, LocalDate } from '../domain/types.js';
import type { UnitOfWork } from '../ports/repository.js';

export interface CalendarServiceDeps {
  readonly uow: UnitOfWork;
}

export interface MonthGrid {
  /** 6 rows × 7 columns of local dates, Monday-first. */
  readonly weeks: readonly (readonly LocalDate[])[];
  readonly month: number;
  readonly year: number;
}

/**
 * Read-side projections for calendar surfaces. Tasks and events are merged
 * into one `CalendarEntry` shape so views never branch on source.
 */
export class CalendarService {
  constructor(private readonly deps: CalendarServiceDeps) {}

  async entriesBetween(from: Instant, to: Instant): Promise<readonly CalendarEntry[]> {
    const [lists, tasks, events] = await Promise.all([
      this.deps.uow.lists.list(),
      this.deps.uow.tasks.list(),
      this.deps.uow.events.list({ from, to }),
    ]);

    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);

    const taskEntries = tasks
      .map((t) => taskToEntry(t, colorOfList(lists, t.listId)))
      .filter((e): e is CalendarEntry => e !== null)
      .filter((e) => Date.parse(e.startAt) >= fromMs && Date.parse(e.startAt) < toMs);

    const eventEntries = events
      .filter((e) => Date.parse(e.startAt) < toMs && Date.parse(e.endAt) > fromMs)
      .map((e) => eventToEntry(e, colorOfList(lists, e.listId)));

    return [...taskEntries, ...eventEntries].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  }

  async entriesForDay(date: LocalDate): Promise<readonly CalendarEntry[]> {
    return this.entriesBetween(startOfDay(date), endOfDay(date));
  }

  async entriesForWeek(date: LocalDate): Promise<readonly CalendarEntry[]> {
    const start = startOfWeek(date);
    return this.entriesBetween(startOfDay(start), endOfDay(addDays(start, 6)));
  }

  /** Builds the 6×7 month grid containing `date`. */
  monthGrid(date: LocalDate): MonthGrid {
    const d = new Date(`${date}T00:00:00Z`);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01` as LocalDate;
    const gridStart = startOfWeek(first);
    const weeks: LocalDate[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: LocalDate[] = [];
      for (let i = 0; i < 7; i++) row.push(addDays(gridStart, w * 7 + i));
      weeks.push(row);
    }
    return { weeks, month, year };
  }

  /** Days of the week (Monday-first) containing `date`. */
  weekDays(date: LocalDate): readonly LocalDate[] {
    const start = startOfWeek(date);
    return eachDay(start, addDays(start, 6));
  }

  dayIndex(date: LocalDate): number {
    return dayOfWeek(date);
  }
}
