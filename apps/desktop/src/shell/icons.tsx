/**
 * Desktop-shell icons.
 *
 * The set lives in `@todolist/ui` (one icon language for the whole app — see
 * `docs/DESIGN-LANGUAGE.md` §5.5). This module re-exports the ones the shell
 * uses so its imports stay short and stable, and so a future shell-only glyph
 * has an obvious home without adding to the shared set.
 *
 * Do not draw paths here. Add the icon to `@todolist/ui` instead, taking the
 * geometry from Lucide (ISC).
 */
export {
  ArchiveIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GearIcon,
  GridIcon,
  InboxIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from '@todolist/ui';
