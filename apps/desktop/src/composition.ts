import {
  CalendarService,
  EventService,
  ImportService,
  ListService,
  TaskService,
} from '@todolist/core';
import type { Clock, IdGenerator, TaskList, UnitOfWork } from '@todolist/core';
import type { AppServices, ListsApi } from '@todolist/features';

export interface CompositionDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly lists: readonly TaskList[];
}

/**
 * Wires domain services from injected adapters.
 * Pure function → identical wiring on desktop and a future mobile shell.
 */
export function createServices(deps: CompositionDeps): AppServices {
  return {
    tasks: new TaskService(deps),
    calendar: new CalendarService({ uow: deps.uow }),
    listsService: new ListService(deps),
    events: new EventService(deps),
    lists: deps.lists,
  };
}

/**
 * The sidebar's write port. It adapts `ListService` to the narrow interface
 * the UI declares, so the component never learns about the domain service.
 *
 * `remove` deliberately does NOT pass `force`: deleting a list that still
 * holds tasks would cascade-delete them in SQLite while the confirmation copy
 * promises they merely "lose their owner". The service rejects the call and
 * the sidebar surfaces the count, so nothing is destroyed silently.
 */
export function createListsApi(services: AppServices): ListsApi {
  return {
    create: (input) => services.listsService.create(input),
    rename: (id, name) => services.listsService.rename(id, name),
    recolor: (id, color) => services.listsService.recolor(id, color),
    remove: (id) => services.listsService.remove(id),
  };
}

/**
 * Restores a backup file. Uses `ImportService`, the only writer allowed to
 * preserve original ids so a restore keeps tasks pointing at their lists.
 */
export function createImportApplier(deps: CompositionDeps): ImportService {
  return new ImportService({ uow: deps.uow, clock: deps.clock });
}
