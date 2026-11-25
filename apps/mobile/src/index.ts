import { CalendarService, EventService, ListService, TaskService } from '@todolist/core';
import type { Clock, IdGenerator, TaskList, UnitOfWork } from '@todolist/core';
import type { AppServices } from '@todolist/features';

/**
 * Mobile composition root — deliberately mirrors apps/desktop/src/composition.ts.
 *
 * Why this file exists in a skeleton: it proves the layering actually holds.
 * Bringing up iOS/Android means (a) picking a shell (Tauri 2 mobile target or
 * React Native), (b) writing one UnitOfWork adapter for its SQLite binding,
 * and (c) mounting the existing @todolist/features screens. No core change,
 * no feature rewrite. If that ever stops being true, this file fails to
 * compile and the architecture has drifted.
 */
export function createMobileServices(deps: {
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  lists: readonly TaskList[];
}): AppServices {
  return {
    tasks: new TaskService(deps),
    calendar: new CalendarService({ uow: deps.uow }),
    listsService: new ListService(deps),
    events: new EventService(deps),
    lists: deps.lists,
  };
}
