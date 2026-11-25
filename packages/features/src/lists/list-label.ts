import type { TaskList } from '@todolist/core';
import { listDisplayName } from '@todolist/core';
import { i18n } from '@todolist/ui';

/**
 * Display name for a list, resolved in the active language.
 *
 * The system inbox is the only list whose name is *not* stored user data — it
 * is a label, so it must follow a language switch the way every other UI string
 * does. User-created lists keep whatever they were named; renaming those out
 * from under the user would be far worse than leaving them in the old language.
 *
 * This lives in one helper because three screens show a list name — the sidebar,
 * the search results' group headers, and the task panel's list picker — and
 * before it existed each of them read `list.name` directly, so only the sidebar
 * followed the switch.
 *
 * `quadrant.inbox` is read from the `lists` namespace via `getFixedT`, the same
 * cross-namespace route `time-math.ts` and `export-import.ts` already use.
 */
export function listLabel(list: Pick<TaskList, 'name' | 'systemKey'>): string {
  return listDisplayName(list, i18n.getFixedT(null, 'lists')('quadrant.inbox'));
}
